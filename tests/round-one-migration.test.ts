import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import { demoQuestions } from "../server/content.js";
import { initialState, joinPlayer, captureRoundStart } from "../server/game.js";
import { Store } from "../server/store.js";
import {
  migrateRoundOneContent,
  roundOneQuestions,
  ROUND_ONE_REPLACEMENT,
} from "../server/round-one-content.js";
import { v2Fixture } from "./v2-fixture.js";
let db: PrismaClient;
let folder: string;
beforeAll(async () => {
  mkdirSync(".local", { recursive: true });
  folder = mkdtempSync(resolve(".local", "round-one-migration-"));
  const file = join(folder, "quiz.db");
  writeFileSync(file, "");
  const url = "file:" + file.replaceAll("\\", "/");
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  db = new PrismaClient({ datasourceUrl: url });
}, 30000);
afterAll(async () => {
  await db?.$disconnect();
  if (folder?.startsWith(resolve(".local") + sep))
    rmSync(folder, { recursive: true, force: true });
});
it("одноразовая замена в SQLite: резервная копия, 10 вопросов, сохранение остальных раундов и очков", async () => {
  const bank = demoQuestions();
  for (const q of bank)
    await db.question.create({
      data: {
        id: q.id,
        round: q.round,
        category: q.category,
        active: q.active,
        position: q.position,
        data: JSON.stringify(q),
      },
    });
  const pack = v2Fixture().state.packageSnapshot!;
  const s = initialState();
  const p = joinPlayer(s, "Участник");
  p.score = 600;
  s.round = 1;
  s.phase = "choosing";
  s.completed = 3;
  s.order = [p.id];
  s.roster = [p.id];
  s.config.roundNames[1] = "Коридор";
  s.boardIds = bank.filter((q) => q.round === 1).map((q) => q.id);
  s.used = s.boardIds.slice(0, 3);
  captureRoundStart(s);
  s.roundCheckpoint!.awards[p.id] = 600;
  const final = bank.find((q) => q.round === 6)!;
  if (final.round === 6) s.finalSelection = final;
  await db.game.create({
    data: {
      id: "main",
      state: JSON.stringify(s),
      history: JSON.stringify([s]),
    },
  });
  await db.setting.createMany({
    data: [
      { id: "main", data: JSON.stringify(s.config) },
      { id: "package:test", data: JSON.stringify(pack) },
    ],
  });
  await db.session.create({
    data: {
      id: "keep-session",
      role: "player",
      name: p.name,
      playerId: p.id,
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const sessionsBefore = await db.session.findMany();
  const others = await db.question.findMany({
    where: { round: { not: 1 } },
    orderBy: { id: "asc" },
  });
  expect(await migrateRoundOneContent(db, folder)).toBe(false);
  await db.setting.create({
    data: { id: "content-import:docx1-20260920", data: "{}" },
  });
  expect(await migrateRoundOneContent(db, folder)).toBe(true);
  const rows = await db.question.findMany({
    where: { round: 1 },
    orderBy: { position: "asc" },
  });
  expect(rows.map((q) => JSON.parse(q.data))).toEqual(roundOneQuestions);
  expect(
    await db.question.findMany({
      where: { round: { not: 1 } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(others);
  expect(await db.session.findMany()).toEqual(sessionsBefore);
  const updatedPack = JSON.parse(
    (await db.setting.findUniqueOrThrow({ where: { id: "package:test" } }))
      .data,
  );
  expect(
    updatedPack.questions.filter((q: { round: number }) => q.round !== 1),
  ).toEqual(pack.questions.filter((q) => q.round !== 1));
  expect(
    updatedPack.questions.filter((q: { round: number }) => q.round === 1),
  ).toEqual(roundOneQuestions);
  const game = await db.game.findUniqueOrThrow({ where: { id: "main" } });
  expect(JSON.parse(game.history)).toEqual([]);
  const restored = new Store(db);
  await restored.init(false);
  expect(restored.state.players).toEqual(s.players);
  expect(restored.state.finalSelection).toMatchObject({ id: final.id });
  expect(restored.state.total).toBe(10);
  expect(restored.state.phase).toBe("intro");
  expect(restored.state.config.roundNames[1]).toBe("Больше-меньше");
  const marker = JSON.parse(
    (
      await db.setting.findUniqueOrThrow({
        where: { id: ROUND_ONE_REPLACEMENT },
      })
    ).data,
  );
  expect(existsSync(marker.backup)).toBe(true);
  const backup = new PrismaClient({
    datasourceUrl: "file:" + marker.backup.replaceAll("\\", "/"),
  });
  try {
    expect(await backup.question.count({ where: { round: 1 } })).toBe(12);
  } finally {
    await backup.$disconnect();
  }
  await db.question.delete({ where: { id: roundOneQuestions[0].id } });
  expect(await migrateRoundOneContent(db, folder)).toBe(false);
  expect(await db.question.count({ where: { round: 1 } })).toBe(9);
  expect(
    (await db.game.findUniqueOrThrow({ where: { id: "main" } })).state,
  ).toBe(game.state);
});
