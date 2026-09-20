import { expect, it } from "vitest";
import { initialState, joinPlayer, beginQuestion } from "../server/game.js";
import { demoPanorama } from "../server/demo-panorama.js";
import { migrateLocalState } from "../server/local-panorama-migration.js";
import { questionSchema } from "../shared/content.js";
import { defaultPanoramaCamera } from "../shared/panorama.js";
function legacy(local = false) {
  const s = initialState(),
    p = joinPlayer(s, "Алиса");
  p.score = 1000;
  s.round = 6;
  s.roster = [p.id];
  const q = demoPanorama();
  beginQuestion(s, q, 0);
  s.phase = "locating";
  s.bets = { [p.id]: 200 };
  s.countries = { [p.id]: { code: "ZA", locked: false } };
  const old = q as unknown as Record<string, unknown>;
  delete old.camera;
  old.pano = "old-id";
  old.lat = 10;
  old.lng = 20;
  if (!local) delete old.panoramaFileId;
  s.question = structuredClone(q);
  s.finalSelection = structuredClone(q);
  Object.assign(s.config.final, { heading: 270, pitch: 10, zoom: 2 });
  return { s, p };
}
it("старый внешний финал отменяется без изменения очков и скрытых данных", () => {
  const { s, p } = legacy();
  const result = migrateLocalState(s);
  expect(result.interrupted).toBe(true);
  const next = result.state;
  expect(next.phase).toBe("intro");
  expect(next.question).toBeNull();
  expect(next.finalSelection).toBeNull();
  expect(next.players.find((x) => x.id === p.id)?.score).toBe(1000);
  expect(next.bets).toEqual({});
  expect(next.countries).toEqual({});
  expect(next.finalAttemptId).toBeNull();
  expect(next.timer.deadline).toBeNull();
  expect(s.phase).toBe("locating");
});
it("локальная попытка сохраняет ракурс, ставки, таймер и идентификатор", () => {
  const { s } = legacy(true);
  const result = migrateLocalState(s);
  expect(result.interrupted).toBe(false);
  expect(result.state.question).toMatchObject({
    camera: { heading: -90, pitch: 10, zoom: 2 },
  });
  expect(result.state.question).not.toHaveProperty("pano");
  expect(result.state.question).not.toHaveProperty("lat");
  expect(result.state.bets).toEqual(s.bets);
  expect(result.state.timer).toEqual(s.timer);
  expect(result.state.finalAttemptId).toBe(s.finalAttemptId);
  expect(result.state.config.final).not.toHaveProperty("heading");
});
it("завершённый старый финал сохраняет итоговую таблицу и ответы", () => {
  const { s } = legacy();
  s.phase = "finished";
  const result = migrateLocalState(s);
  expect(result.interrupted).toBe(false);
  expect(result.state.phase).toBe("finished");
  expect(result.state.players).toEqual(s.players);
  expect(result.state.countries).toEqual(s.countries);
  expect(result.state.question?.answer).toBe("ZA");
});
it("локальная схема запрещает активную локацию без файла и неверные пределы камеры", () => {
  const q = demoPanorama();
  expect(
    questionSchema.safeParse({ ...q, panoramaFileId: undefined }).success,
  ).toBe(false);
  expect(
    questionSchema.safeParse({ ...q, panoramaFileId: undefined, active: false })
      .success,
  ).toBe(true);
  expect(
    questionSchema.safeParse({
      ...q,
      camera: { ...defaultPanoramaCamera, minZoom: 3, maxZoom: 2 },
    }).success,
  ).toBe(false);
  expect(
    questionSchema.safeParse({ ...q, licenseUrl: "javascript:alert(1)" })
      .success,
  ).toBe(false);
});
