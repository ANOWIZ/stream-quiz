import type { PrismaClient } from "@prisma/client";
import {
  initialState,
  captureRoundStart,
  syncLegacyRoundBank,
} from "./game.js";
import type { GameState } from "../shared/types.js";
import type { Question } from "../shared/content.js";
import {
  configSchema,
  defaultConfig,
  upgradeConfig,
} from "../shared/config.js";
import { packageSchema, type GamePackage } from "../shared/packages.js";
export class Store {
  state = initialState();
  history: GameState[] = [];
  bank: Question[] = [];
  packages: GamePackage[] = [];
  events: { id: number; message: string; at: string }[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  onChange: () => void = () => {};
  constructor(public db: PrismaClient) {}
  async init(upgradeLobby = true) {
    const row = await this.db.game.findUnique({ where: { id: "main" } });
    if (row) {
      this.state = JSON.parse(row.state) as GameState;
      this.history = JSON.parse(row.history) as GameState[];
    } else {
      const cfg = await this.db.setting.findUnique({ where: { id: "main" } });
      this.state = initialState(
        cfg
          ? JSON.parse(cfg.data)
          : upgradeLobby
            ? upgradeConfig()
            : defaultConfig,
      );
      await this.save("Создана комната");
    }
    this.state = { ...initialState(), ...this.state };
    const upgradeBetLimit = this.state.config.final.betLimit !== 1;
    this.state.config = configSchema.parse(this.state.config);
    this.history = this.history.map((s) => ({
      ...initialState(),
      ...s,
      config: configSchema.parse(s.config),
    }));
    if (
      upgradeLobby &&
      this.state.phase === "lobby" &&
      this.state.config.rulesVersion !== 2
    ) {
      const archive = "rules-v2-archive:" + Date.now();
      const config = upgradeConfig(this.state.config);
      await this.db.$transaction([
        this.db.setting.create({
          data: {
            id: archive,
            data: JSON.stringify({ state: this.state, history: this.history }),
          },
        }),
        this.db.setting.upsert({
          where: { id: "main" },
          create: { id: "main", data: JSON.stringify(config) },
          update: { data: JSON.stringify(config) },
        }),
      ]);
      this.state.config = config;
      this.history = [];
      this.state.revision++;
      await this.save(
        "Лобби переведено на новые правила; прежнее состояние архивировано",
      );
    }
    if (this.state.question?.round === 6 && !this.state.finalAttemptId) {
      this.state.finalSelection = this.state.question;
      this.state.finalAttemptId = "restored-" + this.state.revision;
    }
    await this.refreshBank();
    // Recover a checkpoint for a running game saved before round restarts existed.
    if (!this.state.roundCheckpoint && this.state.round > 0) {
      const states = [...this.history, this.state].filter(
        (s) => s.round === this.state.round,
      );
      const intro = states.find(
        (s) => s.phase === "intro" && s.completed === 0,
      );
      if (intro) {
        captureRoundStart(intro);
        const checkpoint = structuredClone(intro.roundCheckpoint!);
        const latest = new Map<string, GameState>();
        for (const s of states) if (s.question) latest.set(s.question.id, s);
        for (const s of latest.values())
          for (const [id, delta] of Object.entries(s.deltas))
            checkpoint.awards[id] = (checkpoint.awards[id] ?? 0) + delta;
        this.state.roundCheckpoint = checkpoint;
      }
    }
    await this.refreshPackages();
    await this.refreshEvents();
    if (upgradeBetLimit) {
      const data = JSON.stringify(this.state.config);
      await this.db.setting.upsert({
        where: { id: "main" },
        create: { id: "main", data },
        update: { data },
      });
      this.state.revision++;
      await this.save("Финальные ставки: разрешён весь положительный счёт");
    }
  }
  async refreshBank() {
    this.bank = (
      await this.db.question.findMany({ orderBy: { position: "asc" } })
    ).map((row) => {
      const q = JSON.parse(row.data) as Question;
      if (q.round === 6) q.addedAt ??= row.updatedAt.toISOString();
      return q;
    });
    syncLegacyRoundBank(this.state, this.bank);
    if (
      this.state.config.rulesVersion === 2 &&
      this.state.round > 0 &&
      this.state.round < 6
    )
      this.state.total = this.state.boardIds.length;
    if (
      this.state.finalSelection &&
      !this.state.finalAttemptId &&
      (this.state.config.rulesVersion !== 2 || this.state.phase === "lobby")
    ) {
      const selected = this.bank.find(
        (q) => q.id === this.state.finalSelection!.id,
      );
      this.state.finalSelection =
        selected?.round === 6 && selected.active
          ? structuredClone(selected)
          : null;
    }
  }
  async refreshEvents() {
    this.events = (
      await this.db.event.findMany({ orderBy: { id: "desc" }, take: 80 })
    ).map((e) => ({ id: e.id, message: e.message, at: e.at.toISOString() }));
  }
  async refreshPackages() {
    this.packages = (
      await this.db.setting.findMany({
        where: { id: { startsWith: "package:" } },
      })
    ).map((row) => packageSchema.parse(JSON.parse(row.data)));
  }
  serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
  async save(message: string) {
    await this.db.$transaction([
      this.db.game.upsert({
        where: { id: "main" },
        create: {
          id: "main",
          state: JSON.stringify(this.state),
          history: JSON.stringify(this.history),
        },
        update: {
          state: JSON.stringify(this.state),
          history: JSON.stringify(this.history),
        },
      }),
      ...(this.state.question?.round === 6 &&
      ["locating", "finished"].includes(this.state.phase)
        ? [
            this.db.setting.upsert({
              where: { id: "panorama-used:" + this.state.question.id },
              create: {
                id: "panorama-used:" + this.state.question.id,
                data: new Date().toISOString(),
              },
              update: {},
            }),
          ]
        : []),
      this.db.event.create({
        data: {
          type: this.state.phase,
          message,
          revision: this.state.revision,
        },
      }),
    ]);
    await this.refreshEvents();
  }
  async mutate(fn: () => string | Promise<string>, remember = true) {
    const before = structuredClone(this.state);
    const oldHistory = [...this.history];
    try {
      const msg = await fn();
      this.state.revision++;
      if (
        remember &&
        (before.phase !== this.state.phase ||
          before.question?.id !== this.state.question?.id)
      ) {
        if (before.timer.deadline !== null)
          before.timer.remaining = Math.max(
            0,
            before.timer.deadline - Date.now(),
          );
        this.history.push(before);
        this.history = this.history.slice(-30);
      }
      await this.save(msg);
      this.onChange();
      return msg;
    } catch (e) {
      this.state = before;
      this.history = oldHistory;
      throw e;
    }
  }
}
