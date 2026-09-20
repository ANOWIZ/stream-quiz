import { z } from "zod";
import type { GameState, Identity, Command } from "../shared/types.js";
import { requireRule, arm, addPoints, reveal } from "./game.js";
export function buzzerCommand(
  s: GameState,
  who: Identity,
  c: Command,
  now: number,
  receivedAt = now,
): string | null {
  if (c.type !== "buzz" && c.type !== "judge") return null;
  const q = s.question;
  requireRule(q?.round === 4 || q?.round === 5, "Сейчас другой раунд");
  if (c.type === "buzz") {
    requireRule(
      who.role === "player" && who.playerId,
      "Кнопка доступна игрокам",
    );
    const id = who.playerId;
    requireRule(
      ["buzzing", "judging"].includes(s.phase) && !s.blocked.includes(id),
      "Кнопка сейчас заблокирована",
    );
    const last = [...s.buzzes].reverse().find((b) => b.accepted);
    requireRule(
      s.phase === "buzzing" ||
        !last ||
        !s.buzzes.some((b) => b.playerId === id && b.sequence >= last.sequence),
      "Нажатие уже зарегистрировано",
    );
    const accepted = s.phase === "buzzing";
    s.buzzes.push({
      playerId: id,
      at: receivedAt,
      sequence: s.buzzes.length + 1,
      accepted,
    });
    if (accepted) {
      s.buzzWinner = id;
      s.phase = "judging";
      arm(s, s.config.timers.judge, now);
    }
    return accepted
      ? "Первое нажатие: " + s.players.find((p) => p.id === id)?.name
      : "Нажатие зарегистрировано в очереди";
  }
  requireRule(
    who.role === "host" && s.phase === "judging" && s.buzzWinner,
    "Сейчас нет отвечающего игрока",
  );
  const correct = z.boolean().parse(c.value);
  const winner = s.buzzWinner;
  addPoints(s, winner, correct ? q.value : -q.value);
  if (correct) {
    reveal(s);
    return "Голосовой ответ верный";
  }
  s.blocked.push(winner);
  s.buzzWinner = null;
  if (s.roster.every((id) => s.blocked.includes(id))) reveal(s);
  else {
    s.phase = "buzzing";
    arm(s, s.config.timers.buzz, now);
  }
  return "Голосовой ответ неверный, игрок заблокирован до конца вопроса";
}
