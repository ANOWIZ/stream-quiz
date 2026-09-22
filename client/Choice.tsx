import type { GameView } from "../shared/types.js";
import { formatEventDate } from "../shared/dates.js";
export function Choice({
  v,
  act,
}: {
  v: GameView;
  act: (type: string, value?: unknown) => void;
}) {
  const q = v.question!;
  const v2 = v.config.rulesVersion === 2;
  const mine = v.self.playerId;
  const answer = mine ? v.answers[mine] : undefined;
  const revealed = v.phase === "reveal";
  const options =
    q.round === 2
      ? [
          ["before", "До"],
          ["after", "После"],
        ]
      : [
          ["a", q.options?.[0] ?? ""],
          ["b", q.options?.[1] ?? ""],
        ];
  return (
    <div className="choice-area">
      {q.round === 2 && (
        <div className="anchor-event">
          <span className="muted">ОПОРНОЕ СОБЫТИЕ</span>
          <strong>{q.anchorText}</strong>
        </div>
      )}
      {v2 && q.round === 2 && !revealed && (
        <p className="muted">Второе событие произошло ДО или ПОСЛЕ опорного?</p>
      )}
      {mine && !revealed && (
        <>
          <div className="choice-buttons">
            {options.map(([value, label]) => (
              <button
                key={value}
                className={answer?.choice === value ? "selected" : ""}
                disabled={
                  v.paused ||
                  !!answer?.locked ||
                  v.phase !== "answering" ||
                  !v.roster.includes(mine)
                }
                onClick={() => act(v2 ? "answerPreview" : "answer", value)}
              >
                {label}
              </button>
            ))}
          </div>
          {v2 && (
            <button
              className="primary big-button"
              disabled={
                !answer?.choice ||
                answer.locked ||
                v.paused ||
                v.phase !== "answering"
              }
              onClick={() => act("answer", answer?.choice)}
            >
              Подтвердить
            </button>
          )}
          <p className="answer-status" role="status">
            {answer?.locked
              ? "✓ Ответ принят. Ждём раскрытия."
              : v.phase === "awaitingReveal"
                ? "Ответы закрыты. Ведущий раскрывает результат."
                : "Выберите один вариант. Ответ увидите только вы."}
          </p>
        </>
      )}
      {revealed && q.round === 2 && (
        <p className="date-reveal">
          Опорное событие: <b>{formatEventDate(q.anchorDate)}</b> · Второе
          событие: <b>{formatEventDate(q.targetDate)}</b>
        </p>
      )}
      {revealed && (
        <div className="answer-results">
          {v.players.map((p) => (
            <p key={p.id}>
              <strong style={{ color: p.color }}>{p.name}</strong>
              <span>
                {options.find(
                  ([key]) =>
                    v.answers[p.id]?.locked && key === v.answers[p.id]?.choice,
                )?.[1] ?? "Нет ответа"}
              </span>
              <b>{v.deltas[p.id] ? "+" + v.deltas[p.id] : "0"}</b>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
