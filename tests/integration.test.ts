import sharp from "sharp";
import { Store } from "../server/store.js";
import { migrateDisplayNames } from "../server/display-names.js";
import { upgradeConfig } from "../shared/config.js";
import { expire } from "../server/game.js";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import {
  mkdtempSync,
  renameSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { io, type Socket } from "socket.io-client";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.js";
import { initialState, beginQuestion } from "../server/game.js";
import type { Ack, GameView, Role } from "../shared/types.js";
import type { MediaRow } from "../shared/editor-types.js";
let runtime: Awaited<ReturnType<typeof createApp>>;
let base = "";
let folder = "";
let dbUrl = "";
const hostPassword = randomBytes(20).toString("hex");
const playerPassword = randomBytes(20).toString("hex");
const sockets: Socket[] = [];
type Peer = {
  socket: Socket;
  cookie: string;
  view: GameView;
  send: (type: string, value?: unknown) => Promise<Ack>;
};
async function waitFor(check: () => boolean) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end) throw Error("Ожидание состояния истекло");
    await new Promise((r) => setTimeout(r, 10));
  }
}
async function start() {
  runtime = await createApp(new PrismaClient({ datasourceUrl: dbUrl }), {
    legacyForTests: true,
  });
  await new Promise<void>((r) =>
    runtime.http.listen(0, "127.0.0.1", () => r()),
  );
  base = "http://127.0.0.1:" + (runtime.http.address() as AddressInfo).port;
}
async function request(
  path: string,
  body?: unknown,
  cookie = "",
  method?: string,
) {
  return fetch(base + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function login(
  role: Role,
  name: string,
  password = role === "host" ? hostPassword : playerPassword,
) {
  const res = await request("/api/login", { role, name, password });
  return { res, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function connect(
  cookie: string,
  role: Role,
  surface?: "obs",
): Promise<Peer> {
  const socket = io(base, {
    autoConnect: false,
    auth: { role, surface },
    extraHeaders: { Cookie: cookie },
    transports: ["websocket"],
  });
  sockets.push(socket);
  const peer = { socket, cookie } as Peer;
  socket.on("state", (v: GameView) => {
    peer.view = v;
  });
  socket.connect();
  await waitFor(() => !!peer.view);
  peer.send = (type, value) =>
    socket.timeout(5000).emitWithAck("command", {
      id: randomUUID(),
      revision: peer.view.revision,
      phase: peer.view.phase,
      finalAttemptId: peer.view.finalAttemptId,
      buzzWinner: peer.view.buzzWinner,
      roundEpoch: peer.view.roundEpoch,
      decisionToken: peer.view.decisionToken,
      undoDecisionToken: peer.view.undoDecisionToken,
      command: { type, value, questionId: peer.view.question?.id },
    });
  return peer;
}
async function room() {
  const h = await connect((await login("host", "Ведущий")).cookie, "host");
  const a = await connect((await login("player", "Алиса")).cookie, "player");
  const b = await connect((await login("player", "Борис")).cookie, "player");
  return { h, a, b };
}
beforeAll(async () => {
  process.env.HOST_PASSWORD = hostPassword;
  process.env.PLAYER_PASSWORD = playerPassword;
  process.env.SESSION_SECRET = randomBytes(48).toString("hex");
  mkdirSync(".local", { recursive: true });
  folder = mkdtempSync(resolve(".local", "integration-"));
  const file = join(folder, "quiz.db");
  writeFileSync(file, "");
  dbUrl = "file:" + file.replaceAll("\\", "/");
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" },
  );
  await start();
}, 30000);
beforeEach(async () => {
  await runtime.store.serial(async () => {
    await runtime.store.db.session.deleteMany();
    runtime.store.state = initialState();
    runtime.store.history = [];
    await runtime.store.save("Тестовая комната");
  });
});
afterEach(() => {
  for (const s of sockets) s.disconnect();
  sockets.length = 0;
});
afterAll(async () => {
  await runtime?.close();
  if (folder.startsWith(resolve(".local") + requireSeparator()))
    rmSync(folder, { recursive: true, force: true });
});
function requireSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}
it("удаление встроенного названия сохраняет вопросы, партию и историю", async () => {
  const db = runtime.store.db;
  await db.setting.deleteMany({ where: { id: "display-names-unbranded-v2" } });
  const q = {
    ...runtime.store.bank[0],
    source: "Авторский демонстрационный набор СТОН",
  };
  await db.question.update({
    where: { id: q.id },
    data: { data: JSON.stringify(q) },
  });
  const pack = JSON.parse(
    (
      await db.setting.findUniqueOrThrow({
        where: { id: "package:demo-v2-51" },
      })
    ).data,
  );
  pack.name = "СТОН · учебный пакет на 51 задание";
  pack.questions[0].source = q.source;
  await db.setting.update({
    where: { id: "package:demo-v2-51" },
    data: { data: JSON.stringify(pack) },
  });
  const s = structuredClone(runtime.store.state);
  s.phase = "choosing";
  s.round = 1;
  s.completed = 3;
  s.used = [q.id];
  s.question = q;
  s.packageSnapshot = pack;
  const history = [structuredClone(s)];
  await db.game.update({
    where: { id: "main" },
    data: { state: JSON.stringify(s), history: JSON.stringify(history) },
  });
  const event = await db.event.create({
    data: {
      type: "test",
      revision: 0,
      message: "Выбран пакет «" + pack.name + "»",
    },
  });
  await migrateDisplayNames(db);
  const updated = await db.game.findUniqueOrThrow({ where: { id: "main" } });
  const expected = structuredClone(s);
  expected.question!.source = "Авторский демонстрационный набор";
  expected.packageSnapshot!.name = "Учебный пакет на 51 задание";
  expected.packageSnapshot!.questions[0].source = expected.question!.source;
  expect(JSON.parse(updated.state)).toEqual(expected);
  expect(JSON.parse(updated.history)).toEqual([expected]);
  expect(
    JSON.parse(
      (await db.question.findUniqueOrThrow({ where: { id: q.id } })).data,
    ),
  ).toEqual({ ...q, source: expected.question!.source });
  expect(
    (await db.event.findUniqueOrThrow({ where: { id: event.id } })).message,
  ).toBe("Выбран пакет «Учебный пакет на 51 задание»");
  await migrateDisplayNames(db);
  expect(await db.game.findUniqueOrThrow({ where: { id: "main" } })).toEqual(
    updated,
  );
});

it("вход: неверный пароль, один ведущий, регистр имён и шестой/седьмой игрок", async () => {
  expect((await login("host", "В", "wrong")).res.status).toBe(400);
  expect((await login("host", "В")).res.ok).toBe(true);
  expect((await login("host", "Другой")).res.ok).toBe(false);
  expect((await login("player", "Алиса")).res.ok).toBe(true);
  expect((await login("player", "аЛИСА")).res.ok).toBe(false);
  for (let i = 1; i < 6; i++)
    expect((await login("player", "Игрок " + i)).res.ok).toBe(true);
  expect((await login("player", "Седьмой")).res.ok).toBe(false);
});
it("переподключение и refresh восстанавливают личность, а выход без сессии не отключает комнату", async () => {
  const { h, a } = await room();
  expect((await a.send("ready", true)).ok).toBe(true);
  const id = a.view.self.playerId;
  const response = await request("/api/logout", { role: "host" });
  expect(response.ok).toBe(true);
  expect(h.socket.connected).toBe(true);
  a.socket.disconnect();
  const again = await connect(a.cookie, "player");
  expect(again.view.self.playerId).toBe(id);
  expect(again.view.players.find((p) => p.id === id)?.ready).toBe(true);
  expect(
    (await request("/api/session?role=player", undefined, a.cookie)).ok,
  ).toBe(true);
});
it("удаление отзывает сессию и отключает сокет игрока", async () => {
  const { h, a } = await room();
  expect((await h.send("remove", a.view.self.playerId)).ok).toBe(true);
  await waitFor(() => !a.socket.connected);
  expect(
    (await request("/api/session?role=player", undefined, a.cookie)).status,
  ).toBe(401);
});
it("игрок и аноним не получают редактор, банк или закрытые медиа", async () => {
  const { a } = await room();
  for (const path of [
    "/api/editor",
    "/api/editor/export",
    "/media/demo-memory-0-0",
    "/media/demo-local-panorama",
  ])
    expect((await request(path, undefined, a.cookie)).status).toBe(403);
  expect(
    (await request("/api/editor/questions", runtime.store.bank[0], a.cookie))
      .status,
  ).toBe(403);
  expect((await request("/api/editor")).status).toBe(403);
});
it("сокеты: гонка нажатий, таймер судейства и почти одновременные verdict", async () => {
  const { h, a, b } = await room();
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      const s = runtime.store.state;
      s.round = 4;
      s.roster = s.players.map((p) => p.id);
      s.order = [...s.roster];
      beginQuestion(
        s,
        runtime.store.bank.find((q) => q.round === 4)!,
        Date.now(),
      );
      return "Вопрос";
    }),
  );
  await waitFor(() => a.view.phase === "buzzing" && b.view.phase === "buzzing");
  const results = await Promise.all([a.send("buzz"), b.send("buzz")]);
  expect(results.every((r) => r.ok)).toBe(true);
  expect(runtime.store.state.buzzes.filter((b) => b.accepted)).toHaveLength(1);
  expect(runtime.store.state.buzzes).toHaveLength(2);
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      runtime.store.state.timer.deadline = Date.now() - 1;
      return "Время устного ответа";
    }, false),
  );
  await waitFor(() => runtime.store.state.timer.deadline === null);
  expect(runtime.store.state.phase).toBe("judging");
  await waitFor(() => h.view.phase === "judging");
  const verdicts = await Promise.all([
    h.send("judge", true),
    h.send("judge", true),
  ]);
  expect(verdicts.filter((r) => r.ok)).toHaveLength(1);
  expect(runtime.store.state.players.reduce((n, p) => n + p.score, 0)).toBe(
    100,
  );
});
it("секретность memory HTTP media и корректность host-подсказки только при судействе", async () => {
  const { h, a } = await room();
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      const s = runtime.store.state;
      s.round = 5;
      s.roster = s.players.map((p) => p.id);
      s.order = [...s.roster];
      beginQuestion(
        s,
        runtime.store.bank.find((q) => q.round === 5)!,
        Date.now(),
      );
      return "Просмотр";
    }),
  );
  await waitFor(() => a.view.phase === "studying");
  expect(a.view.question).not.toHaveProperty("text");
  expect(
    (await request("/media/demo-memory-0-0", undefined, a.cookie)).ok,
  ).toBe(true);
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      runtime.store.state.timer.deadline = Date.now() - 1;
      return "Время";
    }, false),
  );
  await waitFor(() => a.view.phase === "buzzing");
  expect(
    (await request("/media/demo-memory-0-0", undefined, a.cookie)).status,
  ).toBe(403);
  await a.send("buzz");
  await waitFor(() => h.view.phase === "judging");
  expect(h.view.judgingGuide?.answer).toBeDefined();
  expect(a.view.judgingGuide).toBeUndefined();
});
it("редактор: CRUD, дубль ID в импорте, блокировка текущего вопроса, MIME и резервная копия", async () => {
  const { h } = await room();
  const original = runtime.store.bank[0];
  const q = {
    ...original,
    id: "test-" + randomUUID(),
    category: "Тест редактора",
  };
  expect((await request("/api/editor/questions", q, h.cookie)).ok).toBe(true);
  expect(runtime.store.bank.some((p) => p.id === q.id)).toBe(true);
  expect(
    (
      await request(
        "/api/editor/import",
        { version: 1, questions: [q, q] },
        h.cookie,
      )
    ).ok,
  ).toBe(false);
  const form = new FormData();
  form.append(
    "file",
    new Blob(["not a png"], { type: "image/png" }),
    "bad.png",
  );
  expect(
    (
      await fetch(base + "/api/editor/media", {
        method: "POST",
        headers: { Cookie: h.cookie },
        body: form,
      })
    ).ok,
  ).toBe(false);
  const png = new Uint8Array(
    await (
      await import("sharp")
    )
      .default({
        create: { width: 4, height: 4, channels: 3, background: "#334455" },
      })
      .png()
      .toBuffer(),
  );
  const good = new FormData();
  good.append(
    "file",
    new Blob([png], { type: "image/png" }),
    "../../unsafe.png",
  );
  const uploaded = await fetch(base + "/api/editor/media", {
    method: "POST",
    headers: { Cookie: h.cookie },
    body: good,
  });
  expect(uploaded.ok).toBe(true);
  const media = (await uploaded.json()) as MediaRow;
  expect(media.filename).toMatch(/^[\w-]+\.png$/);
  expect(
    (
      await request(
        "/api/editor/media/" + media.id,
        undefined,
        h.cookie,
        "DELETE",
      )
    ).ok,
  ).toBe(true);
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      beginQuestion(runtime.store.state, q, Date.now());
      return "Вопрос";
    }),
  );
  expect(
    (
      await request(
        "/api/editor/questions",
        { ...q, text: "Новый текст" },
        h.cookie,
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await request(
        "/api/editor/questions/" + q.id,
        undefined,
        h.cookie,
        "DELETE",
      )
    ).ok,
  ).toBe(false);
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      runtime.store.state.question = null;
      return "Закрыто";
    }),
  );
  expect(
    (
      await request(
        "/api/editor/questions/" + q.id,
        undefined,
        h.cookie,
        "DELETE",
      )
    ).ok,
  ).toBe(true);
  const backupResponse = await request("/api/editor/backup", {}, h.cookie);
  const backup = (await backupResponse.json()) as {
    name: string;
    error?: string;
  };
  expect(backupResponse.ok, backup.error).toBe(true);
  const path = resolve("backups", backup.name);
  expect(existsSync(join(path, "quiz.db"))).toBe(true);
  if (path.startsWith(resolve("backups") + requireSeparator()))
    rmSync(path, { recursive: true, force: true });
});
it("undo не удаляет нового участника, а restart сервера сохраняет партию и сессии", async () => {
  const { h, a, b } = await room();
  await a.send("ready", true);
  await b.send("ready", true);
  expect((await h.send("start")).ok).toBe(true);
  await waitFor(() => h.view.phase === "intro");
  await h.send("begin");
  await h.send("joinOpen", true);
  const c = await connect((await login("player", "Вика")).cookie, "player");
  expect((await h.send("undo")).ok).toBe(true);
  expect(
    runtime.store.state.players.some((p) => p.id === c.view.self.playerId),
  ).toBe(true);
  const savedPhase = runtime.store.state.phase;
  const cookie = a.cookie;
  const id = a.view.self.playerId;
  for (const s of sockets) s.disconnect();
  await runtime.close();
  await start();
  const again = await connect(cookie, "player");
  expect(again.view.phase).toBe(savedPhase);
  expect(again.view.self.playerId).toBe(id);
  expect(again.view.players).toHaveLength(3);
});

