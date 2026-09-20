import { useEffect, useState } from "react";
import type { GameView } from "../shared/types.js";
export function Buzzer({
  v,
  act,
}: {
  v: GameView;
  act: (type: string, value?: unknown) => void;
}) {
  const id = v.self.playerId;
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (v.phase === "buzzing") setPressed(false);
  }, [v.phase, v.question?.id]);
  const can =
    !!id &&
    v.roster.includes(id) &&
    v.phase === "buzzing" &&
    !v.paused &&
    !v.blocked.includes(id) &&
    !pressed;
  const buzz = () => {
    if (can) {
      setPressed(true);
      act("buzz");
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        e.code === "Space" &&
        !e.repeat &&
        !(e.target as HTMLElement)?.isContentEditable &&
        !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tag)
      ) {
        e.preventDefault();
        buzz();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const winner = v.players.find((p) => p.id === v.buzzWinner);
  if (v.phase === "reveal") return null;
  return (
    <div className="buzzer-area">
      {v.phase === "studying" ? (
        <p className="answer-status">
          Смотрите внимательно. Кнопка появится вместе с вопросом.
        </p>
      ) : (
        <>
          {winner && (
            <div className="voice-player">
              <span className="avatar" style={{ background: winner.color }}>
                {winner.name.slice(0, 1)}
              </span>
              <div>
                <span className="muted">ОТВЕЧАЕТ ГОЛОСОМ</span>
                <h2>{winner.name}</h2>
              </div>
            </div>
          )}
          {id && (
            <>
              <button
                id="buzzbtn"
                className={
                  "buzzer-button " +
                  (v.blocked.includes(id)
                    ? "wrong"
                    : v.buzzWinner === id
                      ? "mine"
                      : can
                        ? "armed"
                        : "locked")
                }
                disabled={!can}
                onClick={buzz}
              >
                <span>
                  {v.blocked.includes(id)
                    ? "НЕВЕРНО"
                    : v.buzzWinner === id
                      ? "ТЫ ОТВЕЧАЕШЬ"
                      : can
                        ? "ОТВЕТИТЬ"
                        : "КНОПКА ЗАКРЫТА"}
                </span>
              </button>
              <p className="muted">
                Нажмите кнопку или <kbd>Space</kbd>
              </p>
            </>
          )}
          {v.self.role === "host" && v.phase === "judging" && (
            <div className="judge-controls">
              <button
                className="btn green"
                disabled={v.paused}
                onClick={() => act("judge", true)}
              >
                Верно
              </button>
              <button
                className="btn red"
                disabled={v.paused}
                onClick={() => act("judge", false)}
              >
                Неверно
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
