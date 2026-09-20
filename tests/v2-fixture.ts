import { demoQuestions } from "../server/content.js";
import { questionSchema } from "../shared/content.js";
import { packageSchema } from "../shared/packages.js";
import { upgradeConfig } from "../shared/config.js";
import { initialState, joinPlayer, applyCommand } from "../server/game.js";
export const hostV2 = { id: "host", role: "host" as const, name: "Ведущий" };
export function v2Fixture(count = 2) {
  const bank = demoQuestions();
  const questions = [1, 2, 3, 4, 5].flatMap((round) =>
    bank
      .filter((q) => q.round === round)
      .slice(0, 10)
      .map((q, index) =>
        questionSchema.parse({
          ...q,
          id: "v2-" + q.id,
          formatVersion: 2,
          category: "Категория " + (index + 1),
          ...(q.round === 3
            ? {
                speaker: "Авторский персонаж",
                work: "Учебный текст",
                verified: true,
                translated: false,
              }
            : {}),
          ...(q.round === 4
            ? {
                fullImageFileId: "full-" + index,
                crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
                media: { ...q.media, fileId: "fragment-" + index },
              }
            : {}),
        }),
      ),
  );
  const final = questionSchema.parse({
    ...bank.find((q) => q.round === 6),
    id: "v2-final",
    formatVersion: 2,
    location: { latitude: -28.508926, longitude: 28.5664 },
  });
  questions.push(final);
  const state = initialState(upgradeConfig());
  for (let i = 0; i < count; i++) joinPlayer(state, "Игрок " + (i + 1));
  state.order = state.players.map((p) => p.id);
  state.packageSnapshot = packageSchema.parse({
    id: "fixture",
    name: "Пакет теста",
    revision: 1,
    updatedAt: new Date().toISOString(),
    questions,
  });
  state.selectedPackageId = "fixture";
  state.finalSelection = final.round === 6 ? final : null;
  let now = 1000;
  const send = (type: string, value?: unknown, playerId?: string) =>
    applyCommand(
      state,
      playerId
        ? { role: "player", id: playerId, playerId, name: "Игрок" }
        : hostV2,
      { type, value },
      questions,
      now++,
      now,
    );
  return {
    state,
    questions,
    send,
    time: (value: number) => {
      now = value;
    },
  };
}