it("время приёма сохраняется при задержке SQLite, управление ведущего не зависит от движения ответов", async () => {
  const { h, a } = await room();
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      const s = runtime.store.state;
      s.round = 1;
      s.roster = s.players.map((p) => p.id);
      s.order = [
        a.view.self.playerId!,
        ...s.roster.filter((id) => id !== a.view.self.playerId),
      ];
      beginQuestion(
        s,
        runtime.store.bank.find((q) => q.round === 1)!,
        Date.now(),
      );
      s.timer.deadline = Date.now() + 160;
      return "Короткий таймер";
    }),
  );
  await waitFor(() => a.view.phase === "point");
  const oldRevision = h.view.revision;
  const block = runtime.store.serial(
    () => new Promise<void>((r) => setTimeout(r, 300)),
  );
  const answer = await a.send("point", 36);
  await block;
  expect(answer.ok).toBe(true);
  expect(runtime.store.state.phase).toBe("ranges");
  expect(runtime.store.state.timer.deadline! - Date.now()).toBeGreaterThan(
    44000,
  );
  const ack = (await h.socket.timeout(5000).emitWithAck("command", {
    id: randomUUID(),
    revision: oldRevision,
    phase: "point",
    command: { type: "pause", questionId: h.view.question?.id },
  })) as Ack;
  expect(ack.ok).toBe(true);
  expect(runtime.store.state.paused).toBe(true);
});

