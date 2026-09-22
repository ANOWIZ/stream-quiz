import type { Config } from "./config.js";
import type { Question } from "./content.js";
export type ComparisonChoice = "higher" | "lower" | "equal";
export function numericKind(q: {
  numericKind?: "number" | "percent";
  unit?: string;
}) {
  return q.numericKind ?? (q.unit?.trim() === "%" ? "percent" : "number");
}
export function comparisonResult(
  q: Pick<
    Extract<Question, { round: 1 }>,
    "answer" | "numericKind" | "unit" | "acceptedMin" | "acceptedMax"
  >,
  guess: number,
  config: Config,
) {
  const tolerance =
    numericKind(q) === "percent"
      ? config.comparison.percentTolerance
      : Math.abs(q.answer) * config.comparison.relativeTolerance;
  const deviation = Math.abs(q.answer - guess);
  const epsilon =
    tolerance === 0
      ? 0
      : Number.EPSILON * Math.max(1, Math.abs(q.answer), Math.abs(guess)) * 8;
  const lower = q.acceptedMin ?? q.answer - tolerance;
  const upper = q.acceptedMax ?? q.answer + tolerance;
  const correct = guess >= lower - epsilon && guess <= upper + epsilon;
  const choice: ComparisonChoice = correct
    ? "equal"
    : q.answer > guess
      ? "higher"
      : "lower";
  return { tolerance, deviation, correct, choice, lower, upper };
}
export const comparisonLabels: Record<ComparisonChoice, string> = {
  higher: "Больше",
  lower: "Меньше",
  equal: "Столько же",
};
