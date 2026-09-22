import type { GameView } from "../shared/types.js";
import {
  comparisonLabels,
  type ComparisonChoice,
} from "../shared/comparison.js";

export function NumericResults({
  v,
}: {
  v: Pick<
    GameView,
    "players" | "answers" | "deltas" | "answerResults" | "config" | "question"
  >;
}) {
  const labels = {
    correct: "Верно",
    partial: "Частичный зачёт",
    wrong: "Неверно",
    missing: "Нет ответа",
  };
  return (
    <div
      className="answer-results numeric-results"
      aria-label="Результаты ответов"
    >
      {v.players
        .filter((p) => v.answerResults?.[p.id])
        .map((p) => {
          const result = v.answerResults![p.id];
          const a = v.answers[p.id];
          const text =
            a?.value !== undefined
              ? a.value + " " + (v.question?.unit ?? "")
              : a?.choice
                ? comparisonLabels[a.choice as ComparisonChoice]
                : a?.start !== undefined && a.width
                  ? a.start +
                    " — " +
                    Number(
                      (
                        a.start +
                        (v.question!.max! - v.question!.min!) *
                          v.config.numeric[a.width]
                      ).toFixed(2),
                    )
                  : "—";
          const delta = v.deltas[p.id] ?? 0;
          return (
            <p key={p.id} data-result={result}>
              <strong style={{ color: p.color }}>{p.name}</strong>
              <span>{text}</span>
              <span className="numeric-verdict">{labels[result]}</span>
              <b>
                {delta > 0 ? "+" : ""}
                {delta} очков
              </b>
            </p>
          );
        })}
    </div>
  );
}
