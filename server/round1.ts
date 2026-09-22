import { z } from "zod";
import { numericScore } from "../shared/numeric-score.js";
import type { Command, GameState, Identity } from "../shared/types.js";
import { activeId, arm, requireRule, reveal, addPoints } from "./game.js";
export function numericCommand(
  s: GameState,
  who: Identity,
  c: Command,
  now: number,
): string | null {
  if (!["point", "pointPreview", "range"].includes(c.type)) return null;
  requireRule(who.role === "player" && who.playerId, "Отвечают только игроки");
  const id = who.playerId;
  const q = s.question;
  requireRule(q?.round === 1, "Сейчас другой раунд");
  requireRule(!s.answers[id]?.locked, "Ответ уже зафиксирован");
  if (c.type === "point" || c.type === "pointPreview") {
    requireRule(
      s.phase === "point" && id === activeId(s),
      "Точную отметку ставит активный игрок",
    );
    const value = z.number().int().min(q.min).max(q.max).parse(c.value);
    s.answers[id] = { value, locked: c.type === "point" };
    if (c.type === "pointPreview") return "Активный игрок переместил отметку";
    s.phase = "ranges";
    arm(s, s.config.timers.ranges, now);
    if (s.roster.every((playerId) => playerId === id)) reveal(s);
    return "Точная отметка зафиксирована";
  }
  requireRule(
    s.phase === "ranges" && id !== activeId(s),
    "Сейчас нельзя установить диапазон",
  );
  const v = z
    .object({
      start: z.number().finite(),
      width: z.enum(["narrow", "wide"]),
      locked: z.boolean(),
    })
    .parse(c.value);
  const size = (q.max - q.min) * s.config.numeric[v.width];
  requireRule(
    v.start >= q.min && v.start + size <= q.max + 1e-8,
    "Диапазон за пределами шкалы",
  );
  s.answers[id] = v;
  if (
    s.roster.filter((p) => p !== activeId(s)).every((p) => s.answers[p]?.locked)
  )
    reveal(s);
  return v.locked ? "Диапазон зафиксирован" : "Диапазон перемещён";
}
export function scoreNumeric(s: GameState) {
  const q = s.question;
  if (q?.round !== 1) return;
  for (const id of s.roster) {
    const { points } = numericScore(
      q,
      s.answers[id],
      id === activeId(s),
      s.config,
    );
    if (points) addPoints(s, id, points);
  }
}
