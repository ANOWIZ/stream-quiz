import { useDialogs } from "./Dialogs.js";
import { Comparison } from "./Comparison.js";
import { api } from "./api.js";
import { useSounds, unlockSound } from "./sound.js";
import { Media } from "./Media.js";
import { Final } from "./Final.js";
import { Buzzer } from "./Buzzer.js";
import { Choice } from "./Choice.js";
import { Numeric } from "./Numeric.js";
import { useState, useEffect } from "react";
import {
  Settings2,
  ChevronRight,
  Maximize,
  Timer,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { GameView } from "../shared/types.js";
import { isObs as obs } from "./surface.js";
import type { ReactNode } from "react";
export function Game({
  view: v,
  act,
  navigation,
}: {
  view: GameView;
  navigation?: ReactNode;
  act: (type: string, value?: unknown) => void;
}) {
  const { showMessage, confirmAction, requestValue } = useDialogs();
  const [panel, setPanel] = useState(false);
  const [clean, setClean] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [amount, setAmount] = useState(100);
  const [reason, setReason] = useState("");
  const [scorePlayer, setScorePlayer] = useState("");
  const [sound, setSound] = useState(() =>
    obs
      ? new URLSearchParams(location.search).has("sound")
      : localStorage.getItem("ston-sound") === "true",
  );
  useEffect(() => {
    const offset = v.serverNow - Date.now();
    const id = setInterval(() => setNow(Date.now() + offset), 100);
    return () => clearInterval(id);
  }, [v.serverNow]);
  const remaining =
    v.timer.deadline === null
      ? v.timer.remaining === null
        ? null
        : Math.ceil(v.timer.remaining / 1000)
      : Math.max(0, Math.ceil((v.timer.deadline - now) / 1000));
  useSounds(sound, v, remaining);
  const v2 = v.config.rulesVersion === 2;
  const numberedTiles = v.round === 5;
  const explanation = v.question?.explanation?.trim();
  const active = v.players.find((p) => p.id === v.activePlayerId);
  const me = v.players.find((p) => p.id === v.self.playerId);
  const isHost = v.self.role === "host" && !obs;
  const canChoose = !obs && (isHost || me?.id === v.activePlayerId);
  const revealed = ["reveal", "finished"].includes(v.phase);
  const categories = [...new Set(v.board.map((q) => q.category))];
  return (
    <div
      id="app"
      className={
        "game " +
        (obs ? "obs-game" : isHost ? "host-game" : "player-game") +
        (clean ? " clean" : "")
      }
    >
      <div id="stage">
        <PlayerColumn v={v} side="left" />
        <div id="center">
          <div id="topbar" className="game-toolbar">
            <span className="round-label rnd">
              {v.round ? String(v.round).padStart(2, "0") + " / 06" : "ЛОББИ"}
              <b>{v.config.roundNames[v.round] ?? "Перед эфиром"}</b>
            </span>
            <div className="toolbar-actions top-right">
              {!v.joinOpen && <span className="lock-ind">🔒 вход закрыт</span>}
              {!obs && (
                <button
                  className="snd-btn"
                  aria-label={sound ? "Выключить звук" : "Включить звук"}
                  onClick={() => {
                    unlockSound();
                    setSound(!sound);
                    localStorage.setItem("ston-sound", String(!sound));
                  }}
                >
                  {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
                </button>
              )}
              {isHost && (
                <>
                  <button onClick={() => setClean(!clean)}>
                    <Maximize size={17} />
                    {clean ? "Вернуть панель" : "Чистый экран"}
                  </button>
                  <button
                    aria-label="Панель ведущего"
                    aria-expanded={panel}
                    onClick={() => setPanel(!panel)}
                  >
                    <Settings2 size={19} />
                  </button>
                </>
              )}
            </div>
          </div>
          <main
            id="main"
            className="stage"
            data-phase={v.phase}
            data-round={v.round}
            data-question-id={v.question?.id}
            key={(v.round === 6 ? "final" : v.phase) + v.question?.id}
          >
            <div className="stage-meta">
              <span>
                {v.phase === "lobby"
                  ? "ПРИГЛАШАЙТЕ ИГРОКОВ"
                  : v.phase === "intro"
                    ? "НОВЫЙ РАУНД"
                    : v.phase === "finished"
                      ? "ФИНАЛЬНЫЙ РЕЗУЛЬТАТ"
                      : "ВОПРОС " + (v.completed + 1) + " / " + v.total}
              </span>
              {remaining !== null && (
                <span
                  className={
                    "timer mini-timer" + (remaining <= 5 ? " urgent" : "")
                  }
                  role="timer"
                >
                  <Timer size={20} />
                  {v.paused
                    ? "ПАУЗА"
                    : Math.floor(remaining / 60) +
                      ":" +
                      String(remaining % 60).padStart(2, "0")}
                </span>
              )}
            </div>
            {v.paused && <div className="pause-banner">Эфир на паузе</div>}
            {v.phase === "lobby" ? (
              <div className="lobby-view">
                <h1 className="lobby-title">Викторина</h1>
                <div className="theme-chips">
                  {v.config.roundOrder.map((round) => (
                    <span className="tchip" key={round}>
                      {v.config.roundNames[round]}
                    </span>
                  ))}
                </div>
                <p className="lobby-sub">
                  {v.players.length} / {v.config.maxPlayers} игроков ·{" "}
                  {isHost
                    ? v2 && v.players.length < 2
                      ? "Нужно минимум 2 игрока"
                      : "Можно начинать игру"
                    : "Ждём, пока ведущий начнёт"}
                </p>
                {isHost && v2 && (
                  <div className="lobby-package">
                    <label>
                      Пакет для партии
                      <select
                        value={v.selectedPackage?.id ?? ""}
                        onChange={(e) => {
                          void api(
                            "editor/packages/" + e.target.value + "/use",
                            {},
                          ).catch(
                            async (error) => await showMessage(String(error)),
                          );
                        }}
                      >
                        <option value="" disabled>
                          Выберите пакет
                        </option>
                        {v.packages?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {p.questionIds.length} заданий
                          </option>
                        ))}
                      </select>
                    </label>
                    <p>
                      {v.selectedPackage
                        ? v.selectedPackage.issues.length
                          ? v.selectedPackage.issues.join("; ")
                          : "Заданий в пакете: " +
                            v.selectedPackage.questionIds.length
                        : "Соберите пакет в разделе «Пакеты»"}
                    </p>
                    <p>
                      {v.finalSelection
                        ? "Панорама выбрана: " +
                          (v.finalSelection.title || v.finalSelection.place)
                        : "Перед финалом выберите панораму в разделе «Финальные панорамы»"}
                    </p>
                  </div>
                )}
                {!isHost && !obs && (
                  <button
                    className="btn primary"
                    onClick={() => act("ready", !me?.ready)}
                  >
                    {me?.ready ? "Я пока не готов" : "Готов к игре"}
                  </button>
                )}
              </div>
            ) : v.phase === "intro" ? (
              <div className="round-intro">
                <span className="giant-number">
                  {String(v.round).padStart(2, "0")}
                </span>
                <p className="eyebrow">
                  РАУНД {v.round} · {v.total}{" "}
                  {v.round === 6 ? "ЛОКАЦИЯ" : "ВОПРОСОВ"}
                </p>
                <h1 className="scene-title">{v.config.roundNames[v.round]}</h1>
                {v.total === 0 && (
                  <p className="muted">В этом раунде пока нет вопросов.</p>
                )}
                {isHost &&
                  v.round === 6 &&
                  !v.finalSelection &&
                  !v.finalRandom && (
                    <div className="notice" role="status">
                      <p>
                        Перед запуском финала выберите одну панораму вручную.
                      </p>
                      <a className="btn primary" href="/host?mode=panoramas">
                        Выбрать панораму
                      </a>
                    </div>
                  )}
                {v2 && (
                  <div className="round-scoreboard">
                    {[...v.players]
                      .sort((a, b) => b.score - a.score)
                      .map((p) => (
                        <div key={p.id}>
                          <b style={{ color: p.color }}>{p.name}</b>
                          <strong>{p.score.toLocaleString("ru")}</strong>
                        </div>
                      ))}
                  </div>
                )}
                {v.round !== 1 && (
                  <p className="muted">
                    {
                      [
                        "",
                        "",
                        "Два события. Одно раньше другого.",
                        "Две стороны. Выберите свою.",
                        "Узнайте деталь и успейте нажать первым.",
                        "Смотрите внимательно. Кадр скоро исчезнет.",
                        "Поставьте очки и найдите страну.",
                      ][v.round]
                    }
                  </p>
                )}
              </div>
            ) : v.phase === "choosing" ? (
              <>
                <p className="eyebrow">
                  {canChoose
                    ? "ВАШ ХОД"
                    : (active?.name ?? "Игрок") + " ВЫБИРАЕТ"}
                </p>
                <h1 className="scene-title">
                  {v.round <= 3 ? "Выберите категорию" : "Откройте вопрос"}
                </h1>
                {v2 || v.round === 1 ? (
                  <div
                    className={
                      "board v2-board" + (numberedTiles ? " memory-tiles" : "")
                    }
                  >
                    {v.board.map((q, index) => (
                      <button
                        className={"cell" + (q.used ? " used" : "")}
                        key={q.id}
                        disabled={!canChoose || v.paused || q.used}
                        aria-label={
                          (numberedTiles
                            ? "Плитка " + (index + 1)
                            : q.category) + (q.used ? ", использован" : "")
                        }
                        onClick={() => act("choose", q.id)}
                      >
                        {v.round === 1
                          ? (q.used ? "✓ " : "") + q.category
                          : q.used
                            ? "✓"
                            : numberedTiles
                              ? index + 1
                              : q.category}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div
                    className={
                      (v.round <= 3
                        ? "category-list board categories-board"
                        : "question-board board") +
                      (categories.length >= 7 ? " dense" : "")
                    }
                    style={
                      {
                        "--cols": v.config.boardValues.length,
                      } as React.CSSProperties
                    }
                  >
                    {categories.map((cat) => (
                      <section className="trow" key={cat}>
                        {v.round <= 3 ? (
                          <button
                            className="theme-name category-cell"
                            disabled={
                              !canChoose ||
                              v.paused ||
                              !v.board.some(
                                (q) => q.category === cat && !q.used,
                              )
                            }
                            onClick={() => act("choose", cat)}
                          >
                            <span>{cat}</span>
                            <span className="tag">
                              {
                                v.board.filter(
                                  (q) => q.category === cat && !q.used,
                                ).length
                              }{" "}
                              вопросов
                            </span>
                            <ChevronRight size={18} />
                          </button>
                        ) : (
                          <>
                            <h3 className="theme-name">{cat}</h3>
                            {v.board
                              .filter((q) => q.category === cat)
                              .sort((a, b) => a.value - b.value)
                              .map((q) => (
                                <button
                                  key={q.id}
                                  className={
                                    "cell" +
                                    (q.used
                                      ? " used"
                                      : canChoose
                                        ? " host"
                                        : "")
                                  }
                                  aria-label={
                                    cat +
                                    ", " +
                                    q.value +
                                    (q.used ? ", использован" : "")
                                  }
                                  disabled={q.used || !canChoose || v.paused}
                                  onClick={() => act("choose", q.id)}
                                >
                                  {q.used ? "" : q.value}
                                </button>
                              ))}
                          </>
                        )}
                      </section>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="qview">
                <span className="qtheme">{v.question?.category}</span>
                {!v2 && [4, 5].includes(v.round) && (
                  <span className="qprice">{v.question?.value}</span>
                )}
                <h1 className="question-title qtext">
                  {v.phase === "studying"
                    ? "Запомните кадр"
                    : v.phase === "betting"
                      ? "Сколько поставите?"
                      : v.question?.text}
                </h1>
                {v.question?.media && (
                  <Media
                    media={v.question.media}
                    state={v.video}
                    serverNow={v.serverNow}
                    receivedAt={v.clientReceivedAt}
                  />
                )}
                {v.round === 1 &&
                  (v2 ? (
                    <Comparison v={v} act={act} />
                  ) : (
                    <Numeric v={v} act={act} />
                  ))}
                {[2, 3].includes(v.round) && <Choice v={v} act={act} />}
                {[4, 5].includes(v.round) && !revealed && (
                  <p
                    className={
                      "buzz-state" + (v.phase === "buzzing" ? " open" : "")
                    }
                  >
                    {v.buzzWinner
                      ? "Отвечает: " +
                        v.players.find((p) => p.id === v.buzzWinner)?.name
                      : v.phase === "studying"
                        ? "Смотрите внимательно"
                        : v.phase === "buzzing"
                          ? "Можно отвечать"
                          : "Кнопка закрыта"}
                  </p>
                )}
                {v.round === 6 && (
                  <Final
                    key={v.finalAttemptId}
                    v={v}
                    act={act}
                    displayOnly={obs}
                  />
                )}
                {revealed && v.round !== 6 && (
                  <div className="reveal-block answer-reveal">
                    <p className="lbl">Правильный ответ</p>
                    <h2 className="answer-big">
                      {v.round === 2
                        ? v.question?.answer === "before"
                          ? "До"
                          : "После"
                        : v.round === 3
                          ? v.question?.options?.[
                              v.question.answer === "a" ? 0 : 1
                            ]
                          : String(v.question?.answer ?? "")}
                    </h2>
                    {v.question?.speaker && (
                      <p>
                        <strong>{v.question.speaker}</strong> ·{" "}
                        {v.question.work}
                        {v.question.translated
                          ? " · Перевод: " + v.question.translationNote
                          : ""}
                      </p>
                    )}
                    {explanation &&
                      explanation !==
                        "Учебный пример. Замените его своим контентом в редакторе." && (
                        <p>{explanation}</p>
                      )}
                  </div>
                )}
                {!isHost && !obs && !revealed && (
                  <p className="muted">
                    {v.phase === "studying"
                      ? "Изучите изображение. Вопрос появится после таймера."
                      : "Следите за экраном и слушайте ведущего."}
                  </p>
                )}
              </div>
            )}
            {me && v.phase !== "lobby" && !v.roster.includes(me.id) && (
              <p className="notice">Вы войдёте в игру со следующего раунда.</p>
            )}
          </main>
          <div id="hostframe">
            <div className="frame host">
              <div className="cam">камера ведущего</div>
              <div className="strip">
                <span className="nm">🎤 Ведущий</span>
              </div>
            </div>
          </div>
        </div>
        <PlayerColumn v={v} side="right" hostTools={isHost && !clean} />
      </div>
      {!obs && (
        <div id="controls">
          {isHost ? (
            <>
              {navigation}
              <div className="ctl-row">
                {[4, 5].includes(v.round) && v.phase === "judging" && (
                  <Buzzer v={v} act={act} />
                )}
                <div className="panel-controls">
                  {v.phase === "betting" && (
                    <button
                      className="primary"
                      onClick={async () => {
                        if (
                          !v2 ||
                          (await confirmAction(
                            "Завершить ставки? Отсутствующие ставки будут равны нулю.",
                          ))
                        )
                          act(
                            "beginLocation",
                            v2 ? "ЗАВЕРШИТЬ СТАВКИ" : undefined,
                          );
                      }}
                    >
                      Показать локацию
                    </button>
                  )}
                  {v.phase === "lobby" && (
                    <button
                      className="primary"
                      disabled={
                        v2 &&
                        (v.players.length < 2 ||
                          !v.selectedPackage ||
                          !!v.selectedPackage.issues.length)
                      }
                      onClick={() => act("start")}
                    >
                      Начать игру <Play size={16} />
                    </button>
                  )}
                  {v.phase === "intro" && (
                    <button
                      className="primary"
                      disabled={
                        v.round === 6 && !v.finalSelection && !v.finalRandom
                      }
                      onClick={() => act("begin")}
                    >
                      {v.total === 0
                        ? "Пропустить пустой раунд"
                        : "Начать раунд"}{" "}
                      <Play size={16} />
                    </button>
                  )}
                  {v.phase === "reveal" && (
                    <button
                      className="primary"
                      disabled={v.paused}
                      onClick={() => act("next")}
                    >
                      Следующий вопрос <ChevronRight size={17} />
                    </button>
                  )}
                  {v2 && v.phase === "loadingPanorama" && (
                    <button
                      disabled={!v.panoramaReady.host}
                      onClick={async () => {
                        if (
                          await confirmAction(
                            "Запустить таймер без неготовых участников? Они могут не успеть загрузить панораму.",
                          )
                        )
                          act("startLocation", "ПРОДОЛЖИТЬ БЕЗ НЕГОТОВЫХ");
                      }}
                    >
                      Продолжить без неготовых
                    </button>
                  )}
                  {v2 && v.phase === "point" && v.paused && (
                    <button onClick={() => act("passPoint")}>
                      Передать числовой ход
                    </button>
                  )}
                  {v2 && v.canUndoDecision && (
                    <button
                      disabled={v.paused}
                      onClick={() => act("undoDecision")}
                    >
                      Отменить судейское решение
                    </button>
                  )}
                  {[
                    "comparison",
                    "point",
                    "ranges",
                    "answering",
                    "awaitingReveal",
                    "buzzing",
                    "judging",
                    "locating",
                  ].includes(v.phase) &&
                    (v.round !== 6 || v.phase === "awaitingReveal") && (
                      <button
                        className="primary"
                        disabled={v.paused}
                        onClick={async () => {
                          if (
                            v.round === 6 ||
                            !v2 ||
                            v.phase === "point" ||
                            (await confirmAction(
                              "Завершить ожидание? Неподтверждённые ответы получат 0 очков; попытки с кнопкой сохранят начисления.",
                            ))
                          )
                            act(
                              "reveal",
                              v2 ? "ЗАВЕРШИТЬ ОЖИДАНИЕ" : undefined,
                            );
                        }}
                      >
                        {v.round === 6 ? "Показать ответы" : "Показать ответ"}
                      </button>
                    )}
                  {!["lobby", "finished"].includes(v.phase) && (
                    <button onClick={() => act(v.paused ? "resume" : "pause")}>
                      {v.paused ? <Play size={16} /> : <Pause size={16} />}{" "}
                      {v.paused ? "Продолжить" : "Пауза"}
                    </button>
                  )}
                  {!v2 && v.timer.deadline !== null && (
                    <button
                      onClick={async () => {
                        const sec = await requestValue(
                          "Новая длительность таймера, секунды",
                          "30",
                        );
                        if (sec) act("timer", Number(sec));
                      }}
                    >
                      Изменить таймер
                    </button>
                  )}
                  {v.question && !revealed && v.phase !== "betting" && (
                    <button
                      disabled={v.paused}
                      onClick={async () => {
                        if (
                          await confirmAction(
                            "Пропустить испорченный вопрос? Его начисления будут отменены.",
                          )
                        )
                          act("skip");
                      }}
                    >
                      Пропустить вопрос
                    </button>
                  )}
                  {v.round > 0 && v.phase !== "lobby" && (
                    <>
                      {v.roundIndex < v.config.roundOrder.length - 1 &&
                        v.phase !== "finished" && (
                          <button
                            onClick={async () => {
                              if (
                                await confirmAction(
                                  "Перейти к следующему раунду? Оставшиеся вопросы будут пропущены. Очки закрытых вопросов сохранятся; начисления текущего незакрытого вопроса отменятся.",
                                )
                              )
                                act("nextRound", "СЛЕДУЮЩИЙ РАУНД");
                            }}
                          >
                            Следующий раунд <ChevronRight size={17} />
                          </button>
                        )}
                      <button
                        onClick={async () => {
                          if (
                            await confirmAction(
                              "Начать текущий раунд заново? Его ответы и игровые начисления будут отменены. Очки предыдущих раундов и ручные поправки сохранятся.",
                            )
                          )
                            act("restartRound", "НАЧАТЬ РАУНД ЗАНОВО");
                        }}
                      >
                        Начать раунд заново
                      </button>
                      <button
                        onClick={async () => {
                          if (
                            await confirmAction(
                              "Начать игру заново тем же составом? Все очки, ответы и ставки обнулятся. Игроки, их порядок, пакет вопросов и выбранная панорама сохранятся. Игра начнётся с первого раунда.",
                            )
                          )
                            act("restartGame", "НАЧАТЬ ИГРУ ЗАНОВО");
                        }}
                      >
                        Начать игру заново тем же составом
                      </button>
                    </>
                  )}
                </div>

                <button
                  className="btn"
                  onClick={() => act("joinOpen", !v.joinOpen)}
                >
                  {v.joinOpen ? "Закрыть вход" : "Открыть вход новым игрокам"}
                </button>
                <a
                  className="btn ghost"
                  href="/editor"
                  target="_blank"
                  rel="noreferrer"
                >
                  ✏️ Редактор
                </a>
              </div>
            </>
          ) : [4, 5].includes(v.round) &&
            !["intro", "choosing", "reveal"].includes(v.phase) ? (
            <Buzzer v={v} act={act} />
          ) : (
            <p className="player-hint">
              {me?.name} · {me?.score.toLocaleString("ru")} очков
              {v.phase === "choosing" && !canChoose
                ? " · Сейчас выбирает " + active?.name
                : ""}
            </p>
          )}
        </div>
      )}
      {isHost && panel && !clean && (
        <aside className="host-panel" aria-label="Настройки партии">
          <button className="btn drawer-close" onClick={() => setPanel(false)}>
            Закрыть панель ×
          </button>
          <p className="eyebrow">ПУЛЬТ ВЕДУЩЕГО</p>
          {v.judgingGuide && (
            <div className="answer-panel drawer-answer">
              <div className="ap-title">ОТВЕТ — для ведущего</div>
              <div className="ap-text">{v.judgingGuide.answer}</div>
              <small>{v.judgingGuide.alternatives.join(" / ")}</small>
            </div>
          )}
          <section className="panel-section final-selection">
            <h3>Панорама финала</h3>
            {v.finalSelection ? (
              <>
                {v.finalSelection.panoramaFileId && (
                  <img
                    src={"/media/" + v.finalSelection.panoramaFileId}
                    alt="Выбранная панорама финала"
                  />
                )}
                <strong>
                  {v.finalSelection.title || v.finalSelection.place}
                </strong>
              </>
            ) : (
              <p className="muted">
                {v.finalRandom ? "Случайный выбор включён" : "Ещё не выбрана"}
              </p>
            )}
            <a
              className="text-link"
              href="/host?mode=panoramas"
              target="_blank"
              rel="noreferrer"
            >
              {v.finalSelection ? "Изменить выбор" : "Открыть библиотеку"} ↗
            </a>
            {v.finalAttemptId && (
              <button
                className="danger"
                onClick={async () => {
                  if (
                    await confirmAction(
                      "Отменить финал и выбрать другую панораму? Ставки и ответы сбросятся. Начисления этой попытки отменятся; очки раундов и ручные поправки сохранятся.",
                    )
                  )
                    act("cancelFinal", "ОТМЕНИТЬ ФИНАЛ");
                }}
              >
                Отменить финал и выбрать другую панораму
              </button>
            )}
          </section>
          {v.question?.media &&
            v.question.media.kind !== "image" &&
            !revealed && (
              <div className="panel-section">
                <h3>Видеофрагмент</h3>
                {[
                  ["play", "Запустить"],
                  ["pause", "Пауза"],
                  ["restart", "Сначала"],
                  ["stop", "К ответам"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    disabled={v.paused}
                    onClick={() => act("video", value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          <div className="panel-section">
            <h3>
              Игроки{" "}
              <small>
                {v.players.length} / {v.config.maxPlayers}
              </small>
            </h3>
            {v.players.map((p) => (
              <div className="panel-player" key={p.id}>
                <span className={"presence " + (p.connected ? "online" : "")} />
                <strong style={{ color: p.color }}>{p.name}</strong>
                <span>{p.score}</span>
                {v.phase === "lobby" && (
                  <button
                    aria-label={"Удалить " + p.name}
                    onClick={() => act("remove", p.id)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              className="subtle"
              onClick={() => act("joinOpen", !v.joinOpen)}
            >
              {v.joinOpen ? "Закрыть вход" : "Открыть вход новым игрокам"}
            </button>
            {["intro", "choosing"].includes(v.phase) && (
              <label>
                Сейчас выбирает
                <select
                  value={v.activePlayerId ?? ""}
                  onChange={(e) => act("active", e.target.value)}
                >
                  {v.order.map((id) => (
                    <option key={id} value={id}>
                      {v.players.find((p) => p.id === id)?.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {["lobby", "intro"].includes(v.phase) && (
              <div className="order-list">
                <p className="muted">Очередь выбора</p>
                {(v.order.length ? v.order : v.players.map((p) => p.id)).map(
                  (id, i, a) => (
                    <div key={id}>
                      <span>
                        {i + 1}. {v.players.find((p) => p.id === id)?.name}
                      </span>
                      <button
                        disabled={i === 0}
                        aria-label="Выше"
                        onClick={() => {
                          const next = [...a];
                          [next[i - 1], next[i]] = [next[i], next[i - 1]];
                          act("order", next);
                        }}
                      >
                        ↑
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
          <details className="panel-section">
            <summary>Корректировка очков</summary>
            <label>
              Игрок
              <select
                value={scorePlayer}
                onChange={(e) => setScorePlayer(e.target.value)}
              >
                <option value="">Выберите игрока</option>
                {v.players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Изменение очков
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </label>
            <label>
              Причина
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={3}
              />
            </label>
            <button
              disabled={!scorePlayer || reason.trim().length < 3}
              onClick={() => {
                act("score", { playerId: scorePlayer, amount, reason });
                setReason("");
              }}
            >
              Применить
            </button>
          </details>
          <details className="panel-section">
            <summary>Порядок нажатий</summary>
            {v.buzzes.map((b) => (
              <p key={b.sequence}>
                {b.sequence}. {v.players.find((p) => p.id === b.playerId)?.name}{" "}
                · {new Date(b.at).toLocaleTimeString("ru")}:
                {String(b.at % 1000).padStart(3, "0")} {b.accepted ? "✓" : ""}
              </p>
            ))}
          </details>
          <details className="panel-section">
            <summary>Журнал эфира</summary>
            <div className="event-list">
              {v.events.map((e) => (
                <p key={e.id}>
                  <time>{new Date(e.at).toLocaleTimeString("ru")}</time>{" "}
                  {e.message}
                </p>
              ))}
            </div>
          </details>
          <button
            className="danger"
            onClick={async () => {
              if (
                (await requestValue(
                  "Полный сброс удалит очки и ход партии. Введите СБРОС",
                  "",
                  { title: "Сброс партии", requiredValue: "СБРОС" },
                )) === "СБРОС"
              )
                act("reset", "СБРОС");
            }}
          >
            Сбросить партию
          </button>
        </aside>
      )}
    </div>
  );
}
function PlayerColumn({
  v,
  side,
  hostTools = false,
}: {
  v: GameView;
  side: "left" | "right";
  hostTools?: boolean;
}) {
  const revealed = ["reveal", "finished"].includes(v.phase);
  return (
    <div
      className="player-col"
      id={side === "left" ? "left-col" : "right-col"}
      aria-label={side === "left" ? "Игроки слева" : "Игроки справа"}
    >
      {Array.from({ length: v.config.maxPlayers }, (_, index) => index)
        .filter((index) => index % 2 === (side === "left" ? 0 : 1))
        .map((index) => {
          const p = v.players[index];
          if (!p)
            return (
              <div key={index} className="frame empty">
                <div className="cam">камера</div>
                <div className="strip">
                  <span className="nm">Игрок {index + 1}</span>
                  <span className="sc">—</span>
                </div>
              </div>
            );
          const status = !p.connected
            ? "Нет связи"
            : v.phase === "lobby"
              ? p.ready
                ? "✓ Готов"
                : "Не готов"
              : v.phase === "finished"
                ? v.finalCorrect?.[p.id]
                  ? "Верно"
                  : "Неверно"
                : v.blocked.includes(p.id)
                  ? "Неверный ответ"
                  : v.buzzWinner === p.id
                    ? "Отвечает"
                    : v.phase === "betting"
                      ? p.betDone
                        ? "Ставка сделана"
                        : "Делает ставку"
                      : v.phase === "locating" ||
                          (v.round === 6 && v.phase === "awaitingReveal")
                        ? p.countryDone
                          ? "Ответил"
                          : "Выбирает страну"
                        : p.answered
                          ? "Ответил"
                          : p.id === v.activePlayerId
                            ? "Выбирает"
                            : "В игре";
          return (
            <div
              key={p.id}
              data-player-id={p.id}
              className={
                "frame" +
                (p.id === v.self.playerId ? " me" : "") +
                (p.id === v.activePlayerId && v.phase !== "finished"
                  ? " active"
                  : "") +
                (p.id === v.buzzWinner ? " buzzed" : "") +
                (v.blocked.includes(p.id) ? " wrong" : "")
              }
              style={{ "--player": p.color } as React.CSSProperties}
            >
              <div className="badges">
                <span className="badge">{status}</span>
              </div>
              <span
                className={"dot" + (p.connected ? " on" : "")}
                title={p.connected ? "На связи" : "Нет связи"}
              />
              <div className="cam">камера</div>
              <div className="strip">
                <strong className="nm" style={{ color: p.color }}>
                  {p.name}
                </strong>
                <span className="sc">
                  {p.score.toLocaleString("ru")}
                  {revealed && !!v.deltas[p.id] && (
                    <small
                      className={
                        v.deltas[p.id] > 0 ? "delta-positive" : "delta-negative"
                      }
                    >
                      {v.deltas[p.id] > 0 ? "+" : ""}
                      {v.deltas[p.id]}
                    </small>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      {hostTools && (
        <>
          <div className="answer-panel">
            <div className="ap-title">ОТВЕТ — для ведущего</div>
            {v.judgingGuide ? (
              <>
                <div className="ap-text">{v.judgingGuide.answer}</div>
                <small>{v.judgingGuide.alternatives.join(" / ")}</small>
              </>
            ) : (
              <div className="ap-empty">
                {revealed
                  ? String(v.question?.answer ?? "—")
                  : "Откроется при судействе"}
              </div>
            )}
          </div>
          <div className="log-panel">
            <div className="ap-title">Журнал игры</div>
            <div className="log-list">
              {v.events.slice(0, 12).map((e) => (
                <div className="log-row" key={e.id}>
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
