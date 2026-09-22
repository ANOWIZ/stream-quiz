import type { Config } from "./config.js";
import type { Question } from "./content.js";
import type { Answer } from "./types.js";

export function numericScore(
  q: Extract<Question, { round: 1 }>,
  answer: Answer | undefined,
  active: boolean,
  config: Config,
) {
  if (!answer?.locked) return { points: 0, result: "missing" as const };
  if (active && answer.value !== undefined) {
    if (q.acceptedMin !== undefined && q.acceptedMax !== undefined) {
      const correct =
        answer.value >= q.acceptedMin && answer.value <= q.acceptedMax;
      return {
        points: correct ? config.numeric.activePoints[0] : 0,
        result: correct ? ("correct" as const) : ("wrong" as const),
      };
    }
    const error = Math.abs(q.answer - answer.value) / (q.max - q.min);
    const tier = config.numeric.thresholds.findIndex((t) => error <= t + 1e-10);
    return {
      points: tier < 0 ? 0 : config.numeric.activePoints[tier],
      result:
        tier < 0
          ? ("wrong" as const)
          : tier === 0
            ? ("correct" as const)
            : ("partial" as const),
    };
  }
  const correct =
    answer.start !== undefined &&
    !!answer.width &&
    q.answer >= answer.start - 1e-8 &&
    q.answer <=
      answer.start + (q.max - q.min) * config.numeric[answer.width] + 1e-8;
  return {
    points: correct
      ? answer.width === "narrow"
        ? config.numeric.narrowPoints
        : config.numeric.widePoints
      : 0,
    result: correct ? ("correct" as const) : ("wrong" as const),
  };
}
