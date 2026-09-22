import type { GameView } from "./types.js";

export function roundScoringDescription(
  v: Pick<GameView, "round" | "config" | "board" | "question">,
): string {
  const c = v.config;
  if (v.round === 1)
    return c.rulesVersion === 2
      ? `Верный ответ — ${c.comparison.points} очков, неверный — 0`
      : `Число — до ${c.numeric.activePoints[0]} очков по допуску; узкий диапазон — ${c.numeric.narrowPoints}, широкий — ${c.numeric.widePoints}; неверный — 0`;
  if (v.round === 2 || v.round === 3)
    return `Верный ответ — ${v.round === 2 ? c.choicePoints.beforeAfter : c.choicePoints.twoWorlds} очков, неверный — 0`;
  if (v.round === 4 || v.round === 5) {
    if (c.rulesVersion === 2)
      return `Верный ответ — +${v.round === 4 ? c.buzzerPoints.fragmentCorrect : c.buzzerPoints.memoryCorrect} очков, неверный — −${v.round === 4 ? c.buzzerPoints.fragmentWrong : c.buzzerPoints.memoryWrong}`;
    const values = [
      ...new Set(
        v.question
          ? [v.question.value]
          : v.board.filter((q) => !q.used).map((q) => q.value),
      ),
    ].sort((a, b) => a - b);
    const points = (values.length ? values : c.boardValues).join(" / ");
    return `Верный ответ — +${points} очков, неверный — −${points}`;
  }
  return v.round === 6
    ? "Верная страна — плюс ставка, неверная или нет ответа — минус ставка"
    : "";
}
