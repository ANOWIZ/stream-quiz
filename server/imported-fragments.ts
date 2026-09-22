import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { GameState } from "../shared/types.js";
import type { GamePackage } from "../shared/packages.js";
import { clearQuestion } from "./game.js";

const packageId = "docx1-20260920";
const removedIds = new Set(["demo-v2-fragment-0", "demo-v2-fragment-1"]);
export const FRAGMENT_CLEANUP = "imported-fragments-user-only-v1";

export function removeImportedFragments(original: GameState): GameState {
  const s = structuredClone(original);
  if (s.packageSnapshot?.id !== packageId) return s;
  s.packageSnapshot.questions = s.packageSnapshot.questions.filter(
    (q) => !removedIds.has(q.id),
  );
  s.boardIds = s.boardIds.filter((id) => !removedIds.has(id));
  s.used = s.used.filter((id) => !removedIds.has(id));
  for (const checkpoint of [
    s.roundCheckpoint,
    ...Object.values(s.roundCheckpoints ?? {}),
  ]) {
    if (!checkpoint) continue;
    checkpoint.boardIds = checkpoint.boardIds.filter(
      (id) => !removedIds.has(id),
    );
    checkpoint.used = checkpoint.used.filter((id) => !removedIds.has(id));
  }
  if (s.question && removedIds.has(s.question.id)) {
    clearQuestion(s);
    s.questionPublicId = null;
    s.scoreBefore = {};
    s.phase = "choosing";
    s.paused = false;
    s.resumeVideo = false;
    s.roundEpoch = randomUUID();
  }
  if (s.lastDecision && removedIds.has(s.lastDecision.questionId)) {
    s.lastDecision = null;
    s.decisionToken = null;
  }
  for (const id of removedIds) delete s.publicIds[id];
  if (s.round === 4) {
    const ids = new Set(
      s.packageSnapshot.questions.filter((q) => q.round === 4).map((q) => q.id),
    );
    s.total = ids.size;
    s.completed = Math.max(
      0,
      s.used.filter((id) => ids.has(id)).length -
        (s.question && s.used.includes(s.question.id) ? 1 : 0),
    );
  }
  return s;
}

// One-time cleanup of the two fillers previously added to the host's document.
// Other libraries, uploaded media and already awarded scores remain intact.
export async function migrateImportedFragments(db: PrismaClient) {
  if (await db.setting.findUnique({ where: { id: FRAGMENT_CLEANUP } }))
    return false;
  const packRow = await db.setting.findUnique({
    where: { id: "package:" + packageId },
  });
  if (!packRow) return false;
  const pack = JSON.parse(packRow.data) as GamePackage;
  const game = await db.game.findUnique({ where: { id: "main" } });
  const state = game ? removeImportedFragments(JSON.parse(game.state)) : null;
  const history = game
    ? (JSON.parse(game.history) as GameState[]).map(removeImportedFragments)
    : [];
  pack.questions = pack.questions.filter((q) => !removedIds.has(q.id));
  pack.revision++;
  pack.updatedAt = new Date().toISOString();
  if (state) state.revision++;
  await db.$transaction([
    db.setting.create({
      data: {
        id: FRAGMENT_CLEANUP,
        data: JSON.stringify({
          appliedAt: pack.updatedAt,
          package: packRow,
          game,
        }),
      },
    }),
    db.setting.update({
      where: { id: packRow.id },
      data: { data: JSON.stringify(pack) },
    }),
    ...(game && state
      ? [
          db.game.update({
            where: { id: game.id },
            data: {
              state: JSON.stringify(state),
              history: JSON.stringify(history),
            },
          }),
        ]
      : []),
  ]);
  return true;
}