it("панорамы: загрузка, доступ по фазам, отмена, устаревшие команды и восстановление выбора", async () => {
  const { h, a, b } = await room();
  const sharp = (await import("sharp")).default;
  const buffer = await sharp({
    create: { width: 512, height: 256, channels: 3, background: "#547b95" },
  })
    .jpeg()
    .toBuffer();
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }),
    "France GPS.jpg",
  );
  expect(
    (
      await fetch(base + "/api/editor/panorama-upload", {
        method: "POST",
        headers: { Cookie: a.cookie },
        body: form,
      })
    ).status,
  ).toBe(403);
  const upload = await fetch(base + "/api/editor/panorama-upload", {
    method: "POST",
    headers: { Cookie: h.cookie },
    body: form,
  });
  expect(upload.ok).toBe(true);
  const media = (await upload.json()) as MediaRow;
  expect(media.filename).not.toContain("France");
  expect(media.originalName).not.toContain("GPS");
  const originalLink = await runtime.store.db.setting.findUniqueOrThrow({
    where: { id: "panorama-original:" + media.id },
  });
  const originalFile = await runtime.store.db.media.findUniqueOrThrow({
    where: { id: originalLink.data },
  });
  const savedOriginal = await request(
    "/media/" + originalFile.id,
    undefined,
    h.cookie,
  );
  expect(Buffer.from(await savedOriginal.arrayBuffer())).toEqual(buffer);
  expect(
    (await request("/media/" + originalFile.id, undefined, a.cookie)).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/api/editor/media/" + originalFile.id,
        undefined,
        h.cookie,
        "DELETE",
      )
    ).ok,
  ).toBe(false);
  const original = runtime.store.bank.find((q) => q.round === 6)!;
  const q = {
    ...original,
    id: "panorama-" + randomUUID(),
    panoramaFileId: media.id,
    title: "Secret French scene",
    answer: "FR",
    source: "Own photograph",
    license: "CC0",
    author: "Test",
    place: "Secret place",
  };
  const imageTemplate = runtime.store.bank.find((q) => q.round === 4)!;
  const originalQuestion = {
    ...imageTemplate,
    id: "original-ref-" + randomUUID(),
    media: { ...imageTemplate.media!, fileId: originalFile.id },
  };
  expect(
    (await request("/api/editor/questions", originalQuestion, h.cookie)).ok,
  ).toBe(true);
  expect(
    (
      await request(
        "/api/editor/media/" + media.id,
        undefined,
        h.cookie,
        "DELETE",
      )
    ).ok,
  ).toBe(false);
  expect(
    (await request("/media/" + originalFile.id, undefined, h.cookie)).ok,
  ).toBe(true);
  expect(
    (
      await request(
        "/api/editor/questions/" + originalQuestion.id,
        undefined,
        h.cookie,
        "DELETE",
      )
    ).ok,
  ).toBe(true);
  expect((await request("/api/editor/questions", q, h.cookie)).ok).toBe(true);
  expect((await h.send("selectFinal", q.id)).ok).toBe(true);
  expect(
    (await request("/media/" + media.id, undefined, a.cookie)).status,
  ).toBe(403);
  expect((await request("/api/editor", undefined, a.cookie)).status).toBe(403);
  const hCookie = h.cookie,
    aCookie = a.cookie,
    bCookie = b.cookie;
  for (const socket of sockets) socket.disconnect();
  await runtime.close();
  await start();
  const host = await connect(hCookie, "host"),
    player = await connect(aCookie, "player"),
    other = await connect(bCookie, "player");
  expect(host.view.finalSelection?.id).toBe(q.id);
  expect(player.view.finalSelection).toBeUndefined();
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      const s = runtime.store.state;
      s.round = 6;
      s.phase = "intro";
      s.roster = s.players.map((p) => p.id);
      s.order = [...s.roster];
      s.players.forEach((p) => (p.score = 1000));
      return "Финал";
    }),
  );
  await waitFor(() => host.view.phase === "intro");
  const imagePath = resolve("uploads", media.filename);
  const movedImagePath = imagePath + ".test-unavailable";
  renameSync(imagePath, movedImagePath);
  try {
    expect((await host.send("begin")).ok).toBe(false);
    expect(runtime.store.state.phase).toBe("intro");
  } finally {
    renameSync(movedImagePath, imagePath);
  }
  expect((await host.send("begin")).ok).toBe(true);
  await waitFor(() => player.view.phase === "betting");
  const oldAttempt = player.view.finalAttemptId!;
  expect(
    (await request("/media/" + media.id, undefined, player.cookie)).status,
  ).toBe(403);
  expect(player.view.question).not.toHaveProperty("panorama");
  await player.send("bet", 100);
  await other.send("bet", 100);
  await waitFor(() => player.view.phase === "locating");
  expect(
    (await request("/media/" + media.id, undefined, player.cookie)).ok,
  ).toBe(true);
  expect(player.view.question?.panorama).toMatchObject({
    provider: "local",
    fileId: media.id,
  });
  expect(JSON.stringify(player.view.question)).not.toContain("Secret");
  expect(
    (
      await request(
        "/api/editor/questions",
        { ...q, place: "Changed" },
        host.cookie,
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await request(
        "/api/editor/questions/" + q.id,
        undefined,
        host.cookie,
        "DELETE",
      )
    ).ok,
  ).toBe(false);
  expect((await host.send("selectFinal", "demo-local-360")).ok).toBe(false);
  expect((await host.send("undo")).ok).toBe(false);
  expect((await host.send("cancelFinal")).ok).toBe(false);
  await player.send("country", "FR");
  await other.send("country", "DE");
  await player.send("confirmCountry");
  await other.send("confirmCountry");
  await waitFor(() => host.view.phase === "awaitingReveal");
  expect(host.view.countries).toEqual({});
  expect((await host.send("reveal")).ok).toBe(true);
  await waitFor(() => host.view.phase === "finished");
  expect(runtime.store.state.players.map((p) => p.score)).toEqual([1100, 900]);
  expect((await host.send("cancelFinal", "ОТМЕНИТЬ ФИНАЛ")).ok).toBe(true);
  await waitFor(() => host.view.phase === "intro");
  expect(runtime.store.state.players.map((p) => p.score)).toEqual([1000, 1000]);
  expect(runtime.store.state.bets).toEqual({});
  expect(runtime.store.state.countries).toEqual({});
  expect(
    (await request("/media/" + media.id, undefined, player.cookie)).status,
  ).toBe(403);
  expect((await host.send("undo")).ok).toBe(false);
  expect((await host.send("begin")).ok).toBe(false);
  const data = (await (
    await request("/api/editor", undefined, host.cookie)
  ).json()) as { panoramaUsage: Record<string, string> };
  expect(data.panoramaUsage[q.id]).toBeTruthy();
  expect(
    (
      await request(
        "/api/editor/questions",
        { ...q, active: false },
        host.cookie,
      )
    ).ok,
  ).toBe(true);
  expect((await host.send("selectFinal", q.id)).ok).toBe(false);
  expect((await request("/api/editor/questions", q, host.cookie)).ok).toBe(
    true,
  );
  expect((await host.send("selectFinal", q.id)).ok).toBe(true);
  expect((await host.send("begin")).ok).toBe(true);
  await waitFor(() => player.view.phase === "betting");
  const stale = (await player.socket.timeout(5000).emitWithAck("command", {
    id: randomUUID(),
    revision: player.view.revision,
    phase: "betting",
    finalAttemptId: oldAttempt,
    command: { type: "bet", value: 100, questionId: q.id },
  })) as Ack;
  expect(stale.ok).toBe(false);
  expect(runtime.store.state.bets).toEqual({});
});
it("панорамы: недоступный файл блокирует старт, прямой импорт блокирует внутренние адреса", async () => {
  const { h } = await room();
  const q = {
    ...runtime.store.bank.find((q) => q.round === 6)!,
    id: "missing-" + randomUUID(),
    panoramaFileId: "missing-file",
    license: "CC0",
  };
  expect((await request("/api/editor/questions", q, h.cookie)).ok).toBe(false);
  for (const url of [
    "https://127.0.0.1/p.jpg",
    "https://[::1]/p.jpg",
    "http://example.com/p.jpg",
  ]) {
    const response = await request(
      "/api/editor/panorama-import",
      { url },
      h.cookie,
    );
    expect(response.ok).toBe(false);
  }
  const unlicensed = {
    ...runtime.store.bank.find((q) => q.round === 6)!,
    id: "unlicensed-" + randomUUID(),
    panoramaFileId: undefined,
    license: "",
    active: false,
  };
  expect(
    (await request("/api/editor/questions", unlicensed, h.cookie)).ok,
  ).toBe(true);
  expect((await h.send("selectFinal", unlicensed.id)).ok).toBe(false);
});

