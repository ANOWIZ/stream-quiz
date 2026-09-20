import { Modal } from "./Modal.js";
import { useState } from "react";
import { Map, X, Trophy } from "lucide-react";
import type { GameView } from "../shared/types.js";
import { Panorama } from "./Panorama.js";
import { WorldMap } from "./WorldMap.js";
export function Final({
  v,
  act,
  displayOnly = false,
}: {
  v: GameView;
  displayOnly?: boolean;
  act: (type: string, value?: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [bet, setBet] = useState("");
  const me = v.players.find((p) => p.id === v.self.playerId);
  const max = Math.floor(Math.max(0, me?.score ?? 0) * v.config.final.betLimit);
  const mine = me ? v.countries[me.id] : undefined;
  const revealed = v.phase === "finished";
  const v2 = v.config.rulesVersion === 2;
  const loading = v.phase === "loadingPanorama";
  const waiting = v.phase === "awaitingReveal";
  const reportLoading =
    v2 && !displayOnly && (loading || v.phase === "locating");
  const betValue = Number(bet);
  const validBet =
    Number.isInteger(betValue) && betValue >= 0 && betValue <= max;
  if (v.phase === "betting")
    return (
      <div className="bet-area final-input">
        {me ? (
          <>
            <label>
              Ставка
              <input
                aria-label="Ставка"
                type="number"
                min="0"
                max={max}
                step="1"
                placeholder="0"
                value={v.bets[me.id] ?? bet}
                disabled={v.bets[me.id] !== undefined || v.paused}
                onChange={(e) =>
                  setBet(e.target.value.replace(/^0+(?=\d)/, ""))
                }
              />
            </label>
            <button
              className="primary big-button"
              disabled={
                v.bets[me.id] !== undefined ||
                v.paused ||
                !v.roster.includes(me.id) ||
                !validBet
              }
              onClick={() => act("bet", betValue)}
            >
              {v.bets[me.id] !== undefined
                ? "Ставка принята"
                : "Подтвердить ставку"}
            </button>
            {!validBet && (
              <p role="alert" className="error">
                Введите целую ставку от 0 до {max}.
              </p>
            )}
            <p className="muted">После подтверждения ставку изменить нельзя.</p>
          </>
        ) : (
          <p className="muted">
            Игроки делают ставки. Суммы останутся скрыты до финала.
          </p>
        )}
      </div>
    );
  if (revealed) {
    const high = v.players.length
      ? Math.max(...v.players.map((p) => p.score))
      : 0;
    const winners = v.players.filter((p) => p.score === high);
    const picks = v.players.flatMap((p) =>
      v.countries[p.id]?.code
        ? [
            {
              code: v.countries[p.id].code!,
              name: p.name,
              color: p.color,
              point: v.countries[p.id].point,
            },
          ]
        : [],
    );
    return (
      <div className="final-results gameover">
        <WorldMap
          picks={picks}
          correct={String(v.question?.answer)}
          correctPoint={v.question?.location}
          disabled
        />
        <div className="winner-announcement">
          {winners.length > 0 && <Trophy size={38} />}
          <p className="eyebrow">
            {winners.length === 0
              ? "ПАРТИЯ ЗАВЕРШЕНА"
              : winners.length === 1
                ? "ПОБЕДИТЕЛЬ ПО ОБЩЕМУ СЧЁТУ"
                : "ПОБЕДИТЕЛИ ПО ОБЩЕМУ СЧЁТУ"}
          </p>
          <h2>
            {winners.length
              ? winners.map((p) => p.name).join(" и ")
              : "Игра без участников"}
          </h2>
          {winners.length > 0 && (
            <strong>{high.toLocaleString("ru")} очков</strong>
          )}
          <div className="podium" aria-label="Лидеры игры">
            {[...v.players]
              .sort((a, b) => b.score - a.score)
              .slice(0, 3)
              .map((p, i) => (
                <div className="pod" key={p.id} data-place={i + 1}>
                  <div className="pod-rank">ТОП {i + 1}</div>
                  <div className="p1">{p.name}</div>
                  <div className="pscore">{p.score.toLocaleString("ru")}</div>
                </div>
              ))}
          </div>
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: winners.length ? 26 : 0 }, (_, i) => (
              <i
                key={i}
                style={{
                  left: ((i * 37) % 100) + "%",
                  background: v.players[i % v.players.length]?.color,
                  animationDelay: (i % 7) * 0.13 + "s",
                  transform: "rotate(" + i * 21 + "deg)",
                }}
              />
            ))}
          </div>
        </div>
        <p className="place-reveal">
          {v.question?.place} ·{" "}
          {new Intl.DisplayNames(["ru"], { type: "region" }).of(
            String(v.question?.answer),
          )}
        </p>
        <div className="final-table">
          {[...v.players]
            .sort((a, b) => b.score - a.score)
            .map((p, i) => (
              <div
                key={p.id}
                data-result-player={p.id}
                data-correct={String(v.finalCorrect?.[p.id] === true)}
              >
                <b>{i + 1}</b>
                <strong style={{ color: p.color }}>{p.name}</strong>
                <span>
                  <span
                    className={
                      "final-verdict " +
                      (v.finalCorrect?.[p.id] ? "correct" : "incorrect")
                    }
                  >
                    {v.finalCorrect?.[p.id] ? "Верно" : "Неверно"}
                  </span>
                  {v.countries[p.id]?.code
                    ? new Intl.DisplayNames(["ru"], { type: "region" }).of(
                        v.countries[p.id].code!,
                      )
                    : "Нет ответа"}
                </span>
                <span>Ставка {v.bets[p.id] ?? 0}</span>
                <b>
                  {v.deltas[p.id] > 0 ? "+" : ""}
                  {v.deltas[p.id] ?? 0}
                </b>
                <strong>{p.score}</strong>
              </div>
            ))}
        </div>
      </div>
    );
  }
  const mapActions = (
    <div className="map-dialog-actions">
      <button onClick={() => setOpen(false)}>Вернуться к панораме</button>
      {me && (
        <button
          className="primary"
          disabled={
            !mine?.code || mine.locked || v.paused || v.phase !== "locating"
          }
          onClick={() => {
            act("confirmCountry");
            setOpen(false);
          }}
        >
          Подтвердить страну
        </button>
      )}
    </div>
  );
  return (
    <div className="final-play">
      {v.question?.panorama && (
        <Panorama
          location={v.question.panorama}
          onLoading={reportLoading ? () => act("panoramaLoading") : undefined}
          onReady={reportLoading ? () => act("panoramaReady") : undefined}
          onError={
            reportLoading
              ? (message) => act("panoramaError", message)
              : undefined
          }
        />
      )}
      {loading && (
        <div className="notice" role="status">
          <p>Подготовка панорамы. Таймер начнётся после загрузки.</p>
          {v.self.role === "host" ? (
            <>
              {[
                { id: "host", name: "Ведущий" },
                ...v.players.filter((p) => v.roster.includes(p.id)),
              ].map((p) => (
                <p key={p.id}>
                  {p.name}:{" "}
                  {v.panoramaErrors[p.id] ||
                    (v.panoramaReady[p.id] ? "готово" : "загрузка / нет связи")}
                </p>
              ))}
            </>
          ) : (
            <p>{me && v.panoramaErrors[me.id]}</p>
          )}
        </div>
      )}
      {!displayOnly && (
        <button
          className="map-toggle primary"
          disabled={loading}
          onClick={() => setOpen(true)}
        >
          <Map size={23} />
          {me && !waiting && !mine?.locked ? "Выбрать страну" : "Открыть карту"}
        </button>
      )}
      {waiting ? (
        <p className="answer-status" role="status">
          Ответы приняты. Ждём, когда ведущий покажет результаты.
        </p>
      ) : (
        mine?.locked && (
          <p className="answer-status">
            ✓ Страна подтверждена. Ждём остальных.
          </p>
        )
      )}
      {open && (
        <Modal label="Выбор страны" onClose={() => setOpen(false)}>
          <div className="map-dialog">
            <header>
              <h2>
                {mine?.locked ? "Ваш ответ принят" : v.config.roundNames[6]}
              </h2>
              <button
                aria-label="Вернуться к панораме"
                onClick={() => setOpen(false)}
              >
                <X size={23} />
              </button>
            </header>
            <WorldMap
              fullscreenActions={mapActions}
              selected={mine?.code}
              selectedPoint={mine?.point}
              onSelect={(code, point) =>
                act("country", v2 ? { code, point } : code)
              }
              disabled={
                !me || mine?.locked || v.paused || v.phase !== "locating"
              }
            />
            {mapActions}
          </div>
        </Modal>
      )}
    </div>
  );
}
