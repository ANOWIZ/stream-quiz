import { useRef, useState, useEffect } from "react";
import type { GameView } from "../shared/types.js";
import { NumericResults } from "./NumericResults.js";
export function Numeric({
  v,
  act,
}: {
  v: GameView;
  act: (type: string, value?: unknown) => void;
}) {
  const q = v.question!;
  const min = q.min!;
  const max = q.max!;
  const span = max - min;
  const mine = v.self.playerId;
  const isActive = mine === v.activePlayerId;
  const [point, setPoint] = useState(
    Math.round((mine ? v.answers[mine]?.value : undefined) ?? min + span / 2),
  );
  const [start, setStart] = useState(min + span * 0.4);
  const [width, setWidth] = useState<"narrow" | "wide">("narrow");
  const draft = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (draft.current) clearTimeout(draft.current);
    },
    [],
  );
  const size = span * v.config.numeric[width];
  const locked = !!(mine && v.answers[mine]?.locked);
  const revealed = v.phase === "reveal";
  const can = mine && v.roster.includes(mine) && !locked && !v.paused;
  const changingPoint = isActive && v.phase === "point";
  const markerValue = changingPoint
    ? point
    : v.answers[v.activePlayerId ?? ""]?.value;
  const setIntegerPoint = (value: number) => {
    const next = Math.max(
      Math.ceil(min),
      Math.min(Math.floor(max), Math.round(value)),
    );
    setPoint(next);
    if (draft.current) clearTimeout(draft.current);
    draft.current = setTimeout(() => act("pointPreview", next), 100);
  };
  const sendDraft = (next: number, nextWidth = width) => {
    if (draft.current) clearTimeout(draft.current);
    draft.current = setTimeout(
      () => act("range", { start: next, width: nextWidth, locked: false }),
      140,
    );
  };
  const percent = (n: number) => ((n - min) / span) * 100;
  return (
    <div className="numeric">
      <div className="scale-endpoints">
        <span>
          {min} {q.unit}
        </span>
        <span>
          {max} {q.unit}
        </span>
      </div>
      <div className="scale-track">
        <div className="scale-ticks" />
        {markerValue !== undefined && (
          <div
            className="primary-point-marker"
            style={{
              left: percent(markerValue) + "%",
              color: v.players.find((p) => p.id === v.activePlayerId)?.color,
            }}
          >
            <b>
              {Math.round(markerValue)} {q.unit}
            </b>
            <i />
          </div>
        )}
        {changingPoint && (
          <input
            className="main-scale-input"
            aria-label="Точная отметка"
            type="range"
            min={Math.ceil(min)}
            max={Math.floor(max)}
            step={1}
            value={point}
            disabled={!can}
            onChange={(e) => setIntegerPoint(Number(e.target.value))}
          />
        )}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <span className="tick-label" key={t} style={{ left: t * 100 + "%" }}>
            {Math.round(min + span * t)}
          </span>
        ))}
      </div>
      <div className="range-lanes">
        {v.players
          .filter((p) => v.answers[p.id] && p.id !== v.activePlayerId)
          .map((p) => {
            const a = v.answers[p.id];
            return (
              <div className="range-lane" key={p.id}>
                <span className="range-name" style={{ color: p.color }}>
                  {p.name} {!a.locked ? "· выбирает" : ""}
                </span>
                <div className="range-space">
                  {a.value !== undefined ? (
                    <div
                      className="point-marker"
                      style={{ left: percent(a.value) + "%", color: p.color }}
                    >
                      <i />
                      <b>{a.value}</b>
                    </div>
                  ) : a.start !== undefined && a.width ? (
                    <div
                      className="range-marker"
                      style={{
                        left: percent(a.start) + "%",
                        width: v.config.numeric[a.width] * 100 + "%",
                        background: p.color,
                      }}
                    >
                      <b>
                        {Number(a.start.toFixed(1))} —{" "}
                        {Number(
                          (a.start + span * v.config.numeric[a.width]).toFixed(
                            1,
                          ),
                        )}
                      </b>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
      </div>
      {revealed && (
        <div className="correct-scale">
          {q.acceptedMin !== undefined && q.acceptedMax !== undefined && (
            <div
              className="accepted-range"
              style={{
                left: percent(q.acceptedMin) + "%",
                width: percent(q.acceptedMax) - percent(q.acceptedMin) + "%",
              }}
            />
          )}
          <div
            className="correct-marker"
            style={{ left: percent(Number(q.answer)) + "%" }}
          >
            <span>
              Ответ: {q.answer} {q.unit}
            </span>
          </div>
        </div>
      )}
      {revealed && q.acceptedMin !== undefined && (
        <p className="accepted-range-caption">
          Засчитывается: {q.acceptedMin}–{q.acceptedMax} {q.unit}
        </p>
      )}
      {revealed && <NumericResults v={v} />}
      {!revealed && (
        <div className="answer-area">
          {isActive && v.phase === "point" ? (
            <>
              <input
                aria-label="Числовой ответ"
                type="number"
                min={min}
                max={max}
                step={1}
                disabled={!can}
                value={point}
                onChange={(e) => setIntegerPoint(Number(e.target.value))}
              />
              <button
                className="primary big-button"
                disabled={!can}
                onClick={() => {
                  if (draft.current) clearTimeout(draft.current);
                  act("point", point);
                }}
              >
                Зафиксировать отметку
              </button>
            </>
          ) : mine && !isActive && v.phase === "ranges" ? (
            <>
              <div className="segmented">
                {(["narrow", "wide"] as const).map((w) => (
                  <button
                    key={w}
                    className={w === width ? "selected" : ""}
                    disabled={!can}
                    onClick={() => {
                      setWidth(w);
                      const n = Math.min(
                        start,
                        max - span * v.config.numeric[w],
                      );
                      setStart(n);
                      sendDraft(n, w);
                    }}
                  >
                    {w === "narrow" ? "Узкий" : "Широкий"} ·{" "}
                    {v.config.numeric[w] * 100}%
                  </button>
                ))}
              </div>
              <label>
                Ваш диапазон: {Number(start.toFixed(1))} —{" "}
                {Number((start + size).toFixed(1))} {q.unit}
                <input
                  aria-label="Положение диапазона"
                  type="range"
                  min={min}
                  max={max - size}
                  step={span / 1000}
                  value={start}
                  disabled={!can}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setStart(n);
                    sendDraft(n);
                  }}
                />
              </label>
              <button
                className="primary big-button"
                disabled={!can}
                onClick={() => {
                  if (draft.current) clearTimeout(draft.current);
                  act("range", { start, width, locked: true });
                }}
              >
                {locked ? "Диапазон зафиксирован" : "Зафиксировать диапазон"}
              </button>
            </>
          ) : (
            <p className="muted">
              {v.phase === "point"
                ? "Ждём точную отметку активного игрока."
                : "Игроки выбирают диапазоны."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