it("импорт и массовое отключение синхронизируют сохранённый выбор финала", async () => {
  const { h } = await room();
  const original = runtime.store.bank.find((q) => q.round === 6)!;
  const q = {
    ...original,
    id: "sync-" + randomUUID(),
    title: "Первая локация",
    license: "CC0",
    active: true,
  };
  expect((await request("/api/editor/questions", q, h.cookie)).ok).toBe(true);
  expect((await h.send("selectFinal", q.id)).ok).toBe(true);
  const updated = {
    ...q,
    title: "Вторая локация",
    answer: "DE",
    place: "Новое место",
  };
  expect(
    (
      await request(
        "/api/editor/import",
        { version: 1, questions: [updated] },
        h.cookie,
      )
    ).ok,
  ).toBe(true);
  await waitFor(() => h.view.finalSelection?.title === "Вторая локация");
  expect(h.view.finalSelection?.answer).toBe("DE");
  const saved = JSON.parse(
    (await runtime.store.db.game.findUniqueOrThrow({ where: { id: "main" } }))
      .state,
  ) as { finalSelection: { answer: string } };
  expect(saved.finalSelection.answer).toBe("DE");
  expect(
    (
      await request(
        "/api/editor/bulk",
        { ids: [q.id], active: false },
        h.cookie,
      )
    ).ok,
  ).toBe(true);
  await waitFor(() => h.view.finalSelection === null);
  expect(
    (await request("/api/editor/bulk", { ids: [q.id], active: true }, h.cookie))
      .ok,
  ).toBe(true);
  expect((await h.send("selectFinal", q.id)).ok).toBe(true);
  expect(
    (
      await request(
        "/api/editor/questions/" + q.id,
        undefined,
        h.cookie,
        "DELETE",
      )
    ).ok,
  ).toBe(true);
  await waitFor(() => h.view.finalSelection === null);
});

it("миграция SQLite переносит камеру банка один раз и архивирует внешние записи", async () => {
  const { h } = await room();
  const db = runtime.store.db;
  const original = runtime.store.bank.find((q) => q.round === 6)!;
  const old = {
    ...original,
    id: "legacy-" + randomUUID(),
    camera: undefined,
    pano: "old-point",
    lat: 10,
    lng: 20,
  };
  await db.question.create({
    data: {
      id: old.id,
      round: 6,
      category: old.category,
      active: true,
      position: 0,
      data: JSON.stringify(old),
    },
  });
  const config = structuredClone(runtime.store.state.config);
  Object.assign(config.final, { heading: 270, pitch: 10, zoom: 2 });
  await db.setting.upsert({
    where: { id: "main" },
    create: { id: "main", data: JSON.stringify(config) },
    update: { data: JSON.stringify(config) },
  });
  await db.setting.delete({ where: { id: "local-panorama-provider-v1" } });
  const { migrateLocalPanoramas } =
    await import("../server/local-panorama-migration.js");
  await migrateLocalPanoramas(db);
  const migrated = JSON.parse(
    (await db.question.findUniqueOrThrow({ where: { id: old.id } })).data,
  );
  expect(migrated.camera).toMatchObject({ heading: -90, pitch: 10, zoom: 2 });
  expect(migrated).not.toHaveProperty("pano");
  expect(
    await db.setting.findUnique({
      where: { id: "panorama-archive:" + old.id },
    }),
  ).toBeTruthy();
  const row = await db.question.findUniqueOrThrow({ where: { id: old.id } });
  await migrateLocalPanoramas(db);
  expect(
    (await db.question.findUniqueOrThrow({ where: { id: old.id } })).data,
  ).toBe(row.data);
  await runtime.store.refreshBank();
  const invalid = {
    ...original,
    id: "legacy-disabled-" + randomUUID(),
    panoramaFileId: undefined,
    active: false,
  };
  expect((await request("/api/editor/questions", invalid, h.cookie)).ok).toBe(
    true,
  );
  expect(
    (
      await request(
        "/api/editor/bulk",
        { ids: [invalid.id], active: true },
        h.cookie,
      )
    ).ok,
  ).toBe(false);
});

it("вход ведущего и игрока через Vite сохраняет Origin, медиа и WebSocket работают", async () => {
  const { createServer, loadConfigFromFile } = await import("vite");
  const loaded = await loadConfigFromFile({
    command: "serve",
    mode: "development",
  });
  if (!loaded) throw Error("Нет конфигурации Vite");
  const config = loaded.config;
  const proxy = Object.fromEntries(
    Object.entries(config.server?.proxy ?? {}).map(([path, options]) => [
      path,
      typeof options === "string" ? base : { ...options, target: base },
    ]),
  );
  const dev = await createServer({
    ...config,
    configFile: false,
    cacheDir: resolve("node_modules/.vite-integration"),
    logLevel: "silent",
    server: {
      ...config.server,
      host: "127.0.0.1",
      port: 0,
      watch: null,
      proxy,
    },
  });
  try {
    await dev.listen();
    const origin =
      "http://127.0.0.1:" + (dev.httpServer!.address() as AddressInfo).port;
    const signIn = (role: string, password: string, requestOrigin = origin) =>
      fetch(origin + "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: requestOrigin },
        body: JSON.stringify({
          role,
          name: role === "host" ? "Ведущий" : "Игрок",
          password,
        }),
      });
    expect(
      (await signIn("host", hostPassword, "https://foreign.example")).status,
    ).toBe(403);
    const wrong = await signIn("host", "wrong");
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "Неверный пароль" });
    const host = await signIn("host", hostPassword);
    expect(host.ok).toBe(true);
    const cookie = host.headers.get("set-cookie")!.split(";")[0];
    expect((await signIn("player", playerPassword)).ok).toBe(true);
    const media = await fetch(origin + "/media/demo-local-panorama", {
      headers: { Cookie: cookie },
    });
    expect(media.ok).toBe(true);
    expect((await media.arrayBuffer()).byteLength).toBeGreaterThan(0);
    const socket = io(origin, {
      autoConnect: false,
      auth: { role: "host" },
      transports: ["websocket"],
      extraHeaders: { Origin: origin, Cookie: cookie },
    });
    sockets.push(socket);
    let view: GameView | undefined;
    socket.on("state", (state: GameView) => {
      view = state;
    });
    socket.connect();
    await waitFor(() => !!view);
    expect(view!.self.role).toBe("host");
    expect(view!.players).toHaveLength(1);
    socket.disconnect();
    await waitFor(() => runtime.io.engine.clientsCount === 0);
  } finally {
    await dev.close();
  }
});

it("OBS: сессия ведущего, серверное сокрытие секретов, фазовый доступ к медиа и запрет команд", async () => {
  const { h, a } = await room();
  const screen = await connect(h.cookie, "host", "obs");
  expect(screen.view.players).toHaveLength(2);
  expect(
    await runtime.store.db.session.count({ where: { role: "host" } }),
  ).toBe(1);
  expect(screen.view.self.playerId).toBeUndefined();
  const before = structuredClone(runtime.store.state);
  expect((await screen.send("joinOpen", false)).ok).toBe(false);
  expect(runtime.store.state).toEqual(before);
  const invalid = io(base, {
    autoConnect: false,
    auth: { role: "player", surface: "obs" },
    extraHeaders: { Cookie: a.cookie },
    transports: ["websocket"],
    reconnection: false,
  });
  sockets.push(invalid);
  const failure = new Promise<string>((resolve) =>
    invalid.once("connect_error", (e) => resolve(e.message)),
  );
  invalid.connect();
  expect(await failure).toContain("только ведущему");
  const final = runtime.store.bank.find((q) => q.round === 6)!;
  expect(final.round).toBe(6);
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      const s = runtime.store.state;
      s.finalSelection = final as typeof s.finalSelection;
      s.round = 5;
      s.roster = s.players.map((p) => p.id);
      s.order = [...s.roster];
      beginQuestion(
        s,
        runtime.store.bank.find((q) => q.round === 5)!,
        Date.now(),
      );
      return "OBS просмотр";
    }),
  );
  await waitFor(() => screen.view.phase === "studying");
  expect(screen.view.question).not.toHaveProperty("text");
  expect(screen.view.finalSelection).toBeUndefined();
  expect(screen.view.events).toEqual([]);
  const fileId = screen.view.question!.media!.fileId!;
  const image = await request("/api/obs-media/" + fileId, undefined, h.cookie);
  expect(image.ok).toBe(true);
  await image.arrayBuffer();
  expect(
    (await request("/api/obs-media/" + fileId, undefined, a.cookie)).status,
  ).toBe(403);
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      runtime.store.state.timer.deadline = Date.now() - 1;
      return "Таймер";
    }),
  );
  await waitFor(() => screen.view.phase === "buzzing");
  expect(screen.view.question?.media).toBeUndefined();
  expect(
    (await request("/api/obs-media/" + fileId, undefined, h.cookie)).status,
  ).toBe(403);
  expect(
    (await request("/API/OBS-MEDIA/" + fileId, undefined, h.cookie)).status,
  ).toBe(403);
  await a.send("buzz");
  await waitFor(
    () => screen.view.phase === "judging" && h.view.phase === "judging",
  );
  expect(h.view.judgingGuide).toBeDefined();
  expect(screen.view.judgingGuide).toBeUndefined();
  expect(screen.view.buzzes).toEqual([]);
  expect((await h.send("judge", true)).ok).toBe(true);
  await waitFor(() => screen.view.phase === "reveal");
  expect(screen.view.question?.answer).toBeDefined();
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      const s = runtime.store.state;
      s.round = 6;
      s.question = final;
      s.phase = "betting";
      s.timer = { deadline: null, remaining: null };
      s.bets = { [s.players[0].id]: 100 };
      s.countries = { [s.players[0].id]: { code: "FR", locked: true } };
      return "Ставки";
    }),
  );
  await waitFor(() => screen.view.phase === "betting");
  expect(screen.view.bets).toEqual({});
  expect(screen.view.countries).toEqual({});
  expect(screen.view.question?.panorama).toBeUndefined();
  expect(screen.view.question?.answer).toBeUndefined();
  const score = JSON.stringify(runtime.store.state.players);
  expect((await screen.send("reveal")).ok).toBe(false);
  expect(JSON.stringify(runtime.store.state.players)).toBe(score);
  await request("/api/logout", { role: "host" }, h.cookie);
  await waitFor(() => !screen.socket.connected);
});

