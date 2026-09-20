import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  applyCommand,
  beginQuestion,
  reveal,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
import { project } from "../server/projection.js";
import { publicAddress, importUrl } from "../server/panorama-import.js";
import { normalizePanorama } from "../server/panorama-files.js";
import sharp from "sharp";
import type { Store } from "../server/store.js";
const h = { id: "h", name: "Ведущий", role: "host" as const };
function finalRoom() {
  const s = initialState();
  const a = joinPlayer(s, "А"),
    b = joinPlayer(s, "Б");
  a.score = 1000;
  b.score = 800;
  s.roster = [a.id, b.id];
  s.round = 6;
  s.phase = "intro";
  return { s, a, b, bank: demoQuestions() };
}
it("финал требует ручного выбора; случайный режим включается только ведущим", () => {
  const { s, bank, a } = finalRoom();
  expect(() => applyCommand(s, h, { type: "begin" }, bank)).toThrow(
    "выберите панораму",
  );
  expect(() =>
    applyCommand(
      s,
      { ...h, role: "player", playerId: a.id },
      { type: "randomFinal", value: true },
      bank,
    ),
  ).toThrow();
  applyCommand(s, h, { type: "selectFinal", value: "demo-local-360" }, bank);
  expect(s.finalRandom).toBe(false);
  applyCommand(s, h, { type: "begin" }, bank);
  expect(s.phase).toBe("betting");
  expect(s.finalAttemptId).toBeTruthy();
  expect(() =>
    applyCommand(s, h, { type: "selectFinal", value: "demo-local-360" }, bank),
  ).toThrow("Сначала отмените");
  applyCommand(s, h, { type: "cancelFinal", value: "ОТМЕНИТЬ ФИНАЛ" }, bank);
  applyCommand(s, h, { type: "randomFinal", value: true }, bank);
  applyCommand(s, h, { type: "begin" }, bank);
  expect(s.question?.id).toBe("demo-local-360");
});
it("отмена финала сохраняет очки раундов и ручные поправки, очищает попытку", () => {
  const { s, a, b, bank } = finalRoom();
  const q = bank.find((q) => q.round === 6)!;
  beginQuestion(s, q, 0);
  const old = s.finalAttemptId;
  s.bets = { [a.id]: 200, [b.id]: 100 };
  s.countries = {
    [a.id]: { code: String(q.answer), locked: true },
    [b.id]: { code: "DE", locked: true },
  };
  s.phase = "locating";
  reveal(s);
  applyCommand(
    s,
    h,
    {
      type: "score",
      value: { playerId: a.id, amount: 50, reason: "Поправка" },
    },
    bank,
  );
  expect(a.score).toBe(1250);
  expect(() => applyCommand(s, h, { type: "cancelFinal" }, bank)).toThrow(
    "Подтвердите",
  );
  applyCommand(s, h, { type: "cancelFinal", value: "ОТМЕНИТЬ ФИНАЛ" }, bank);
  expect([a.score, b.score]).toEqual([1050, 800]);
  expect(s.bets).toEqual({});
  expect(s.countries).toEqual({});
  expect(s.phase).toBe("intro");
  expect(s.finalSelection).toBeNull();
  expect(s.timer.deadline).toBeNull();
  applyCommand(s, h, { type: "selectFinal", value: q.id }, bank);
  applyCommand(s, h, { type: "begin" }, bank);
  expect(s.finalAttemptId).not.toBe(old);
});
it("выбранный файл и метаданные не попадают игроку до показа, страна скрыта до результата", () => {
  const { s, a, bank } = finalRoom();
  const q = bank.find((q) => q.round === 6)!;
  if (q.round !== 6) throw Error();
  q.id = "secret-country-France";
  q.panoramaFileId = "secret-image";
  q.title = "Secret France";
  q.category = "France";
  q.text = "Paris";
  s.finalSelection = q;
  const store = { state: s, bank, events: [] } as unknown as Store;
  const who = {
    id: a.id,
    playerId: a.id,
    name: a.name,
    role: "player" as const,
  };
  expect(JSON.stringify(project(store, who, new Set()))).not.toContain(
    "secret-image",
  );
  beginQuestion(s, q, 0);
  expect(project(store, who, new Set()).finalSelection).toBeUndefined();
  expect(project(store, who, new Set()).question).not.toHaveProperty(
    "panorama",
  );
  expect(JSON.stringify(project(store, who, new Set()))).not.toContain(
    "France",
  );
  s.phase = "locating";
  const v = project(store, who, new Set());
  expect(v.question?.panorama).toEqual({
    provider: "local",
    fileId: "secret-image",
    camera: q.camera,
  });
  expect(v.question).not.toHaveProperty("answer");
  expect(v.question).not.toHaveProperty("place");
  for (const key of ["author", "source", "license", "licenseUrl"])
    expect(v.question).not.toHaveProperty(key);
});
it("импорт запрещает локальные, служебные адреса и нестандартные HTTPS ссылки", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.2",
    "::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "fc00::1",
  ])
    expect(publicAddress(ip)).toBe(false);
  expect(publicAddress("8.8.8.8")).toBe(true);
  expect(publicAddress("2606:4700:4700::1111")).toBe(true);
  for (const url of [
    "https://example.com/%ZZ.jpg",
    "http://example.com/a.jpg",
    "https://localhost/a.jpg",
    "https://a:b@example.com/a.jpg",
    "https://example.com:8000/a.jpg",
  ])
    expect(() => importUrl(url)).toThrow();
});
it("панорама декодируется, очищается от EXIF и проверяется как изображение 2:1", async () => {
  const image = await sharp({
    create: { width: 512, height: 256, channels: 3, background: "#558899" },
  })
    .withExif({ IFD0: { Artist: "Secret country" } })
    .jpeg()
    .toBuffer();
  const normalized = await normalizePanorama(image, "image/jpeg");
  const meta = await sharp(normalized).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.width).toBe(512);
  expect(meta.height).toBe(256);
  await expect(normalizePanorama(image, "image/png")).rejects.toThrow("MIME");
  const square = await sharp({
    create: { width: 512, height: 512, channels: 3, background: "#558899" },
  })
    .png()
    .toBuffer();
  await expect(normalizePanorama(square, "image/png")).rejects.toThrow("2:1");
});
