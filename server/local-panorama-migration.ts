import type { PrismaClient } from "@prisma/client";
import {
  defaultPanoramaCamera,
  clampPanoramaView,
  panoramaCameraSchema,
} from "../shared/panorama.js";
import type { GameState } from "../shared/types.js";
import type { Question } from "../shared/content.js";
function legacyCamera(final: Record<string, unknown>) {
  return {
    ...defaultPanoramaCamera,
    ...clampPanoramaView(
      {
        heading:
          typeof final.heading === "number" && Number.isFinite(final.heading)
            ? final.heading
            : 0,
        pitch:
          typeof final.pitch === "number" && Number.isFinite(final.pitch)
            ? final.pitch
            : 0,
        zoom:
          typeof final.zoom === "number" && Number.isFinite(final.zoom)
            ? final.zoom
            : 1,
      },
      defaultPanoramaCamera,
    ),
  };
}
function localQuestion(
  input: Question | null,
  oldCamera = defaultPanoramaCamera,
) {
  if (!input || input.round !== 6) return input;
  const q = { ...input } as typeof input & Record<string, unknown>;
  delete q.pano;
  delete q.lat;
  delete q.lng;
  const checked = panoramaCameraSchema.safeParse(q.camera);
  q.camera = checked.success ? checked.data : { ...oldCamera };
  if (!q.panoramaFileId) q.active = false;
  return q;
}
export function migrateLocalState(state: GameState): {
  state: GameState;
  interrupted: boolean;
} {
  const s = structuredClone(state);
  const previous = s.config.final as typeof s.config.final & {
    heading?: number;
    pitch?: number;
    zoom?: number;
  };
  const camera = legacyCamera(previous);
  delete previous.heading;
  delete previous.pitch;
  delete previous.zoom;
  s.question = localQuestion(s.question, camera);
  s.finalSelection = localQuestion(
    s.finalSelection,
    camera,
  ) as typeof s.finalSelection;
  if (s.finalSelection && !s.finalSelection.panoramaFileId)
    s.finalSelection = null;
  const interrupted =
    s.question?.round === 6 &&
    !s.question.panoramaFileId &&
    s.phase !== "finished";
  if (interrupted) {
    s.question = null;
    s.finalSelection = null;
    s.finalAttemptId = null;
    s.finalRandom = false;
    s.answers = {};
    s.bets = {};
    s.countries = {};
    s.deltas = {};
    s.scoreBefore = {};
    s.buzzes = [];
    s.blocked = [];
    s.buzzWinner = null;
    s.timer = { deadline: null, remaining: null };
    s.phase = "intro";
    s.paused = false;
    s.resumeVideo = false;
    s.video = { status: "stopped", offset: 0, changedAt: 0 };
  }
  return { state: s, interrupted };
}
export async function migrateLocalPanoramas(db: PrismaClient) {
  if (
    await db.setting.findUnique({ where: { id: "local-panorama-provider-v1" } })
  )
    return;
  const cfg = await db.setting.findUnique({ where: { id: "main" } });
  const previousConfig = cfg ? JSON.parse(cfg.data) : { final: {} };
  const camera = legacyCamera(previousConfig.final);
  const operations = [];
  for (const row of await db.question.findMany({ where: { round: 6 } })) {
    const original = JSON.parse(row.data) as Question;
    const q = localQuestion(original, camera)!;
    operations.push(
      db.setting.upsert({
        where: { id: "panorama-archive:" + row.id },
        create: { id: "panorama-archive:" + row.id, data: row.data },
        update: {},
      }),
    );
    operations.push(
      db.question.update({
        where: { id: row.id },
        data: { active: q.active, data: JSON.stringify(q) },
      }),
    );
  }
  const game = await db.game.findUnique({ where: { id: "main" } });
  if (game) {
    const migrated = migrateLocalState(JSON.parse(game.state) as GameState);
    const history = (JSON.parse(game.history) as GameState[])
      .filter((s) => !(s.question?.round === 6 && !s.question.panoramaFileId))
      .map((s) => migrateLocalState(s).state);
    operations.push(
      db.game.update({
        where: { id: "main" },
        data: {
          state: JSON.stringify(migrated.state),
          history: JSON.stringify(migrated.interrupted ? [] : history),
        },
      }),
    );
    if (migrated.interrupted)
      operations.push(
        db.event.create({
          data: {
            type: "intro",
            message:
              "Финал возвращён к выбору: для прежней локации нужен локальный файл. Очки сохранены.",
            revision: migrated.state.revision,
          },
        }),
      );
  }
  if (cfg) {
    const data = JSON.parse(cfg.data) as { final: Record<string, unknown> };
    delete data.final.heading;
    delete data.final.pitch;
    delete data.final.zoom;
    operations.push(
      db.setting.update({
        where: { id: "main" },
        data: { data: JSON.stringify(data) },
      }),
    );
  }
  operations.push(
    db.setting.create({
      data: { id: "local-panorama-provider-v1", data: "true" },
    }),
  );
  await db.$transaction(operations);
}
