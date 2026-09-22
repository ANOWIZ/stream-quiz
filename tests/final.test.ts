import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  beginQuestion,
  applyCommand,
  expire,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
import { project } from "../server/projection.js";
import {
  clampPanoramaView,
  defaultPanoramaCamera,
  panoramaCameraSchema,
} from "../shared/panorama.js";
import type { Store } from "../server/store.js";
it("финал: скрытые ставки, фиксация последнего выбора по таймеру, точное совпадение страны", () => {
  const s = initialState();
  s.round = 6;
  const a = joinPlayer(s, "А");
  const b = joinPlayer(s, "Б");
  a.score = 1000;
  b.score = 800;
  s.roster = [a.id, b.id];
  s.order = [a.id, b.id];
  const q = demoQuestions().find((q) => q.round === 6)!;
  beginQuestion(s, q, 0);
  const who = (p: typeof a) => ({
    id: p.id,
    playerId: p.id,
    role: "player" as const,
    name: p.name,
  });
  expect(() =>
    applyCommand(s, who(a), { type: "bet", value: 1001 }, [], 1),
  ).toThrow();
  applyCommand(s, who(a), { type: "bet", value: 1000 }, [], 1);
  expect(() =>
    applyCommand(s, who(a), { type: "bet", value: 1 }, [], 2),
  ).toThrow();
  const store = { state: s, bank: [], events: [] } as unknown as Store;
  const v = project(store, { id: "h", role: "host", name: "h" }, new Set());
  expect(v.bets).toEqual({});
  expect(v.question).not.toHaveProperty("panorama");
  expect(v.question).not.toHaveProperty("answer");
  applyCommand(s, who(b), { type: "bet", value: 400 }, [], 3);
  expect(s.phase).toBe("locating");
  expect(s.timer.deadline).toBe(60003);
  applyCommand(s, who(a), { type: "country", value: q.answer }, [], 4);
  applyCommand(s, who(b), { type: "country", value: "DE" }, [], 5);
  expect(project(store, who(a), new Set()).countries[b.id]).toBeUndefined();
  expire(s, 120004);
  expect(s.phase).toBe("awaitingReveal");
  expect(a.score).toBe(1000);
  expect(b.score).toBe(800);
  expect(project(store, who(a), new Set()).countries[b.id]).toBeUndefined();
  applyCommand(
    s,
    { id: "h", name: "h", role: "host" },
    { type: "reveal" },
    [],
    120005,
  );
  expect(s.phase).toBe("finished");
  expect(a.score).toBe(2000);
  expect(b.score).toBe(400);
});
it("камера ограничивает все способы изменения ракурса и проверяет границы", () => {
  const camera = { ...defaultPanoramaCamera, minZoom: 1, maxZoom: 2 };
  expect(
    clampPanoramaView({ heading: 725, pitch: 100, zoom: 9 }, camera),
  ).toEqual({ heading: 5, pitch: 85, zoom: 2 });
  expect(
    clampPanoramaView({ heading: -725, pitch: -100, zoom: 0 }, camera),
  ).toEqual({ heading: -5, pitch: -85, zoom: 1 });
  expect(
    panoramaCameraSchema.safeParse({ ...camera, minZoom: 3 }).success,
  ).toBe(false);
  expect(panoramaCameraSchema.safeParse({ ...camera, zoom: 0.8 }).success).toBe(
    false,
  );
});

it.each(["players", "host", "timeout"])(
  "новая панорама в старой сохранённой партии даёт минуту: %s",
  (trigger) => {
    const s = initialState();
    const a = joinPlayer(s, "А"),
      b = joinPlayer(s, "Б");
    s.round = 6;
    s.roster = [a.id, b.id];
    const q = {
      ...demoQuestions().find((q) => q.round === 6)!,
      formatVersion: 2 as const,
    };
    beginQuestion(s, q, 1000);
    let started = 2000;
    if (trigger === "players") {
      for (const p of [a, b])
        applyCommand(
          s,
          { id: p.id, playerId: p.id, role: "player", name: p.name },
          { type: "bet", value: 0 },
          [],
          started,
        );
    } else if (trigger === "host")
      applyCommand(
        s,
        { id: "h", role: "host", name: "Ведущий" },
        { type: "beginLocation" },
        [],
        started,
      );
    else {
      started = s.timer.deadline!;
      expire(s, started);
    }
    expect(s.phase).toBe("locating");
    expect(s.timer.deadline! - started).toBe(60000);
  },
);
