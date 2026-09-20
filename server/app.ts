import { migrateLocalPanoramas } from "./local-panorama-migration.js";
import { migrateDisplayNames } from "./display-names.js";
import { migrateRoundOneContent } from "./round-one-content.js";
import { validateFinalFile } from "./panorama-files.js";
import { publicError } from "../shared/errors.js";
import { randomUUID } from "node:crypto";
import { validatePackageFiles } from "./packages.js";
import { seedV2 } from "./demo-v2.js";
import { upgradeConfig } from "../shared/config.js";
import { existsSync } from "node:fs";
import { registerEditor } from "./editor.js";
import { seed, validateBank } from "./content.js";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { z } from "zod";
import { Store } from "./store.js";
import { cookieName, identity, login } from "./auth.js";
import {
  applyCommand,
  requireRule,
  expire,
  initialState,
  questionToken,
} from "./game.js";
import { project } from "./projection.js";
import type { Identity, Role, Ack } from "../shared/types.js";
import type { PrismaClient } from "@prisma/client";
export async function createApp(
  db: PrismaClient,
  options: { legacyForTests?: boolean } = {},
) {
  requireRule(
    !options.legacyForTests || process.env.NODE_ENV === "test",
    "Тестовые старые правила доступны только тестовому серверу",
  );
  requireRule(
    process.env.HOST_PASSWORD && process.env.PLAYER_PASSWORD,
    "Заполните HOST_PASSWORD и PLAYER_PASSWORD в .env",
  );
  requireRule(
    process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32,
    "SESSION_SECRET должен содержать не менее 32 символов",
  );
  await seed(db);
  await migrateLocalPanoramas(db);
  await seedV2(db);
  await migrateDisplayNames(db);
  await migrateRoundOneContent(db);
  const store = new Store(db);
  await store.init(!options.legacyForTests);
  const mediaRows = await db.media.findMany();
  const files = new Set(
    mediaRows
      .filter((m) => existsSync(resolve("uploads", m.filename)))
      .map((m) => m.id),
  );
  const contentErrors = validateBank(
    store.bank,
    store.state.config,
    Math.max(2, store.state.players.length),
    files,
  );
  if (contentErrors.length)
    console.warn("Проверка контента:\n" + contentErrors.join("\n"));
  else
    console.log("Банк вопросов проверен: " + store.bank.length + " вопросов");
  const app = express();
  const http = createServer(app);
  app.disable("x-powered-by");
  app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser(process.env.SESSION_SECRET));
  app.use((req, res, next) => {
    if (
      req.method !== "GET" &&
      req.headers.origin &&
      new URL(req.headers.origin).host !== req.headers.host
    )
      return res.status(403).json({ error: "Недопустимый источник запроса" });
    next();
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 60000,
      limit: 30,
      skipSuccessfulRequests: true,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Слишком много попыток. Подождите минуту." },
    }),
    async (req, res) => {
      await login(store, req, res);
    },
  );
  app.get("/api/session", async (req, res) => {
    const role = req.query.role === "host" ? "host" : "player";
    const who = await identity(
      store,
      req.signedCookies[cookieName(role)],
      role,
    );
    if (!who) return res.status(401).json({ error: "Войдите в игру" });
    res.json({ self: who });
  });
  app.post("/api/logout", async (req, res) => {
    const role = req.body.role === "host" ? "host" : "player";
    const who = await identity(
      store,
      req.signedCookies[cookieName(role)],
      role,
    );
    if (who) await db.session.delete({ where: { id: who.id } });
    res.clearCookie(cookieName(role));
    res.json({ ok: true });
    if (who)
      for (const [id, peer] of peers)
        if (peer.id === who.id) {
          io.to(id).emit("session-ended");
          io.sockets.sockets.get(id)?.disconnect(true);
        }
  });
  const io = new Server(http, {
    maxHttpBufferSize: 32000,
    allowRequest: (req, callback) => {
      try {
        const origin = req.headers.origin;
        callback(null, !origin || new URL(origin).host === req.headers.host);
      } catch {
        callback(null, false);
      }
    },
  });
  const peers = new Map<string, Identity>();
  const screens = new Set<string>();
  const connected = () =>
    new Set(
      [...peers.values()].flatMap((w) => (w.playerId ? [w.playerId] : [])),
    );
  const broadcast = () => {
    for (const [id, who] of peers) {
      if (
        who.role === "player" &&
        !store.state.players.some((p) => p.id === who.playerId)
      ) {
        io.to(id).emit("session-ended");
        io.sockets.sockets.get(id)?.disconnect(true);
        void db.session.deleteMany({ where: { playerId: who.playerId } });
      } else
        io.to(id).emit(
          "state",
          project(
            store,
            screens.has(id)
              ? { ...who, role: "player", playerId: undefined }
              : who,
            connected(),
          ),
        );
    }
  };
  store.onChange = broadcast;
  io.use(async (socket, next) => {
    try {
      const role: Role =
        socket.handshake.auth.role === "host" ? "host" : "player";
      const raw = socket.request.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(cookieName(role) + "="))
        ?.split("=")
        .slice(1)
        .join("=");
      const signed = raw
        ? cookieParser.signedCookie(
            decodeURIComponent(raw),
            process.env.SESSION_SECRET!,
          )
        : false;
      const who = await identity(store, signed, role);
      if (!who) throw new Error("Сессия истекла. Войдите снова.");
      const screen = socket.handshake.auth.surface === "obs";
      requireRule(
        !screen || who.role === "host",
        "Экран трансляции доступен только ведущему",
      );
      socket.data.screen = screen;
      socket.data.who = who;
      next();
    } catch (e) {
      next(e as Error);
    }
  });
  const envelope = z.object({
    id: z.string().uuid(),
    revision: z.number().int(),
    phase: z.string().optional(),
    finalAttemptId: z.string().nullable().optional(),
    buzzWinner: z.string().nullable().optional(),
    decisionToken: z.string().nullable().optional(),
    undoDecisionToken: z.string().nullable().optional(),
    roundEpoch: z.string().nullable().optional(),
    command: z.object({
      type: z.string().max(40),
      value: z.unknown().optional(),
      questionId: z.string().optional(),
    }),
  });
  const processed = new Map<string, Ack>();
  io.on("connection", (socket) => {
    const who = socket.data.who as Identity;
    if (socket.data.screen) screens.add(socket.id);
    peers.set(socket.id, who);
    broadcast();
    let count = 0;
    let windowStart = Date.now();
    socket.on("command", (input: unknown, ack: (a: Ack) => void) => {
      if (typeof ack !== "function") return;
      if (screens.has(socket.id))
        return ack({
          ok: false,
          error: "Экран трансляции доступен только для просмотра",
        });
      const receivedAt = Date.now();
      if (Date.now() - windowStart > 1000) {
        count = 0;
        windowStart = Date.now();
      }
      if (++count > 30)
        return ack({ ok: false, error: "Слишком много действий" });
      void store.serial(async () => {
        try {
          const e = envelope.parse(input);
          const key = who.id + ":" + e.id;
          if (processed.has(key) || store.state.acceptedCommands[key]) {
            ack(processed.get(key) ?? { ok: true });
            return;
          }
          const accepted = (message: string) => {
            // Keep scoring/phase event receipts durably for the whole party. High-frequency
            // previews use the bounded transport cache and cannot award points themselves.
            if (
              ![
                "pointPreview",
                "comparePreview",
                "answerPreview",
                "country",
                "panoramaLoading",
                "panoramaReady",
                "panoramaError",
              ].includes(e.command.type) &&
              !(
                e.command.type === "range" &&
                !(e.command.value as { locked?: boolean })?.locked
              )
            )
              store.state.acceptedCommands[key] = true;
            return message;
          };
          const validSession = await db.session.findUnique({
            where: { id: who.id },
          });
          requireRule(
            validSession && validSession.expiresAt.getTime() > receivedAt,
            "Сессия завершена",
          );
          requireRule(
            who.role === "host" ||
              store.state.players.some((p) => p.id === who.playerId),
            "Игрок удалён",
          );
          if (expire(structuredClone(store.state), receivedAt))
            await store.mutate(() => {
              expire(store.state, receivedAt);
              return "Время истекло";
            });
          if (
            [
              "answer",
              "range",
              "point",
              "buzz",
              "bet",
              "country",
              "confirmCountry",
              "pointPreview",
              "comparePreview",
              "compare",
              "answerPreview",
              "panoramaReady",
              "panoramaLoading",
              "panoramaError",
            ].includes(e.command.type)
          )
            requireRule(
              e.command.questionId === questionToken(store.state),
              "Вопрос изменился. Повторите действие.",
            );
          if (
            [
              "undo",
              "reset",
              "start",
              "choose",
              "order",
              "active",
              "restartRound",
              "restartGame",
              "nextRound",
            ].includes(e.command.type)
          )
            requireRule(
              e.revision === store.state.revision,
              "Состояние изменилось. Проверьте экран и повторите действие.",
            );
          if (
            [
              "next",
              "begin",
              "reveal",
              "skip",
              "judge",
              "beginLocation",
              "cancelFinal",
              "video",
              "undoDecision",
              "startLocation",
              "endWaiting",
              "passPoint",
            ].includes(e.command.type)
          )
            requireRule(
              e.phase === store.state.phase &&
                e.command.questionId === questionToken(store.state),
              "Фаза изменилась. Проверьте экран.",
            );
          if (
            store.state.round === 6 &&
            !["score", "joinOpen", "reset"].includes(e.command.type)
          )
            requireRule(
              (e.finalAttemptId ?? null) === store.state.finalAttemptId,
              "Попытка финала изменилась. Повторите действие.",
            );
          if (e.command.type === "judge")
            requireRule(
              e.buzzWinner === store.state.buzzWinner,
              "Отвечающий игрок сменился",
            );
          if (
            e.command.type === "judge" &&
            store.state.config.rulesVersion === 2
          )
            requireRule(
              e.decisionToken === store.state.decisionToken,
              "Это судейское решение уже изменилось",
            );
          if (!["reset", "ready"].includes(e.command.type))
            requireRule(
              (e.roundEpoch ?? null) === store.state.roundEpoch,
              "Раунд был перезапущен. Проверьте экран.",
            );
          if (e.command.type === "undoDecision")
            requireRule(
              e.undoDecisionToken === store.state.lastDecision?.token,
              "Отменяемое решение изменилось. Проверьте экран.",
            );
          if (e.command.type === "undo") {
            requireRule(who.role === "host", "Только ведущий");
            requireRule(
              !store.state.finalAttemptId,
              "Для повторного финала используйте «Отменить финал и выбрать другую панораму»",
            );
            await store.mutate(() => {
              const prev = store.history.pop();
              requireRule(prev, "История пуста");
              const revision = store.state.revision;
              const current = store.state;
              prev.players = prev.players.filter((p) =>
                current.players.some((c) => c.id === p.id),
              );
              for (const p of current.players)
                if (!prev.players.some((old) => old.id === p.id))
                  prev.players.push(p);
              prev.joinOpen = current.joinOpen;
              prev.finalSelection = current.finalSelection;
              prev.finalRandom = current.finalRandom;
              prev.config.roundNames = { ...current.config.roundNames };
              prev.acceptedCommands = { ...current.acceptedCommands };
              if (prev.config.rulesVersion === 2 && prev.phase === "judging")
                prev.decisionToken = randomUUID();
              store.state = prev;
              store.state.revision = revision;
              if (!prev.paused && prev.timer.remaining !== null) {
                prev.timer.deadline = Date.now() + prev.timer.remaining;
                prev.timer.remaining = null;
              }
              return accepted("Восстановлена предыдущая фаза");
            }, false);
          } else if (e.command.type === "reset") {
            requireRule(
              who.role === "host" && e.command.value === "СБРОС",
              "Нужно подтверждение сброса",
            );
            await store.mutate(() => {
              const old = store.state;
              store.state = initialState(
                old.config.rulesVersion === 1 && !options.legacyForTests
                  ? upgradeConfig(old.config)
                  : old.config,
              );
              store.state.revision = old.revision;
              store.state.acceptedCommands = { ...old.acceptedCommands };
              store.state.selectedPackageId = old.selectedPackageId;
              store.state.players = old.players.map((p) => ({
                ...p,
                score: 0,
                ready: false,
              }));
              store.history = [];
              return accepted("Партия полностью сброшена");
            }, false);
          } else
            await store.mutate(async () => {
              if (e.command.type === "restartGame") {
                requireRule(
                  who.role === "host" &&
                    e.command.value === "НАЧАТЬ ИГРУ ЗАНОВО",
                  "Нужно подтверждение ведущего для новой партии",
                );
                if (store.state.config.rulesVersion === 2) {
                  requireRule(
                    store.state.packageSnapshot,
                    "Снимок пакета отсутствует",
                  );
                  const issues = await validatePackageFiles(
                    store,
                    store.state.packageSnapshot,
                  );
                  requireRule(!issues.length, issues.join("; "));
                }
              }
              if (
                e.command.type === "start" &&
                store.state.config.rulesVersion === 2
              ) {
                requireRule(
                  who.role === "host",
                  "Только ведущий запускает игру",
                );
                const pack = store.packages.find(
                  (pack) => pack.id === store.state.selectedPackageId,
                );
                requireRule(pack, "Выберите игровой пакет");
                const issues = await validatePackageFiles(store, pack);
                requireRule(!issues.length, issues.join("; "));
                store.state.packageSnapshot = structuredClone(pack);
              }
              const message = applyCommand(
                store.state,
                who,
                e.command,
                store.bank,
                Date.now(),
                receivedAt,
              );
              if (
                e.command.type === "selectFinal" ||
                (e.command.type === "begin" &&
                  store.state.question?.round === 6)
              ) {
                requireRule(store.state.finalSelection, "Панорама не выбрана");
                await validateFinalFile(db, store.state.finalSelection);
              }
              if (
                [
                  "cancelFinal",
                  "restartRound",
                  "restartGame",
                  "nextRound",
                ].includes(e.command.type)
              )
                store.history = [];
              return accepted(message);
            }, !["cancelFinal", "restartRound", "restartGame", "nextRound"].includes(e.command.type));
          const result = { ok: true };
          processed.set(key, result);
          if (processed.size > 2000)
            processed.delete(processed.keys().next().value!);
          ack(result);
        } catch (err) {
          ack({
            ok: false,
            error: publicError(err),
          });
        }
      });
    });
    socket.on("disconnect", () => {
      screens.delete(socket.id);
      peers.delete(socket.id);
      broadcast();
    });
  });
  registerEditor(app, store);
  app.get(["/media/:id", "/api/obs-media/:id"], async (req, res) => {
    const host = await identity(
      store,
      req.signedCookies[cookieName("host")],
      "host",
    );
    const player = await identity(
      store,
      req.signedCookies[cookieName("player")],
      "player",
    );
    const q = store.state.question;
    const v2 = store.state.config.rulesVersion === 2;
    const requestedId = String(req.params.id);
    const fileId =
      (v2
        ? Object.entries(store.state.mediaTokens).find(
            ([, token]) => token === requestedId,
          )?.[0]
        : undefined) ?? requestedId;
    const tokenAllowed = !v2 || store.state.mediaTokens[fileId] === requestedId;
    const visible =
      tokenAllowed &&
      (q?.round === 6
        ? q.panoramaFileId === fileId &&
          [
            "loadingPanorama",
            "locating",
            "awaitingReveal",
            "finished",
          ].includes(store.state.phase)
        : q?.round === 4
          ? q.media.fileId === fileId ||
            (store.state.phase === "reveal" && q.fullImageFileId === fileId)
          : q?.media?.fileId === fileId &&
            (q.round !== 5 ||
              ["studying", "reveal"].includes(store.state.phase)));
    if (
      req.path.toLowerCase().startsWith("/api/obs-media/")
        ? !host || !visible
        : !host && (!player || !visible)
    )
      return res.status(403).json({ error: "Медиа ещё недоступно" });
    const file = await db.media.findUnique({
      where: { id: fileId },
    });
    if (!file) return res.status(404).end();
    res.setHeader("Cache-Control", "private, no-store");
    res.type(file.mime);
    // Resolve only registered filenames within the private upload directory.
    res.sendFile(file.filename, { root: resolve("uploads") });
  });
  const clock = setInterval(() => {
    const tickAt = Date.now();
    void store
      .serial(async () => {
        if (expire(structuredClone(store.state), tickAt))
          await store.mutate(() => {
            expire(store.state, tickAt);
            return "Время истекло";
          });
      })
      .catch(console.error);
  }, 200);
  app.use(express.static(resolve("dist/client")));
  app.get("/{*path}", (req, res) => {
    if (req.path.startsWith("/api/"))
      return res.status(404).json({ error: "Не найдено" });
    res.sendFile("index.html", { root: resolve("dist/client") });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) =>
    res.status(400).json({ error: publicError(err) }),
  );
  return {
    app,
    http,
    io,
    store,
    close: async () => {
      clearInterval(clock);
      io.close();
      await store.serial(async () => {});
      await new Promise<void>((r) => http.close(() => r()));
      await db.$disconnect();
    },
  };
}
