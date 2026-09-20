import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import rawQuestions from "./content/round-one-docx.json" with { type: "json" };
import { questionSchema, type Question } from "../shared/content.js";
import { packageSchema, type GamePackage } from "../shared/packages.js";
import type { Config } from "../shared/config.js";
import type { GameState } from "../shared/types.js";
import { captureRoundStart, clearQuestion, initialState } from "./game.js";

export const ROUND_ONE_TITLE = "Больше-меньше";
export const ROUND_ONE_REPLACEMENT = "round-one-docx1-named-tiles-v1";
// Content copied from the first table of the host's 1.docx; never imported by clients.
export const roundOneQuestions: Question[] = rawQuestions.map((q) =>
  questionSchema.parse(q),
);

function replaceQuestions(questions: Question[]) {
  return [
    ...structuredClone(roundOneQuestions),
    ...questions.filter((q) => q.round !== 1),
  ];
}

export function replaceRoundOneState(original: GameState, oldIds: Set<string>) {
  const s = { ...initialState(), ...structuredClone(original) };
  s.config.roundNames[1] = ROUND_ONE_TITLE;
  if (s.packageSnapshot)
    s.packageSnapshot.questions = replaceQuestions(s.packageSnapshot.questions);
  for (const id of oldIds) delete s.publicIds[id];
  for (const q of roundOneQuestions) s.publicIds[q.id] = randomUUID();
  if (s.round === 1 && s.phase !== "lobby") {
    clearQuestion(s);
    s.questionPublicId = null;
    s.scoreBefore = {};
    s.used = s.used.filter((id) => !oldIds.has(id));
    s.completed = 0;
    s.total = roundOneQuestions.length;
    s.boardIds = roundOneQuestions.map((q) => q.id);
    s.phase = "intro";
    s.paused = false;
    s.resumeVideo = false;
    s.lastDecision = null;
    s.decisionToken = null;
    s.roundEpoch = randomUUID();
    captureRoundStart(s);
  }
  s.revision++;
  return s;
}

// Runs once, before Store and sockets start, only for the previously imported host document.
export async function migrateRoundOneContent(
  db: PrismaClient,
  backupDirectory = resolve("backups"),
) {
  if (await db.setting.findUnique({ where: { id: ROUND_ONE_REPLACEMENT } }))
    return false;
  if (
    !(await db.setting.findUnique({
      where: { id: "content-import:docx1-20260920" },
    }))
  )
    return false;
  const [previous, settings, game] = await Promise.all([
    db.question.findMany({ where: { round: 1 } }),
    db.setting.findMany({
      where: { OR: [{ id: "main" }, { id: { startsWith: "package:" } }] },
    }),
    db.game.findUnique({ where: { id: "main" } }),
  ]);
  const oldIds = new Set(previous.map((q) => q.id));
  const packs = settings
    .filter((r) => r.id.startsWith("package:"))
    .map((row) => {
      const pack = packageSchema.parse(JSON.parse(row.data));
      for (const q of pack.questions) if (q.round === 1) oldIds.add(q.id);
      return { row, pack };
    });
  const original = game ? (JSON.parse(game.state) as GameState) : null;
  for (const q of original?.packageSnapshot?.questions ?? [])
    if (q.round === 1) oldIds.add(q.id);
  if (original?.question?.round === 1) oldIds.add(original.question.id);
  for (const q of roundOneQuestions) oldIds.add(q.id);
  await mkdir(backupDirectory, { recursive: true });
  const backup = resolve(
    backupDirectory,
    `before-round-one-docx-${Date.now()}-${randomUUID()}.db`,
  );
  await db.$executeRawUnsafe(
    "VACUUM INTO '" + backup.replaceAll("\\", "/").replaceAll("'", "''") + "'",
  );
  const now = new Date().toISOString();
  await db.$transaction(
    async (tx) => {
      if (game) {
        const latest = await tx.game.findUniqueOrThrow({
          where: { id: "main" },
        });
        if (latest.state !== game.state || latest.history !== game.history)
          throw Error(
            "Партия изменилась во время подготовки замены первого раунда",
          );
      }
      await tx.question.deleteMany({ where: { round: 1 } });
      await tx.category.deleteMany({ where: { round: 1 } });
      for (const q of roundOneQuestions) {
        await tx.question.create({
          data: {
            id: q.id,
            round: 1,
            category: q.category,
            active: true,
            position: q.position,
            data: JSON.stringify(q),
          },
        });
        await tx.category.upsert({
          where: { name_round: { name: q.category, round: 1 } },
          create: { id: randomUUID(), name: q.category, round: 1 },
          update: {},
        });
      }
      for (const { row, pack } of packs) {
        const updated: GamePackage = {
          ...pack,
          revision: pack.revision + 1,
          updatedAt: now,
          questions: replaceQuestions(pack.questions),
        };
        await tx.setting.update({
          where: { id: row.id },
          data: { data: JSON.stringify(updated) },
        });
      }
      const configRow = settings.find((row) => row.id === "main");
      if (configRow) {
        const config = JSON.parse(configRow.data) as Config;
        config.roundNames[1] = ROUND_ONE_TITLE;
        await tx.setting.update({
          where: { id: "main" },
          data: { data: JSON.stringify(config) },
        });
      }
      if (game && original) {
        const state = replaceRoundOneState(original, oldIds);
        // Historical states could otherwise restore deleted questions through undo.
        await tx.game.update({
          where: { id: "main" },
          data: { state: JSON.stringify(state), history: "[]" },
        });
        await tx.event.create({
          data: {
            type: state.phase,
            revision: state.revision,
            message:
              "Первый раунд «Больше-меньше»: 10 вопросов из 1.docx. Игроки и набранные очки сохранены.",
          },
        });
      }
      await tx.setting.create({
        data: {
          id: ROUND_ONE_REPLACEMENT,
          data: JSON.stringify({
            appliedAt: now,
            backup,
            removedIds: previous.map((q) => q.id),
            questionIds: roundOneQuestions.map((q) => q.id),
          }),
        },
      });
    },
    { timeout: 30000 },
  );
  return true;
}