it.each([0, 1, 2])(
  "Socket.IO разрешает старт с %s игроками без готовности",
  async (count) => {
    const h = await connect((await login("host", "Ведущий")).cookie, "host");
    for (let i = 0; i < count; i++) await login("player", "Участник " + i);
    await waitFor(() => h.view.players.length === count);
    expect(h.view.players.every((p) => !p.ready)).toBe(true);
    expect((await h.send("start")).ok).toBe(true);
    expect(runtime.store.state.phase).toBe("intro");
    expect(runtime.store.state.total).toBe(
      runtime.store.bank.filter((q) => q.active && q.round === 1).length,
    );
    expect((await h.send("begin")).ok).toBe(true);
    expect(
      (
        await h.send(
          "choose",
          runtime.store.bank.find((q) => q.round === 1)!.category,
        )
      ).ok,
    ).toBe(true);
    expect((await h.send("reveal")).ok).toBe(true);
  },
);

it("API сохраняет и проверяет пакет больше 51 задания без требований к категориям", async () => {
  const h = await login("host", "Ведущий");
  const questions = runtime.store.bank
    .filter(
      (q) =>
        q.active &&
        (q.round === 1 ||
          q.round === 2 ||
          (q.round === 3 && q.formatVersion === 2)),
    )
    .slice(0, 52);
  expect(questions).toHaveLength(52);
  const id = "unlimited-" + randomUUID();
  try {
    const response = await request(
      "/api/editor/packages",
      {
        id,
        name: "Любое число заданий",
        questionIds: questions.map((q) => q.id),
      },
      h.cookie,
    );
    expect(response.status).toBe(200);
    const pack = await response.json();
    expect(pack.questionIds).toHaveLength(52);
    expect(pack.issues).toEqual([]);
    const check = await request(
      `/api/editor/packages/${id}/check`,
      undefined,
      h.cookie,
    );
    expect((await check.json()).issues).toEqual([]);
  } finally {
    await request(`/api/editor/packages/${id}`, undefined, h.cookie, "DELETE");
  }
});

it("импортированный вопрос нового формата доступен в старой партии после восстановления SQLite", async () => {
  const h = await connect((await login("host", "Ведущий")).cookie, "host");
  const bank = runtime.store.bank;
  const q = bank.find(
    (q) => q.round === 2 && q.active && q.formatVersion === 2,
  )!;
  try {
    runtime.store.bank = [q];
    expect((await h.send("start")).ok).toBe(true);
    expect(runtime.store.state.total).toBe(0);
    expect((await h.send("begin")).ok).toBe(true);
    await waitFor(() => h.view.round === 2);
    expect(h.view.total).toBe(1);
    expect(h.view.warnings).toEqual([]);
    expect(h.view.board.map((q) => q.id)).toEqual([q.id]);
    const restored = new Store(runtime.store.db);
    await restored.init(false);
    expect(restored.state.round).toBe(2);
    expect(restored.state.boardIds).toContain(q.id);
    expect((await h.send("begin")).ok).toBe(true);
    expect((await h.send("choose", q.category)).ok).toBe(true);
    expect(runtime.store.state.question?.id).toBe(q.id);
  } finally {
    runtime.store.bank = bank;
  }
});

it("названия раундов: только ведущий, синхронизация, undo, restart и reset", async () => {
  const { h, a } = await room();
  expect((await h.send("start")).ok).toBe(true);
  expect((await h.send("begin")).ok).toBe(true);
  const names = {
    ...h.view.config.roundNames,
    1: "Числа в эфире",
    6: "Найди страну",
  };
  expect(
    (await request("/api/editor/round-names", names, a.cookie)).status,
  ).toBe(403);
  expect(
    (await request("/api/editor/round-names", { ...names, 1: " " }, h.cookie))
      .ok,
  ).toBe(false);
  expect((await request("/api/editor/round-names", names, h.cookie)).ok).toBe(
    true,
  );
  await waitFor(() => a.view.config.roundNames[1] === names[1]);
  expect((await h.send("undo")).ok).toBe(true);
  expect(runtime.store.state.config.roundNames).toEqual(names);
  const cookie = h.cookie;
  for (const socket of sockets) socket.disconnect();
  await runtime.close();
  await start();
  const again = await connect(cookie, "host");
  expect(again.view.config.roundNames).toEqual(names);
  expect((await again.send("reset", "СБРОС")).ok).toBe(true);
  expect(runtime.store.state.config.roundNames).toEqual(names);
  const saved = await runtime.store.db.setting.findUniqueOrThrow({
    where: { id: "main" },
  });
  expect(JSON.parse(saved.data).roundNames).toEqual(names);
});

it("старая партия и история без названий загружаются без сброса", async () => {
  const { h } = await room();
  expect((await h.send("start")).ok).toBe(true);
  expect((await h.send("begin")).ok).toBe(true);
  const row = await runtime.store.db.game.findUniqueOrThrow({
    where: { id: "main" },
  });
  const state = JSON.parse(row.state);
  const history = JSON.parse(row.history);
  delete state.config.roundNames;
  for (const old of history) delete old.config.roundNames;
  await runtime.store.db.game.update({
    where: { id: "main" },
    data: { state: JSON.stringify(state), history: JSON.stringify(history) },
  });
  const cookie = h.cookie;
  for (const socket of sockets) socket.disconnect();
  await runtime.close();
  await start();
  const again = await connect(cookie, "host");
  expect(again.view.phase).toBe("choosing");
  expect(again.view.players).toHaveLength(2);
  expect(again.view.config.roundNames[1]).toBe("Больше-меньше");
  expect((await again.send("undo")).ok).toBe(true);
  expect(runtime.store.state.config.roundNames[6]).toBe("Где это?");
});

it.each([true, false])(
  "вопрос без скрытых полей сохраняется, ячейки 100/200/300 распределяются сервером (активен: %s)",
  async (active) => {
    const { h } = await room();
    const plain = {
      ...runtime.store.bank.find((q) => q.round === 1)!,
      id: randomUUID(),
      category: "Без источника",
      source: undefined,
      value: undefined,
      difficulty: undefined,
      position: undefined,
      autoPlacement: true,
    };
    expect((await request("/api/editor/questions", plain, h.cookie)).ok).toBe(
      true,
    );
    expect(runtime.store.bank.find((q) => q.id === plain.id)?.source).toBe("");
    const template = runtime.store.bank.find((q) => q.round === 4)!;
    const ids: string[] = Array.from({ length: 3 }, () => randomUUID());
    const responses = await Promise.all(
      ids.map((id) =>
        request(
          "/api/editor/questions",
          {
            ...template,
            id,
            category: "Автоматическое поле " + active,
            active,
            source: undefined,
            value: undefined,
            difficulty: undefined,
            position: undefined,
            autoPlacement: true,
          },
          h.cookie,
        ),
      ),
    );
    expect(responses.every((response) => response.ok)).toBe(true);
    const questions = runtime.store.bank
      .filter((q) => ids.includes(q.id))
      .sort((a, b) => a.position - b.position);
    expect(questions.map((q) => q.value)).toEqual([100, 200, 300]);
    expect(questions.map((q) => q.position)).toEqual([0, 1, 2]);
    const edited = {
      ...questions[1],
      text: "Изменён только текст",
      autoPlacement: true,
    };
    expect((await request("/api/editor/questions", edited, h.cookie)).ok).toBe(
      true,
    );
    expect(runtime.store.bank.find((q) => q.id === edited.id)).toMatchObject({
      value: 200,
      position: 1,
      difficulty: 1,
      text: edited.text,
    });
  },
);

