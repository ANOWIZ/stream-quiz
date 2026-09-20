import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";
import type { GameState, Identity, Command } from "../shared/types.js";
import { requireRule, arm, stopTimer, addPoints } from "./game.js";
const world = JSON.parse(
  readFileSync(
    existsSync("public/world.json")
      ? "public/world.json"
      : "dist/client/world.json",
    "utf8",
  ),
) as { features: { id: string }[] };
export const countryCodes = new Set(world.features.map((f) => f.id));
export function finalAnswerSeconds(s: GameState) {
  // New geography locations keep their one-minute limit in older saved parties.
  return s.question?.formatVersion === 2 ? 60 : s.config.final.seconds;
}
export function finishCountrySelection(s: GameState) {
  requireRule(
    s.question?.round === 6 && s.phase === "locating",
    "Выбор страны уже завершён",
  );
  for (const id of s.roster)
    s.countries[id] = { ...(s.countries[id] ?? { code: null }), locked: true };
  s.phase = "awaitingReveal";
  stopTimer(s);
}
export function finalCommand(
  s: GameState,
  who: Identity,
  c: Command,
  now: number,
): string | null {
  if (!["bet", "country", "confirmCountry", "beginLocation"].includes(c.type))
    return null;
  requireRule(s.question?.round === 6, "Сейчас не финал");
  if (c.type === "beginLocation") {
    requireRule(
      who.role === "host" && s.phase === "betting",
      "Сейчас нельзя показать локацию",
    );
    for (const id of s.roster) if (s.bets[id] === undefined) s.bets[id] = 0;
    s.phase = "locating";
    arm(s, finalAnswerSeconds(s), now);
    return "Локация открыта; отсутствующие ставки равны нулю";
  }
  requireRule(who.role === "player" && who.playerId, "Ответ доступен игрокам");
  const id = who.playerId;
  if (c.type === "bet") {
    requireRule(
      s.phase === "betting" && s.bets[id] === undefined,
      "Ставка уже сделана или приём закрыт",
    );
    const score = s.players.find((p) => p.id === id)!.score;
    const max = Math.floor(Math.max(0, score) * s.config.final.betLimit);
    const bet = z.number().int().min(0).max(max).parse(c.value);
    s.bets[id] = bet;
    if (s.roster.every((p) => s.bets[p] !== undefined)) {
      s.phase = "locating";
      arm(s, finalAnswerSeconds(s), now);
    }
    return "Игрок сделал тайную ставку";
  }
  requireRule(
    s.phase === "locating" && !s.countries[id]?.locked,
    "Выбор страны закрыт",
  );
  if (c.type === "country") {
    const code = z.string().parse(c.value);
    requireRule(countryCodes.has(code), "Выберите страну на карте");
    s.countries[id] = { code, locked: false };
    return "Игрок изменил свой выбор страны";
  }
  requireRule(s.countries[id]?.code, "Сначала выберите страну");
  s.countries[id].locked = true;
  if (s.roster.every((p) => s.countries[p]?.locked)) finishCountrySelection(s);
  return "Игрок подтвердил страну";
}
export function scoreFinal(s: GameState) {
  const q = s.question;
  if (q?.round !== 6) return;
  for (const id of s.roster) {
    const bet = s.bets[id] ?? 0;
    const code = s.countries[id]?.code ?? null;
    s.countries[id] = { code, locked: true };
    addPoints(s, id, code === q.answer ? bet : -bet);
  }
}
