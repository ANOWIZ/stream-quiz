import { expect, it } from "vitest";
import { initialState, joinPlayer, applyCommand } from "../server/game.js";
it("проверяет лимит, уникальность имени и готовность", () => {
  const s = initialState();
  const p = joinPlayer(s, " Алиса ");
  expect(() => joinPlayer(s, "АЛИСА")).toThrow("занято");
  for (let i = 0; i < 5; i++) joinPlayer(s, "Игрок " + i);
  expect(() => joinPlayer(s, "Седьмой")).toThrow("шесть");
  applyCommand(
    s,
    { id: "x", role: "player", name: p.name, playerId: p.id },
    { type: "ready", value: true },
    [],
  );
  expect(p.ready).toBe(true);
});
it("игрок не может управлять комнатой", () => {
  expect(() =>
    applyCommand(
      initialState(),
      { id: "x", role: "player", name: "x" },
      { type: "joinOpen", value: false },
      [],
    ),
  ).toThrow("ведущему");
});