it("перезапуск раунда сохраняется в SQLite, повторы и запоздавшие действия безопасны", async () => {
  const { h, a } = await room();
  expect((await h.send("start")).ok).toBe(true);
  expect((await h.send("begin")).ok).toBe(true);
  expect((await h.send("choose", h.view.board[0].category)).ok).toBe(true);
  const oldEpoch = h.view.roundEpoch;
  expect(
    (
      await h.send("score", {
        playerId: a.view.self.playerId,
        amount: 99,
        reason: "Ручная поправка",
      })
    ).ok,
  ).toBe(true);
  const envelope = {
    id: randomUUID(),
    revision: h.view.revision,
    phase: h.view.phase,
    roundEpoch: h.view.roundEpoch,
    finalAttemptId: null,
    command: {
      type: "restartRound",
      value: "НАЧАТЬ РАУНД ЗАНОВО",
      questionId: h.view.question?.id,
    },
  };
  expect((await h.socket.emitWithAck("command", envelope)).ok).toBe(true);
  await waitFor(() => h.view.phase === "intro");
  expect(h.view.roundEpoch).not.toBe(oldEpoch);
  expect(h.view.players.find((p) => p.id === a.view.self.playerId)?.score).toBe(
    99,
  );
  expect((await h.socket.emitWithAck("command", envelope)).ok).toBe(true);
  const savedEpoch = h.view.roundEpoch;
  const cookie = h.cookie;
  await runtime.close();
  await start();
  const restored = await connect(cookie, "host");
  expect(restored.view.roundEpoch).toBe(savedEpoch);
  expect((await restored.socket.emitWithAck("command", envelope)).ok).toBe(
    true,
  );
  const stale = await restored.socket.emitWithAck("command", {
    ...envelope,
    id: randomUUID(),
    revision: restored.view.revision,
    phase: restored.view.phase,
    command: { type: "begin" },
  });
  expect(stale.ok).toBe(false);
  expect((await restored.send("begin")).ok).toBe(true);
  expect((await restored.send("nextRound", "СЛЕДУЮЩИЙ РАУНД")).ok).toBe(true);
  await waitFor(() => restored.view.round === 2);
  expect(
    restored.view.players.find((p) => p.id === a.view.self.playerId)?.score,
  ).toBe(99);
});

it.each([1, 2])(
  "новая партия v%s сохраняет сессии и SQLite, отклоняет старые команды",
  async (version) => {
    const { h, a, b } = version === 2 ? await newRulesRoom() : await room();
    if (version === 1) expect((await h.send("start")).ok).toBe(true);
    await waitFor(() => a.view.phase === "intro" && b.view.phase === "intro");
    const players = h.view.players.map(({ id, name, color }) => ({
      id,
      name,
      color,
    }));
    const order = [...h.view.order];
    b.socket.disconnect();
    await waitFor(
      () =>
        !h.view.players.find((p) => p.id === b.view.self.playerId)?.connected,
    );
    expect((await a.send("restartGame", "НАЧАТЬ ИГРУ ЗАНОВО")).ok).toBe(false);
    expect((await h.send("restartGame")).ok).toBe(false);
    expect(
      (
        await h.send("score", {
          playerId: players[0].id,
          amount: 777,
          reason: "До перезапуска",
        })
      ).ok,
    ).toBe(true);
    expect((await h.send("begin")).ok).toBe(true);
    expect(
      (
        await h.send(
          "choose",
          version === 2 ? h.view.board[0].id : h.view.board[0].category,
        )
      ).ok,
    ).toBe(true);
    const envelope = {
      id: randomUUID(),
      revision: h.view.revision,
      phase: h.view.phase,
      roundEpoch: h.view.roundEpoch,
      finalAttemptId: h.view.finalAttemptId,
      command: { type: "restartGame", value: "НАЧАТЬ ИГРУ ЗАНОВО" },
    };
    const staleScore = {
      ...envelope,
      id: randomUUID(),
      command: {
        type: "score",
        value: {
          playerId: players[0].id,
          amount: 999,
          reason: "Запоздавшая поправка",
        },
      },
    };
    expect((await h.socket.emitWithAck("command", envelope)).ok).toBe(true);
    await waitFor(() => h.view.phase === "intro" && a.view.phase === "intro");
    expect(h.view.round).toBe(1);
    expect(
      h.view.players.map(({ id, name, color }) => ({ id, name, color })),
    ).toEqual(players);
    expect(h.view.players.map((p) => p.score)).toEqual([0, 0]);
    expect(h.view.order).toEqual(order);
    expect(h.view.roundEpoch).not.toBe(envelope.roundEpoch);
    expect(runtime.store.history).toEqual([]);
    expect((await h.send("undo")).ok).toBe(false);
    expect((await h.socket.emitWithAck("command", staleScore)).ok).toBe(false);
    expect(
      (
        await h.socket.emitWithAck("command", {
          ...staleScore,
          id: randomUUID(),
          command: { type: "joinOpen", value: true },
        })
      ).ok,
    ).toBe(false);
    expect(
      (await h.socket.emitWithAck("command", { ...envelope, id: randomUUID() }))
        .ok,
    ).toBe(false);
    expect(
      (
        await h.send("score", {
          playerId: players[0].id,
          amount: 33,
          reason: "После перезапуска",
        })
      ).ok,
    ).toBe(true);
    expect((await h.socket.emitWithAck("command", envelope)).ok).toBe(true);
    expect(h.view.players[0].score).toBe(33);
    const epoch = h.view.roundEpoch;
    await runtime.close();
    await start();
    const restored = await connect(h.cookie, "host");
    const returned = await connect(b.cookie, "player");
    expect(restored.view.phase).toBe("intro");
    expect(restored.view.roundEpoch).toBe(epoch);
    expect(returned.view.self.playerId).toBe(b.view.self.playerId);
    expect(returned.view.players.map((p) => p.score)).toEqual([33, 0]);
    expect((await restored.socket.emitWithAck("command", envelope)).ok).toBe(
      true,
    );
    expect(restored.view.players[0].score).toBe(33);
    expect((await restored.send("begin")).ok).toBe(true);
  },
);

