import { expect, it } from "vitest";
import { addPoints } from "../server/game.js";
import {
  previousRoundCheckpoint,
  recoverRoundCheckpoints,
} from "../server/round-checkpoints.js";
import { v2Fixture } from "./v2-fixture.js";

it("старое сохранение восстанавливает только известные начала раундов из хронологической истории", () => {
  const { state: s, send } = v2Fixture();
  send("start");
  for (let i = 1; i < 4; i++) send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  s.roundCheckpoints = {};
  const first = structuredClone(s);
  first.phase = "judging";
  addPoints(s, s.players[0].id, 1500);
  const latest = structuredClone(s);
  latest.phase = "reveal";
  send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  s.roundCheckpoints = {};
  const history = [first, latest];
  expect(recoverRoundCheckpoints(s, history)).toBe(true);
  expect(previousRoundCheckpoint(s)?.awards[s.players[0].id]).toBe(1500);
  expect(Object.keys(s.roundCheckpoints)).toEqual(["4"]);
  expect(
    history.every((old) => Object.keys(old.roundCheckpoints).length === 0),
  ).toBe(true);
  expect(previousRoundCheckpoint(latest)).toBeNull();
  expect(recoverRoundCheckpoints(s, history)).toBe(false);
  latest.roundCheckpoint!.awards[s.players[0].id] = 999;
  expect(s.roundCheckpoints[4].awards[s.players[0].id]).toBe(1500);
  expect(recoverRoundCheckpoints(s, history)).toBe(false);
  expect(s.roundCheckpoints[4].awards[s.players[0].id]).toBe(1500);
});
