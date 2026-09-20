import type { PrismaClient } from "@prisma/client";

// Only built-in labels change; user names, questions, sessions and IDs stay intact.
function updateLabels(serialized: string): string {
  return serialized
    .replaceAll(
      "СТОН · учебный пакет на 51 задание",
      "Учебный пакет на 51 задание",
    )
    .replaceAll(
      "Авторский демонстрационный набор СТОН",
      "Авторский демонстрационный набор",
    )
    .replaceAll("Учебные тексты СТОН,", "Учебные тексты,");
}

export async function migrateDisplayNames(db: PrismaClient) {
  const id = "display-names-unbranded-v2";
  if (await db.setting.findUnique({ where: { id } })) return;
  const [questions, settings, games, events] = await Promise.all([
    db.question.findMany(),
    db.setting.findMany(),
    db.game.findMany(),
    db.event.findMany(),
  ]);
  await db.$transaction([
    ...questions.flatMap((row) => {
      const data = updateLabels(row.data);
      return data === row.data
        ? []
        : [db.question.update({ where: { id: row.id }, data: { data } })];
    }),
    ...settings.flatMap((row) => {
      const data = updateLabels(row.data);
      return data === row.data
        ? []
        : [db.setting.update({ where: { id: row.id }, data: { data } })];
    }),
    ...games.flatMap((row) => {
      const state = updateLabels(row.state),
        history = updateLabels(row.history);
      return state === row.state && history === row.history
        ? []
        : [db.game.update({ where: { id: row.id }, data: { state, history } })];
    }),
    ...events.flatMap((row) => {
      const message = updateLabels(row.message);
      return message === row.message
        ? []
        : [db.event.update({ where: { id: row.id }, data: { message } })];
    }),
    db.setting.create({ data: { id, data: "true" } }),
  ]);
}
