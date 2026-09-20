import { expect, it } from "vitest";
import { initialState, joinPlayer, applyCommand } from "../server/game.js";
import {
  replaceRoundOneState,
  roundOneQuestions,
} from "../server/round-one-content.js";
import { v2Fixture, hostV2 } from "./v2-fixture.js";
import { project } from "../server/projection.js";
import type { Store } from "../server/store.js";
import { packageIssues } from "../shared/packages.js";

it("первая таблица документа задаёт 10 подписанных плиток, ответы и шкалы", () => {
  expect(roundOneQuestions.map((q) => q.category)).toEqual([
    "Фильмы",
    "География",
    "Космос",
    "Вода",
    "Россия",
    "Анатомия",
    "Музыкальные инструменты",
    "Планета Земля",
    "Животные",
    "Видеоигры",
  ]);
  expect(roundOneQuestions.map((q) => q.answer)).toEqual([
    194, 4, 108, 1642, 20, 206, 88, 97, 30, 151,
  ]);
  expect(packageIssues({ questions: roundOneQuestions })).toEqual([]);
});

it("замена открытого первого раунда сохраняет очки и состав, очищает старые вопросы", () => {
  const s = initialState();
  const p = joinPlayer(s, "Игрок");
  p.score = 600;
  s.round = 1;
  s.phase = "reveal";
  s.order = [p.id];
  s.roster = [p.id];
  s.turn = 3;
  s.completed = 3;
  s.question = { ...roundOneQuestions[0], id: "obsolete" };
  s.answers[p.id] = { value: 194, locked: true };
  s.deltas[p.id] = 300;
  s.used = ["obsolete"];
  s.roundCheckpoint = {
    round: 1,
    used: [],
    boardIds: ["obsolete"],
    order: s.order,
    roster: s.roster,
    turn: 0,
    awards: { [p.id]: 600 },
  };
  const updated = replaceRoundOneState(s, new Set(["obsolete"]));
  expect(updated.phase).toBe("intro");
  expect(updated.config.roundNames[1]).toBe("Больше-меньше");
  expect(updated.players).toEqual(s.players);
  expect(updated.order).toEqual(s.order);
  expect(updated.turn).toBe(3);
  expect(updated.total).toBe(10);
  expect(updated.completed).toBe(0);
  expect(updated.used).toEqual([]);
  expect(updated.question).toBeNull();
  expect(updated.answers).toEqual({});
  expect(updated.roundCheckpoint?.awards).toEqual({});
  applyCommand(
    updated,
    hostV2,
    { type: "restartRound", value: "НАЧАТЬ РАУНД ЗАНОВО" },
    roundOneQuestions,
  );
  expect(updated.players[0].score).toBe(600);
});

it("новые вопросы получают непрозрачные ID в снимке v2, ответы не попадают на плитки", () => {
  const { state, send } = v2Fixture();
  send("start");
  const others = state.packageSnapshot!.questions.filter((q) => q.round !== 1);
  const oldIds = new Set(
    state
      .packageSnapshot!.questions.filter((q) => q.round === 1)
      .map((q) => q.id),
  );
  const s = replaceRoundOneState(state, oldIds);
  expect(s.packageSnapshot!.questions.filter((q) => q.round !== 1)).toEqual(
    others,
  );
  const store = {
    state: s,
    bank: roundOneQuestions,
    packages: [],
    events: [],
  } as unknown as Store;
  const who = {
    id: "player",
    role: "player" as const,
    name: "Игрок",
    playerId: s.players[0].id,
  };
  const view = project(store, who, new Set());
  expect(view.board.map((q) => q.category)).toEqual(
    roundOneQuestions.map((q) => q.category),
  );
  expect(view.board.every((q) => q.id && !q.id.startsWith("docx1"))).toBe(true);
  expect(view.question).toBeNull();
  expect(JSON.stringify(view)).not.toContain(roundOneQuestions[0].text);
  applyCommand(s, hostV2, { type: "begin" }, roundOneQuestions);
  applyCommand(
    s,
    who,
    { type: "choose", value: view.board[0].id },
    roundOneQuestions,
  );
  expect(s.question?.id).toBe(roundOneQuestions[0].id);
});
