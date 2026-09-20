import { expect, it } from "vitest";
import { applyCommand, initialState, joinPlayer } from "../server/game.js";
import { demoQuestions } from "../server/content.js";
import { v2Fixture, hostV2 } from "./v2-fixture.js";

it.each([1, 2])(
  "новая партия v%s очищает результаты, сохраняя состав и настройки",
  (version) => {
    const fixture = v2Fixture();
    const s = version === 2 ? fixture.state : initialState();
    const bank = version === 2 ? fixture.questions : demoQuestions();
    if (version === 1) {
      joinPlayer(s, "Алиса");
      joinPlayer(s, "Борис");
      s.finalSelection = bank.find(
        (q) => q.round === 6,
      )! as typeof s.finalSelection;
    }
    s.order = s.players.map((p) => p.id).reverse();
    const send = (type: string, value?: unknown) =>
      applyCommand(s, hostV2, { type, value }, bank, 1000);
    send("start");
    const original = structuredClone(s);
    const id = s.players[0].id;
    s.phase = "finished";
    s.round = 6;
    s.roundIndex = 5;
    s.players[0].score = 1700;
    s.players[1].score = -500;
    s.answers[id] = { value: 50, locked: true };
    s.bets[id] = 500;
    s.countries[id] = { code: "RU", locked: true };
    s.deltas[id] = -500;
    s.scoreBefore[id] = 2200;
    s.used = bank.map((q) => q.id);
    s.question = s.finalSelection;
    s.finalAttemptId = "old-final";
    s.roundEpoch = "old-round";
    s.paused = true;
    s.resumeVideo = true;
    s.video = { status: "playing", offset: 12, changedAt: 1 };
    s.timer = { deadline: null, remaining: 5000 };
    s.acceptedCommands["old-command"] = true;
    const before = structuredClone(s);
    expect(() =>
      applyCommand(
        s,
        { ...hostV2, role: "player", playerId: id },
        {
          type: "restartGame",
          value: "НАЧАТЬ ИГРУ ЗАНОВО",
        },
        bank,
      ),
    ).toThrow();
    expect(() => send("restartGame")).toThrow();
    expect(s).toEqual(before);
    send("restartGame", "НАЧАТЬ ИГРУ ЗАНОВО");
    expect(s.phase).toBe("intro");
    expect(s.round).toBe(1);
    expect(s.players).toEqual(
      original.players.map((p) => ({ ...p, score: 0, ready: false })),
    );
    expect(s.order).toEqual(original.order);
    expect(s.roster).toEqual(original.roster);
    expect(s.config).toEqual(original.config);
    expect(s.packageSnapshot).toEqual(original.packageSnapshot);
    expect(s.finalSelection).toEqual(original.finalSelection);
    expect(s.selectedPackageId).toBe(original.selectedPackageId);
    expect(s.acceptedCommands["old-command"]).toBe(true);
    expect(s.roundEpoch).toBeTruthy();
    expect(s.roundEpoch).not.toBe(before.roundEpoch);
    expect(s.finalAttemptId).toBeNull();
    expect(s.question).toBeNull();
    expect(s.used).toEqual([]);
    for (const field of [
      "answers",
      "bets",
      "countries",
      "deltas",
      "scoreBefore",
      "panoramaReady",
      "panoramaErrors",
    ] as const)
      expect(s[field]).toEqual({});
    expect(s.timer).toEqual({ deadline: null, remaining: null });
    expect(s.paused).toBe(false);
    expect(s.resumeVideo).toBeFalsy();
    expect(s.video.status).toBe("stopped");
    expect(s.joinOpen).toBe(false);
    expect(s.roundCheckpoint?.awards).toEqual({});
    if (version === 2) {
      for (const [key, token] of Object.entries(original.publicIds))
        expect(s.publicIds[key]).not.toBe(token);
      for (const [key, token] of Object.entries(original.mediaTokens))
        expect(s.mediaTokens[key]).not.toBe(token);
    }
    send("begin");
    expect(s.phase).toBe("choosing");
  },
);

it("неудачный повтор не сбрасывает партию, а в лобби доступен обычный старт", () => {
  const { state, send } = v2Fixture();
  expect(() => send("restartGame", "НАЧАТЬ ИГРУ ЗАНОВО")).toThrow();
  send("start");
  state.players[0].score = 1000;
  state.packageSnapshot = null;
  const before = structuredClone(state);
  expect(() => send("restartGame", "НАЧАТЬ ИГРУ ЗАНОВО")).toThrow();
  expect(state).toEqual(before);
});
