import { z } from "zod";
import type { GameState, Identity, Command } from "../shared/types.js";
import { requireRule, stopTimer, addPoints, reveal } from "./game.js";
export function choiceCommand(
  s: GameState,
  who: Identity,
  c: Command,
  _now: number,
): string | null {
  if (c.type !== "answer") return null;
  const q = s.question;
  requireRule(q?.round === 2 || q?.round === 3, "Сейчас другой раунд");
  requireRule(
    who.role === "player" && who.playerId && s.phase === "answering",
    "Ответ сейчас недоступен",
  );
  const id = who.playerId;
  requireRule(!s.answers[id]?.locked, "Ответ уже отправлен");
  const choice = (
    q.round === 2 ? z.enum(["before", "after"]) : z.enum(["a", "b"])
  ).parse(c.value);
  s.answers[id] = { choice, locked: true };
  if (s.roster.every((p) => s.answers[p]?.locked)) {
    if (q.round === 3) reveal(s);
    else {
      s.phase = "awaitingReveal";
      stopTimer(s);
    }
  }
  return "Игрок зафиксировал секретный ответ";
}
export function scoreChoice(s: GameState) {
  const q = s.question;
  if (q?.round !== 2 && q?.round !== 3) return;
  for (const id of s.roster)
    if (s.answers[id]?.locked && s.answers[id].choice === q.answer)
      addPoints(
        s,
        id,
        q.round === 2
          ? s.config.choicePoints.beforeAfter
          : s.config.choicePoints.twoWorlds,
      );
}