async function newRulesRoom() {
  const peers = await room();
  await runtime.store.serial(async () => {
    for (const q of runtime.store.packages.find((p) => p.id === "demo-v2-51")!
      .questions)
      await runtime.store.db.question.update({
        where: { id: q.id },
        data: { data: JSON.stringify(q), active: q.active },
      });
    await runtime.store.refreshBank();
    await runtime.store.mutate(() => {
      runtime.store.state.config = upgradeConfig();
      return "Новые правила теста";
    });
  });
  expect(
    (await request("/api/editor/packages/demo-v2-51/use", {}, peers.h.cookie))
      .ok,
  ).toBe(true);
  expect((await peers.h.send("selectFinal", "demo-v2-geography")).ok).toBe(
    true,
  );
  expect((await peers.h.send("start")).ok).toBe(true);
  return peers;
}
it("пакет v2: полнота, права черновиков, отдельный фрагмент и immutable снимок", async () => {
  const { h, a } = await newRulesRoom();
  const pack = runtime.store.state.packageSnapshot!;
  expect(pack.questions).toHaveLength(51);
  const check = await request(
    "/api/editor/packages/demo-v2-51/check",
    undefined,
    h.cookie,
  );
  expect((await check.json()).issues).toEqual([]);
  expect(
    (await request("/api/editor/packages/demo-v2-51", undefined, a.cookie))
      .status,
  ).toBe(403);
  const draft = { id: randomUUID(), round: 4, text: "Пока без картинки" };
  expect((await request("/api/editor/drafts", draft, h.cookie)).ok).toBe(true);
  expect((await request("/api/editor/drafts", draft, a.cookie)).status).toBe(
    403,
  );
  const future = pack.questions.find((q) => q.round === 3)!;
  const changed = { ...future, text: "Редактор изменил будущую цитату" };
  expect((await request("/api/editor/questions", changed, h.cookie)).ok).toBe(
    true,
  );
  expect(
    runtime.store.state.packageSnapshot!.questions.find(
      (q) => q.id === future.id,
    )?.text,
  ).toBe(future.text);
  const final = pack.questions.find((q) => q.round === 6)!;
  expect(
    (
      await request(
        "/api/editor/questions",
        { ...final, place: "Изменено в банке" },
        h.cookie,
      )
    ).ok,
  ).toBe(true);
  expect(runtime.store.state.finalSelection?.place).toBe(
    final.round === 6 ? final.place : "",
  );
  for (let r = 1; r < 4; r++)
    expect((await h.send("nextRound", "СЛЕДУЮЩИЙ РАУНД")).ok).toBe(true);
  expect((await h.send("begin")).ok).toBe(true);
  expect((await h.send("choose", h.view.board[0].id)).ok).toBe(true);
  const q = runtime.store.state.question!;
  if (q.round !== 4) throw Error("fixture");
  expect(h.view.question?.media?.fileId).not.toBe(q.media.fileId);
  expect(
    (
      await request(
        "/media/" + h.view.question?.media?.fileId,
        undefined,
        a.cookie,
      )
    ).ok,
  ).toBe(true);
  expect(
    (await request("/media/" + q.fullImageFileId, undefined, a.cookie)).status,
  ).toBe(403);
  expect((await request("/api/editor/questions", q, h.cookie)).ok).toBe(false);
  expect(
    (
      await request(
        "/api/editor/media/" + q.fullImageFileId,
        undefined,
        h.cookie,
        "DELETE",
      )
    ).ok,
  ).toBe(false);
  expect((await h.send("reveal", "ЗАВЕРШИТЬ ОЖИДАНИЕ")).ok).toBe(true);
  expect(
    (
      await request(
        "/media/" + h.view.question?.media?.fileId,
        undefined,
        a.cookie,
      )
    ).ok,
  ).toBe(true);
});
it("v2 OBS, память, одновременные нажатия, судейство и повторы после перезапуска", async () => {
  const { h, a, b } = await newRulesRoom();
  const screen = await connect(h.cookie, "host", "obs");
  for (let r = 1; r < 5; r++)
    expect((await h.send("nextRound", "СЛЕДУЮЩИЙ РАУНД")).ok).toBe(true);
  expect((await h.send("begin")).ok).toBe(true);
  expect((await h.send("choose", h.view.board[0].id)).ok).toBe(true);
  await waitFor(() => screen.view.phase === "studying");
  expect(screen.view.question?.text).toBeUndefined();
  expect(screen.view.question?.category).toBe("Задание на память");
  const media = h.view.question?.media?.fileId;
  expect(media).toBeTruthy();
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      expire(runtime.store.state, runtime.store.state.timer.deadline!);
      return "Тест 30 секунд";
    }),
  );
  await waitFor(
    () => a.view.phase === "buzzing" && screen.view.phase === "buzzing",
  );
  expect(screen.view.question?.media).toBeUndefined();
  expect((await request("/media/" + media, undefined, a.cookie)).status).toBe(
    403,
  );
  const race = await Promise.all([a.send("buzz"), b.send("buzz")]);
  expect(race.every((x) => x.ok)).toBe(true);
  expect(h.view.buzzWinner).toBeTruthy();
  expect(h.view.buzzes.filter((x) => x.accepted)).toHaveLength(1);
  expect(screen.view.judgingGuide).toBeUndefined();
  const event = {
    id: randomUUID(),
    revision: h.view.revision,
    phase: h.view.phase,
    roundEpoch: h.view.roundEpoch,
    finalAttemptId: null,
    buzzWinner: h.view.buzzWinner,
    decisionToken: h.view.decisionToken,
    command: { type: "judge", value: true, questionId: h.view.question?.id },
  };
  expect((await h.socket.emitWithAck("command", event)).ok).toBe(true);
  const scored = h.view.players.map((p) => p.score);
  expect(scored.reduce((a, b) => a + b, 0)).toBe(1000);
  const cookie = h.cookie;
  await runtime.close();
  await start();
  const restored = await connect(cookie, "host");
  expect((await restored.socket.emitWithAck("command", event)).ok).toBe(true);
  expect(restored.view.players.map((p) => p.score)).toEqual(scored);
  expect((await restored.send("undoDecision")).ok).toBe(true);
  expect(
    (
      await restored.socket.emitWithAck("command", {
        ...event,
        id: randomUUID(),
      })
    ).ok,
  ).toBe(false);
});

