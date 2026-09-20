import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { GameView } from "../shared/types.js";
import {
  comparisonLabels,
  comparisonResult,
  type ComparisonChoice,
} from "../shared/comparison.js";
export function Comparison({
  v,
  act,
}: {
  v: Pick<
    GameView,
    | "question"
    | "self"
    | "players"
    | "answers"
    | "activePlayerId"
    | "roster"
    | "paused"
    | "phase"
    | "config"
    | "deltas"
  >;
  act: (type: string, value?: unknown) => void;
}) {
  const q = v.question!;
  const min = q.min!,
    max = q.max!,
    span = max - min;
  const mine = v.self.playerId;
  const active = v.players.find((p) => p.id === v.activePlayerId);
  const isActive = mine === active?.id;
  const answer = mine ? v.answers[mine] : undefined;
  const guess =
    v.answers[v.activePlayerId ?? ""]?.value ?? Math.round((min + max) / 2);
  const revealed = v.phase === "reveal";
  const [local, setLocal] = useState(guess);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const can = !!mine && v.roster.includes(mine) && !v.paused && !answer?.locked;
  const editing = isActive && v.phase === "point";
  const value = editing ? local : guess;
  const change = (value: number) => {
    const next = Math.max(
      Math.ceil(min),
      Math.min(Math.floor(max), Math.round(value)),
    );
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => act("pointPreview", next), 100);
  };
  const pointer = (e: PointerEvent<SVGSVGElement>) => {
    if (!can || !editing) return;
    const r = e.currentTarget.getBoundingClientRect();
    let degrees =
      (Math.atan2(
        e.clientY - r.top - r.height / 2,
        e.clientX - r.left - r.width / 2,
      ) *
        180) /
      Math.PI;
    degrees = (degrees - 135 + 360) % 360;
    if (degrees > 270) degrees = degrees > 315 ? 0 : 270;
    change(min + (span * degrees) / 270);
  };
  const xy = (n: number) => {
    const angle =
      ((135 + 270 * Math.max(0, Math.min(1, (n - min) / span))) * Math.PI) /
      180;
    return [160 + 124 * Math.cos(angle), 160 + 124 * Math.sin(angle)];
  };
  const arc = (a: number, b: number) => {
    const start = xy(a),
      end = xy(b);
    return (
      "M" +
      start.join(" ") +
      " A124 124 0 " +
      (((b - a) / span) * 270 > 180 ? 1 : 0) +
      " 1 " +
      end.join(" ")
    );
  };
  const result = revealed
    ? comparisonResult(
        {
          answer: Number(q.answer),
          numericKind: q.numericKind,
          unit: q.unit ?? "",
        },
        guess,
        v.config,
      )
    : null;
  const marker = xy(value);
  return (
    <div className="comparison">
      <div className="circular-scale">
        <svg
          viewBox="0 0 320 320"
          role={editing ? "slider" : "img"}
          aria-label={editing ? "Точная отметка" : "Общая числовая шкала"}
          aria-valuemin={editing ? min : undefined}
          aria-valuemax={editing ? max : undefined}
          aria-valuenow={editing ? value : undefined}
          aria-disabled={editing ? !can : undefined}
          tabIndex={editing && can ? 0 : undefined}
          onPointerDown={(e) => {
            if (editing && can) {
              e.currentTarget.setPointerCapture(e.pointerId);
              pointer(e);
            }
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) pointer(e);
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onKeyDown={(e) => {
            if (!can || !editing) return;
            const n =
              e.key === "Home"
                ? min
                : e.key === "End"
                  ? max
                  : e.key === "ArrowRight" || e.key === "ArrowUp"
                    ? value + 1
                    : e.key === "ArrowLeft" || e.key === "ArrowDown"
                      ? value - 1
                      : null;
            if (n !== null) {
              e.preventDefault();
              change(n);
            }
          }}
        >
          <path
            d={arc(min, max)}
            fill="none"
            stroke="#35404e"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {result && (
            <path
              d={arc(
                Math.max(min, Number(q.answer) - result.tolerance),
                Math.min(max, Number(q.answer) + result.tolerance),
              )}
              fill="none"
              stroke="#80dcc8"
              strokeWidth="18"
            />
          )}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const [x, y] = xy(min + t * span);
            return <circle key={t} cx={x} cy={y} r="3" fill="#a9b7cf" />;
          })}
          <line
            x1="160"
            y1="160"
            x2={marker[0]}
            y2={marker[1]}
            stroke={active?.color ?? "#ffd83d"}
            strokeWidth="3"
          />
          <circle
            cx={marker[0]}
            cy={marker[1]}
            r="10"
            fill="#ffd83d"
            stroke="#10151e"
            strokeWidth="3"
          />
          {revealed && (
            <circle
              cx={xy(Number(q.answer))[0]}
              cy={xy(Number(q.answer))[1]}
              r="7"
              fill="#80dcc8"
              stroke="#fff"
              strokeWidth="2"
            />
          )}
          <rect x="76" y="129" width="168" height="75" rx="12" fill="#141b2b" />
          <text x="160" y="162" textAnchor="middle" className="circle-value">
            {value}
          </text>
          <text x="160" y="188" textAnchor="middle" className="circle-unit">
            {q.unit}
          </text>
          <text x="50" y="283" textAnchor="middle" className="circle-endpoint">
            {min}
          </text>
          <text x="270" y="283" textAnchor="middle" className="circle-endpoint">
            {max}
          </text>
        </svg>
        <p className="muted">
          {active?.name}
          {v.answers[v.activePlayerId ?? ""]?.locked
            ? " · число подтверждено"
            : " · выбирает число"}
        </p>
      </div>
      <div className="comparison-actions">
        {!revealed && (
          <p className="muted">
            Допуск:{" "}
            {(q.numericKind ?? (q.unit === "%" ? "percent" : "number")) ===
            "percent"
              ? `±${v.config.comparison.percentTolerance} п. п.`
              : `±${Number((v.config.comparison.relativeTolerance * 100).toFixed(6))}% от правильного ответа`}
          </p>
        )}
        {editing && (
          <>
            <input
              type="number"
              aria-label="Числовой ответ"
              min={min}
              max={max}
              step="1"
              value={local}
              disabled={!can}
              onChange={(e) => change(Number(e.target.value))}
            />
            <button
              className="primary big-button"
              disabled={!can}
              onClick={() => {
                if (timer.current) clearTimeout(timer.current);
                act("point", local);
              }}
            >
              Подтвердить
            </button>
          </>
        )}
        {mine && !isActive && v.phase === "comparison" && (
          <>
            <div className="choice-buttons">
              {(
                Object.entries(comparisonLabels) as [ComparisonChoice, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={answer?.choice === key ? "selected" : ""}
                  disabled={!can}
                  onClick={() => act("comparePreview", key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="primary big-button"
              disabled={!can || !answer?.choice}
              onClick={() => act("compare", answer?.choice)}
            >
              Подтвердить
            </button>
          </>
        )}
        {!revealed && answer?.locked && (
          <p className="answer-status">✓ Ответ подтверждён</p>
        )}
        {!revealed && !editing && v.phase === "point" && (
          <p className="muted">Число выставляет {active?.name}</p>
        )}
        {result && (
          <>
            <p>
              Правильное число:{" "}
              <strong>
                {q.answer} {q.unit}
              </strong>
            </p>
            <p>
              Отклонение: {Number(result.deviation.toFixed(6))} · допуск: ±
              {Number(result.tolerance.toFixed(6))}
            </p>
            <p>
              Верный вариант: <strong>{comparisonLabels[result.choice]}</strong>
            </p>
            <div className="answer-results">
              {v.players.map((p) => (
                <p key={p.id}>
                  <strong style={{ color: p.color }}>{p.name}</strong>
                  <span>
                    {p.id === active?.id
                      ? v.answers[p.id]?.locked
                        ? String(guess)
                        : "Нет ответа"
                      : v.answers[p.id]?.locked
                        ? comparisonLabels[
                            v.answers[p.id].choice as ComparisonChoice
                          ]
                        : "Нет ответа"}
                  </span>
                  <b>+{v.deltas[p.id] ?? 0}</b>
                </p>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
