import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  beginQuestion,
  applyCommand,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
import { project } from "../server/projection.js";
import { PLAYER_COLORS } from "../shared/config.js";
import type { Store } from "../server/store.js";
const host = { role: "host" as const, id: "host", name: "Ведущий" };

it("шесть цветов назначаются по местам входа и сохраняются при переименовании", () => {
  const s = initialState();
  for (let i = 1; i <= 6; i++) joinPlayer(s, "Игрок " + i);
  expect(s.players.map((p) => p.color)).toEqual([
    "#B7ADFF",
    "#8CC8FF",
    "#F596C3",
    "#FFAD85",
    "#FFFFFF",
    "#FFD23F",
  ]);
  const p = s.players[1];
  applyCommand(
    s,
    { role: "player", id: p.id, playerId: p.id, name: p.name },
    { type: "rename", value: "Даша" },
    [],
  );
  expect(p.color).toBe(PLAYER_COLORS[1]);
  expect(s.players.length).toBe(6);
});
it.each([2, 3, 4, 5, 6])(
  "раунд %s: результат зависит от ответа, даже при нулевых очках",
  (round) => {
    const s = initialState();
    const a = joinPlayer(s, "А"),
      b = joinPlayer(s, "Б"),
      c = joinPlayer(s, "В");
    s.roster = s.order = s.players.map((p) => p.id);
    s.round = round;
    const q = demoQuestions().find((q) => q.round === round)!;
    beginQuestion(s, { ...q, value: 0 }, 0);
    if (round === 2 || round === 3) {
      s.answers[a.id] = { choice: String(q.answer), locked: true };
      s.answers[b.id] = { choice: "wrong", locked: true };
    } else if (round === 6) {
      s.countries[a.id] = { code: String(q.answer), locked: true };
      s.countries[b.id] = { code: "XX", locked: true };
      s.bets = { [a.id]: 0, [b.id]: 0 };
    } else {
      s.phase = "buzzing";
      applyCommand(
        s,
        { role: "player", id: b.id, playerId: b.id, name: b.name },
        { type: "buzz" },
        [],
        1,
      );
      applyCommand(s, host, { type: "judge", value: false }, [], 2);
      applyCommand(
        s,
        { role: "player", id: a.id, playerId: a.id, name: a.name },
        { type: "buzz" },
        [],
        3,
      );
      applyCommand(s, host, { type: "judge", value: true }, [], 4);
    }
    const store = { state: s, bank: [], events: [] } as unknown as Store;
    s.phase = "answering";
    const hidden = project(store, host, new Set());
    expect(hidden.answerResults).toBeUndefined();
    if (round === 2) expect(hidden.question?.anchorDate).toBeUndefined();
    s.phase = round === 6 ? "finished" : "reveal";
    expect(project(store, host, new Set()).answerResults).toEqual({
      [a.id]: "correct",
      [b.id]: "wrong",
      [c.id]: "missing",
    });
  },
);