it("импорт готовой пары изображений проверяет наличие файлов и защищает полный ответ", async () => {
  const { h, a } = await room();
  const source = runtime.store.bank.find((q) => q.id === "demo-v2-fragment-0")!;
  if (source.round !== 4) throw Error("fixture");
  const question = {
    ...source,
    id: "provided-pair",
    suppliedFragment: true,
    crop: undefined,
  };
  expect(
    (
      await request(
        "/api/editor/import",
        { version: 1, questions: [question] },
        a.cookie,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        "/api/editor/import",
        {
          version: 1,
          questions: [{ ...question, fullImageFileId: "missing" }],
        },
        h.cookie,
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await request(
        "/api/editor/import",
        { version: 1, questions: [question] },
        h.cookie,
      )
    ).ok,
  ).toBe(true);
  expect(runtime.store.bank.find((q) => q.id === question.id)).toMatchObject({
    suppliedFragment: true,
  });
  expect(
    (await request("/media/" + question.fullImageFileId, undefined, a.cookie))
      .status,
  ).toBe(403);
  expect(
    (await request("/media/" + question.media.fileId, undefined, a.cookie))
      .status,
  ).toBe(403);
});

it("кадрирование создаёт отдельный проверенный файл и недоступно игрокам", async () => {
  const { h, a } = await room();
  const q = runtime.store.packages
    .find((p) => p.id === "demo-v2-51")!
    .questions.find((q) => q.round === 4)!;
  if (q.round !== 4) throw Error("fixture");
  const input = {
    sourceId: q.fullImageFileId,
    crop: { x: 0.1, y: 0.2, width: 0.4, height: 0.5 },
  };
  expect((await request("/api/editor/crop", input, a.cookie)).status).toBe(403);
  expect(
    (
      await request(
        "/api/editor/crop",
        { ...input, crop: { ...input.crop, x: 0.9 } },
        h.cookie,
      )
    ).ok,
  ).toBe(false);
  const result = await request("/api/editor/crop", input, h.cookie);
  expect(result.ok).toBe(true);
  const fragment = (await result.json()) as MediaRow;
  expect(fragment.id).not.toBe(input.sourceId);
  const bytes = Buffer.from(
    await (
      await request("/media/" + fragment.id, undefined, h.cookie)
    ).arrayBuffer(),
  );
  expect(await sharp(bytes).metadata()).toMatchObject({
    width: 320,
    height: 250,
    format: "png",
  });
  const question = {
    ...q,
    id: "test-prepared-fragment",
    crop: input.crop,
    media: { ...q.media, fileId: fragment.id },
  };
  expect(
    (
      await request(
        "/api/editor/questions",
        { ...question, crop: { ...input.crop, x: 0.2 } },
        h.cookie,
      )
    ).ok,
  ).toBe(false);
  expect((await request("/api/editor/questions", question, h.cookie)).ok).toBe(
    true,
  );
  expect(
    (await request("/media/" + fragment.id, undefined, a.cookie)).status,
  ).toBe(403);
});
it("обновление сохраняет текущую старую партию, а лобби архивирует и переводит на v2", async () => {
  const { h } = await room();
  expect((await h.send("start")).ok).toBe(true);
  const active = new Store(runtime.store.db);
  await active.init();
  expect(active.state.config.rulesVersion).toBe(1);
  expect(active.state.phase).toBe("intro");
  expect((await h.send("reset", "СБРОС")).ok).toBe(true);
  const lobby = new Store(runtime.store.db);
  await lobby.init();
  expect(lobby.state.config.rulesVersion).toBe(2);
  expect(lobby.state.players).toHaveLength(2);
  expect(lobby.state.phase).toBe("lobby");
  expect(
    await runtime.store.db.setting.count({
      where: { id: { startsWith: "rules-v2-archive:" } },
    }),
  ).toBeGreaterThan(0);
});
it("ответы всех десяти учебных кадров соответствуют числу кругов в PNG", async () => {
  const questions = runtime.store.packages
    .find((p) => p.id === "demo-v2-51")!
    .questions.filter((q) => q.round === 5);
  for (const q of questions) {
    const row = await runtime.store.db.media.findUniqueOrThrow({
      where: { id: q.media.fileId },
    });
    const { data, info } = await sharp(resolve("uploads", row.filename))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = new Uint8Array(info.width * info.height);
    for (let i = 0; i < pixels.length; i++)
      pixels[i] = +(
        data[i * 3] === 255 &&
        data[i * 3 + 1] === 202 &&
        data[i * 3 + 2] === 89
      );
    let count = 0;
    for (let i = 0; i < pixels.length; i++) {
      if (!pixels[i]) continue;
      count++;
      const stack = [i];
      pixels[i] = 0;
      while (stack.length) {
        const at = stack.pop()!;
        for (const next of [at - 1, at + 1, at - info.width, at + info.width]) {
          if (next >= 0 && next < pixels.length && pixels[next]) {
            pixels[next] = 0;
            stack.push(next);
          }
        }
      }
    }
    expect(count, q.id).toBe(Number(q.answer));
  }
});

it("старая сохранённая партия разрешает ставку всем счётом без сброса ответов", async () => {
  const { a, b } = await room();
  const cookies = [a.cookie, b.cookie];
  const ids = [a.view.self.playerId!, b.view.self.playerId!];
  await runtime.store.serial(async () => {
    const s = runtime.store.state;
    s.players.forEach((p) => {
      p.score = 1100;
    });
    s.round = 6;
    s.roster = s.order = ids;
    beginQuestion(
      s,
      runtime.store.bank.find((q) => q.round === 6)!,
      Date.now(),
    );
    s.config.final.betLimit = 0.5;
    s.bets[ids[0]] = 400;
    s.timer = { deadline: null, remaining: 30000 };
    runtime.store.history = [structuredClone(s)];
    await runtime.store.save("Сохранение прежнего лимита");
  });
  const attempt = runtime.store.state.finalAttemptId;
  await runtime.close();
  await start();
  const player = await connect(cookies[1], "player");
  expect(player.view.config.final.betLimit).toBe(1);
  expect(player.view.players.map((p) => p.score)).toEqual([1100, 1100]);
  expect(runtime.store.state.bets).toEqual({ [ids[0]]: 400 });
  expect(runtime.store.state.finalAttemptId).toBe(attempt);
  expect(runtime.store.history[0].config.final.betLimit).toBe(1);
  expect((await player.send("bet", 1101)).ok).toBe(false);
  expect((await player.send("bet", 1100)).ok).toBe(true);
  const saved = await runtime.store.db.game.findUniqueOrThrow({
    where: { id: "main" },
  });
  expect(JSON.parse(saved.state).config.final.betLimit).toBe(1);
  expect(JSON.parse(saved.state).bets).toEqual({
    [ids[0]]: 400,
    [ids[1]]: 1100,
  });
});

it("финал ждёт ведущего после перезапуска; панорама доступна, раскрытие начисляет один раз", async () => {
  const { h, a, b } = await newRulesRoom();
  for (let i = 1; i < 6; i++)
    expect((await h.send("nextRound", "СЛЕДУЮЩИЙ РАУНД")).ok).toBe(true);
  for (const p of h.view.players)
    expect(
      (
        await h.send("score", {
          playerId: p.id,
          amount: 1000,
          reason: "Тест финала",
        })
      ).ok,
    ).toBe(true);
  expect((await h.send("begin")).ok).toBe(true);
  await waitFor(() => a.view.phase === "betting" && b.view.phase === "betting");
  expect((await a.send("bet", 0)).ok).toBe(true);
  expect((await b.send("bet", 100)).ok).toBe(true);
  await waitFor(
    () =>
      h.view.phase === "loadingPanorama" &&
      a.view.phase === "loadingPanorama" &&
      b.view.phase === "loadingPanorama",
  );
  await h.send("panoramaReady");
  await a.send("panoramaReady");
  await b.send("panoramaReady");
  await waitFor(
    () => a.view.phase === "locating" && b.view.phase === "locating",
  );
  await a.send("country", {
    code: "RU",
    point: { latitude: 55.75, longitude: 37.62 },
  });
  await b.send("country", {
    code: "ZA",
    point: { latitude: -30, longitude: 25 },
  });
  await a.send("confirmCountry");
  await b.send("confirmCountry");
  await waitFor(() => h.view.phase === "awaitingReveal");
  const hostCookie = h.cookie,
    playerCookie = a.cookie;
  await runtime.close();
  await start();
  const host = await connect(hostCookie, "host"),
    player = await connect(playerCookie, "player");
  const obs = await connect(hostCookie, "host", "obs");
  for (const peer of [host, player, obs]) {
    expect(peer.view.phase).toBe("awaitingReveal");
    expect(peer.view.question?.answer).toBeUndefined();
    expect(peer.view.finalCorrect).toBeUndefined();
    expect(peer.view.countries[b.view.self.playerId!]).toBeUndefined();
    expect(peer.view.timer.deadline).toBeNull();
    expect(peer.view.players.map((p) => p.score)).toEqual([1000, 1000]);
  }
  expect(
    (
      await request(
        "/media/" + player.view.question?.panorama?.fileId,
        undefined,
        playerCookie,
      )
    ).ok,
  ).toBe(true);
  expect((await player.send("reveal")).ok).toBe(false);
  const event = {
    id: randomUUID(),
    revision: host.view.revision,
    phase: host.view.phase,
    roundEpoch: host.view.roundEpoch,
    finalAttemptId: host.view.finalAttemptId,
    command: { type: "reveal", questionId: host.view.question?.id },
  };
  expect((await host.socket.emitWithAck("command", event)).ok).toBe(true);
  await waitFor(() => host.view.phase === "finished");
  expect(host.view.players.map((p) => p.score)).toEqual([1000, 1100]);
  expect(host.view.finalCorrect).toEqual({
    [a.view.self.playerId!]: false,
    [b.view.self.playerId!]: true,
  });
  expect((await host.socket.emitWithAck("command", event)).ok).toBe(true);
  expect(host.view.players.map((p) => p.score)).toEqual([1000, 1100]);
});

it("ручной выбор внешней панорамы v2 сохраняется после перезапуска без изменения пакета", async () => {
  const { h, a } = await newRulesRoom();
  const originalSnapshot = structuredClone(runtime.store.state.packageSnapshot);
  const final = runtime.store.state.finalSelection!;
  const q = {
    ...final,
    id: "external-rio-" + randomUUID(),
    title: "Секретное Рио",
    place: "Секретное место",
    answer: "BR",
    location: { latitude: -22.9519, longitude: -43.2105 },
  };
  expect((await request("/api/editor/questions", q, h.cookie)).ok).toBe(true);
  expect((await h.send("begin")).ok).toBe(true);
  expect((await h.send("choose", h.view.board[0].id)).ok).toBe(true);
  expect((await h.send("pause")).ok).toBe(true);
  const board = structuredClone(h.view.board),
    question = h.view.question?.id;
  expect((await h.send("selectFinal", q.id)).ok).toBe(true);
  expect(h.view.board).toEqual(board);
  expect(runtime.store.state.packageSnapshot).toEqual(originalSnapshot);
  await runtime.close();
  await start();
  const host = await connect(h.cookie, "host"),
    player = await connect(a.cookie, "player");
  expect(host.view.finalSelection?.id).toBe(q.id);
  expect(host.view.question?.id).toBe(question);
  expect(host.view.paused).toBe(true);
  expect(player.view.finalSelection).toBeUndefined();
  expect(JSON.stringify(player.view)).not.toContain("Секретное");
  for (let round = 1; round < 6; round++)
    expect((await host.send("nextRound", "СЛЕДУЮЩИЙ РАУНД")).ok).toBe(true);
  expect((await host.send("begin")).ok).toBe(true);
  expect(runtime.store.state.question?.id).toBe(q.id);
  expect(
    runtime.store.state.packageSnapshot?.questions.filter((q) => q.round !== 6),
  ).toEqual(originalSnapshot!.questions.filter((q) => q.round !== 6));
});
