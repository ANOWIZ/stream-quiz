import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  beginQuestion,
  applyCommand,
  expire,
} from "../server/game.js";
import { defaultConfig, upgradeConfig } from "../shared/config.js";
import { demoQuestions } from "../server/content.js";
import { project } from "../server/projection.js";
import type { Store } from "../server/store.js";

for (const version of [1, 2])
  for (const completion of ["confirmed", "timeout"]) {
    it(`финал v${version}, ${completion}: ведущий раскрывает; неверная страна со ставкой 0 не становится верной`, () => {
      const s = initialState(
        version === 2 ? upgradeConfig() : structuredClone(defaultConfig),
      );
      const a = joinPlayer(s, "Лидер"),
        b = joinPlayer(s, "Второй");
      a.score = 1100;
      b.score = 800;
      s.round = 6;
      s.roundIndex = 5;
      s.order = s.roster = [a.id, b.id];
      const q = demoQuestions().find((q) => q.round === 6)!;
      beginQuestion(s, q, 1000);
      const host = { id: "h", role: "host" as const, name: "Ведущий" };
      const who = (id?: string) =>
        id ? { id, playerId: id, role: "player" as const, name: id } : host;
      const send = (type: string, value?: unknown, id?: string) =>
        applyCommand(s, who(id), { type, value }, [], 2000);
      const store = {
        state: s,
        bank: [],
        events: [],
        packages: [],
      } as unknown as Store;
      send("bet", 0, a.id);
      send("bet", 0, b.id);
      if (version === 2) {
        send("panoramaReady");
        send("panoramaReady", undefined, a.id);
        send("panoramaReady", undefined, b.id);
      }
      expect(() => send("reveal")).toThrow();
      send(
        "country",
        version === 2
          ? { code: "RU", point: { latitude: 55.75, longitude: 37.62 } }
          : "RU",
        a.id,
      );
      send(
        "country",
        version === 2
          ? { code: "ZA", point: { latitude: -30, longitude: 25 } }
          : "ZA",
        b.id,
      );
      send("confirmCountry", undefined, a.id);
      if (completion === "confirmed") send("confirmCountry", undefined, b.id);
      else expect(expire(s, s.timer.deadline!)).toBe(true);
      expect(s.phase).toBe("awaitingReveal");
      expect(s.timer.deadline).toBeNull();
      expect(s.players.map((p) => p.score)).toEqual([1100, 800]);
      expect(s.deltas).toEqual({});
      expect(expire(s, 999999999)).toBe(false);
      expect(Object.values(s.countries).every((c) => c.locked)).toBe(true);
      for (const identity of [
        host,
        who(a.id),
        { id: "obs", role: "player" as const, name: "Экран" },
      ]) {
        const v = project(store, identity, new Set());
        expect(v.question?.answer).toBeUndefined();
        expect(v.question?.place).toBeUndefined();
        expect(v.finalCorrect).toBeUndefined();
        expect(v.countries[b.id]).toBeUndefined();
        expect(v.bets[b.id]).toBeUndefined();
      }
      expect(() => send("country", "FR", a.id)).toThrow();
      expect(() => send("reveal", undefined, a.id)).toThrow();
      const canceled = structuredClone(s);
      applyCommand(
        canceled,
        host,
        { type: "cancelFinal", value: "ОТМЕНИТЬ ФИНАЛ" },
        [],
        2000,
      );
      expect(canceled.phase).toBe("intro");
      expect(canceled.players.map((p) => p.score)).toEqual([1100, 800]);
      send("reveal");
      expect(s.phase).toBe("finished");
      const result = project(store, host, new Set());
      expect(result.finalCorrect).toEqual({ [a.id]: false, [b.id]: true });
      expect(s.players.map((p) => p.score)).toEqual([1100, 800]);
      expect(s.players.reduce((a, b) => (a.score > b.score ? a : b)).id).toBe(
        a.id,
      );
      expect(() => send("reveal")).toThrow();
      expect(s.players.map((p) => p.score)).toEqual([1100, 800]);
    });
  }
