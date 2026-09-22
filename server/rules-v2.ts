import { randomUUID } from "node:crypto";
import { z } from "zod";
import { FINAL_ANSWER_SECONDS } from "../shared/config.js";
import { finishCountrySelection } from "./final.js";
import type { Command, GameState, Identity } from "../shared/types.js";
import { locationSchema, type Question } from "../shared/content.js";
import { comparisonResult } from "../shared/comparison.js";
import { packageIssues } from "../shared/packages.js";
import {
  activeId,
  addPoints,
  arm,
  clearQuestion,
  requireRule,
  canAnswerDuringPause,
  reveal,
  shuffled,
  stopTimer,
  captureRoundStart,
} from "./game.js";
import { validCountryPoint, validPanoramaPoint } from "./geography.js";
import { questionMediaIds } from "./packages.js";

export function snapshotQuestions(s: GameState): Question[] {
  return s.packageSnapshot?.questions ?? [];
}
function registerTokens(s: GameState, q: Question) {
  s.publicIds[q.id] ??= randomUUID();
  for (const id of questionMediaIds(q)) s.mediaTokens[id] ??= randomUUID();
}
export function prepareRoundV2(s: GameState) {
  const nextPlayer = activeId(s);
  s.round = s.roundIndex + 1;
  s.phase = "intro";
  s.completed = 0;
  clearQuestion(s);
  s.lastDecision = null;
  s.roster = s.players.map((p) => p.id);
  s.order = [
    ...s.order.filter((id) => s.roster.includes(id)),
    ...s.roster.filter((id) => !s.order.includes(id)),
  ];
  if (nextPlayer && s.order.includes(nextPlayer))
    s.turn +=
      (s.order.indexOf(nextPlayer) -
        (s.turn % s.order.length) +
        s.order.length) %
      s.order.length;
  s.boardIds = snapshotQuestions(s)
    .filter((q) => q.round === s.round)
    .map((q) => q.id);
  s.total = s.round === 6 ? 1 : s.boardIds.length;
  captureRoundStart(s);
}
export function beginV2(s: GameState, q: Question, now: number) {
  clearQuestion(s);
  registerTokens(s, q);
  s.question = structuredClone(q);
  s.questionPublicId = s.publicIds[q.id];
  s.lastDecision = null;
  s.decisionToken = null;
  s.scoreBefore = Object.fromEntries(s.players.map((p) => [p.id, p.score]));
  s.video = {
    status: q.media?.autoplay ? "playing" : "paused",
    offset: q.media?.start ?? 0,
    changedAt: now,
  };
  if (q.round === 1) {
    const active = activeId(s);
    s.phase = active ? "point" : "awaitingReveal";
    if (active)
      s.answers[active] = {
        value: Math.round((q.min + q.max) / 2),
        locked: false,
      };
  } else if (q.round === 2 || q.round === 3) s.phase = "answering";
  else if (q.round === 4) s.phase = "buzzing";
  else if (q.round === 5) {
    s.phase = "studying";
    arm(s, 30, now);
  } else {
    s.finalAttemptId = randomUUID();
    s.questionPublicId = s.finalAttemptId;
    s.phase = "betting";
    s.bets = {};
    s.countries = {};
    s.panoramaReady = {};
    s.panoramaErrors = {};
    s.panoramaExcluded = [];
  }
}
export function scoreV2(s: GameState) {
  const q = s.question;
  if (!q) return;
  if (q.round === 1) {
    const active = activeId(s)!;
    const guess = s.answers[active];
    if (!guess?.locked || guess.value === undefined) return;
    const result = comparisonResult(q, guess.value, s.config);
    if (result.correct) addPoints(s, active, s.config.comparison.points);
    for (const id of s.roster)
      if (
        id !== active &&
        s.answers[id]?.locked &&
        s.answers[id].choice === result.choice
      )
        addPoints(s, id, s.config.comparison.points);
  } else if (q.round === 2 || q.round === 3) {
    for (const id of s.roster)
      if (s.answers[id]?.locked && s.answers[id].choice === q.answer)
        addPoints(
          s,
          id,
          q.round === 2
            ? s.config.choicePoints.beforeAfter
            : s.config.choicePoints.twoWorlds,
        );
  } else if (q.round === 6) {
    for (const id of s.roster) {
      const choice = s.countries[id] ?? { code: null, locked: false };
      s.countries[id] = { ...choice, locked: true };
      addPoints(
        s,
        id,
        choice.code === q.answer ? (s.bets[id] ?? 0) : -(s.bets[id] ?? 0),
      );
    }
  }
}
function loadPanorama(s: GameState) {
  s.phase = "loadingPanorama";
  s.panoramaReady = {};
  s.panoramaErrors = {};
  s.panoramaExcluded = [];
  stopTimer(s);
}
function maybeStartPanorama(s: GameState, now: number): boolean {
  if (
    s.phase !== "loadingPanorama" ||
    !s.panoramaReady.host ||
    !s.roster.every(
      (id) => s.panoramaReady[id] || s.panoramaExcluded.includes(id),
    )
  )
    return false;
  const remaining = s.timer.remaining ?? FINAL_ANSWER_SECONDS * 1000;
  s.phase = "locating";
  s.timer = s.paused
    ? { deadline: null, remaining }
    : { deadline: now + remaining, remaining: null };
  return true;
}
export function expireV2(s: GameState, now: number): boolean {
  if (maybeStartPanorama(s, now)) return true;
  if (s.paused || s.timer.deadline === null || now < s.timer.deadline)
    return false;
  if (s.phase === "studying") {
    s.phase = "buzzing";
    s.video.status = "stopped";
    stopTimer(s);
    return true;
  }
  if (s.phase === "locating") {
    finishCountrySelection(s);
    return true;
  }
  return false;
}
const common = new Set([
  "ready",
  "joinOpen",
  "pause",
  "resume",
  "score",
  "remove",
  "order",
  "video",
]);
export function commandV2(
  s: GameState,
  who: Identity,
  c: Command,
  bank: Question[],
  now: number,
  receivedAt: number,
): string | null {
  if (common.has(c.type)) {
    if (c.type === "video" && [4, 5].includes(s.round))
      throw Error("В этих раундах используются изображения");
    return null;
  }
  const host = who.role === "host";
  const id = who.playerId;
  if (!host)
    requireRule(
      id && s.roster.includes(id),
      "Вы вступите в игру со следующего раунда",
    );
  if (c.type === "selectFinal") {
    requireRule(
      host && !s.finalAttemptId && s.phase !== "finished",
      "Финал уже начался. Сначала отмените финал и выберите другую панораму",
    );
    const selected = bank.find(
      (q) => q.id === c.value && q.round === 6 && q.active,
    );
    requireRule(
      selected?.round === 6 &&
        selected.location &&
        validPanoramaPoint(selected.answer, selected.location),
      "Укажите правильную страну и согласованные координаты съёмки",
    );
    s.finalSelection = structuredClone(selected);
    s.finalRandom = false;
    return "Ведущий вручную выбрал панораму финала";
  }
  const q = s.question;
  if (["panoramaReady", "panoramaError", "panoramaLoading"].includes(c.type)) {
    requireRule(
      q?.round === 6 && ["loadingPanorama", "locating"].includes(s.phase),
      "Загрузка панорамы сейчас не ожидается",
    );
    const key = host ? "host" : id!;
    if (c.type !== "panoramaReady") {
      if (c.type === "panoramaError")
        s.panoramaErrors[key] = z.string().max(300).parse(c.value);
      else delete s.panoramaErrors[key];
      s.panoramaReady[key] = false;
      if (s.phase === "locating" && !s.panoramaExcluded.includes(key)) {
        s.timer.remaining =
          s.timer.deadline === null
            ? s.timer.remaining
            : Math.max(0, s.timer.deadline - now);
        s.timer.deadline = null;
        s.phase = "loadingPanorama";
      }
      return c.type === "panoramaError"
        ? "Ошибка загрузки панорамы; ведущий видит статус"
        : "Панорама загружается; отсчёт ожидает готовности";
    }
    s.panoramaReady[key] = true;
    delete s.panoramaErrors[key];
    maybeStartPanorama(s, now);
    return "Панорама готова к показу";
  }
  if (c.type === "passPoint") {
    requireRule(
      host && q?.round === 1 && s.phase === "point",
      "Передать ход можно до подтверждения числа",
    );
    s.turn++;
    s.answers = {};
    s.paused = false;
    s.answers[activeId(s)!] = {
      value: Math.round((q.min + q.max) / 2),
      locked: false,
    };
    return "Числовой ход передан следующему участнику";
  }
  requireRule(!s.paused || canAnswerDuringPause(s, who, c), "Игра на паузе");
  if (c.type === "start") {
    requireRule(
      host && s.phase === "lobby",
      "Игра уже началась или нет прав ведущего",
    );
    requireRule(
      s.players.length <= s.config.maxPlayers,
      "Превышено максимальное количество игроков",
    );
    requireRule(
      s.packageSnapshot,
      "Сначала выберите и проверьте игровой пакет",
    );
    requireRule(
      !packageIssues(s.packageSnapshot).length,
      packageIssues(s.packageSnapshot).join("; "),
    );
    s.players.forEach((p) => {
      p.score = 0;
    });
    if (s.order.length !== s.players.length)
      s.order = shuffled(s.players.map((p) => p.id));
    s.turn = 0;
    s.roundIndex = 0;
    s.used = [];
    s.joinOpen = false;
    for (const q of snapshotQuestions(s)) registerTokens(s, q);
    prepareRoundV2(s);
    return "Начата партия по новым правилам";
  }
  if (c.type === "randomFinal")
    throw Error("Новые правила требуют ручного выбора панорамы");
  if (c.type === "begin") {
    requireRule(
      host && s.phase === "intro",
      "Сначала перейдите к новому раунду",
    );
    if (s.round === 6) {
      const final = s.finalSelection;
      requireRule(
        final && s.packageSnapshot,
        "Перед финалом выберите панораму вручную в разделе «Финальные панорамы»",
      );
      s.packageSnapshot.questions = [
        ...s.packageSnapshot.questions.filter((q) => q.round !== 6),
        structuredClone(final),
      ];
      s.boardIds = [final.id];
      if (s.roundCheckpoint) s.roundCheckpoint.boardIds = [final.id];
      beginV2(s, final, now);
    } else if (s.total === 0) {
      s.roundIndex++;
      prepareRoundV2(s);
      return "Пустой раунд пропущен ведущим";
    } else s.phase = "choosing";
    return "Раунд " + s.round + " начат";
  }
  if (c.type === "choose") {
    requireRule(
      s.phase === "choosing" && (host || id === activeId(s)),
      "Сейчас выбирает другой игрок",
    );
    const chosen = snapshotQuestions(s).find(
      (q) =>
        q.round === s.round &&
        s.boardIds.includes(q.id) &&
        !s.used.includes(q.id) &&
        (s.publicIds[q.id] === c.value || (host && q.id === c.value)),
    );
    requireRule(chosen, "Вопрос недоступен в снимке пакета");
    beginV2(s, chosen, now);
    return "Выбрано задание " + (s.completed + 1) + " раунда " + s.round;
  }
  if (["pointPreview", "point"].includes(c.type)) {
    requireRule(
      !host && id === activeId(s) && q?.round === 1 && s.phase === "point",
      "Число выставляет активный игрок",
    );
    requireRule(!s.answers[id!]?.locked, "Число уже подтверждено");
    const value = z.number().int().min(q.min).max(q.max).parse(c.value);
    s.answers[id!] = { value, locked: c.type === "point" };
    if (c.type === "point") s.phase = "comparison";
    return c.type === "point"
      ? "Число подтверждено; открыто тайное голосование"
      : "Активный игрок изменил число";
  }
  if (
    ["comparePreview", "compare", "answerPreview", "answer"].includes(c.type)
  ) {
    requireRule(!host && id && q, "Ответ доступен участникам");
    requireRule(!s.answers[id]?.locked, "Ответ уже подтверждён");
    const comparison = c.type.startsWith("compare");
    requireRule(
      comparison
        ? q.round === 1 && s.phase === "comparison" && id !== activeId(s)
        : [2, 3].includes(q.round) && s.phase === "answering",
      "Сейчас другой способ ответа",
    );
    const choice = (
      comparison
        ? z.enum(["higher", "lower", "equal"])
        : q.round === 2
          ? z.enum(["before", "after"])
          : z.enum(["a", "b"])
    ).parse(c.value);
    const locked = !c.type.endsWith("Preview");
    s.answers[id] = { choice, locked };
    if (s.roster.every((id) => s.answers[id]?.locked)) reveal(s);
    return locked
      ? "Игрок подтвердил тайный ответ"
      : "Игрок изменил предварительный выбор";
  }
  if (c.type === "buzz") {
    requireRule(
      !host &&
        id &&
        q &&
        [4, 5].includes(q.round) &&
        ["buzzing", "judging"].includes(s.phase) &&
        !s.blocked.includes(id),
      "Кнопка сейчас заблокирована",
    );
    const last = [...s.buzzes].reverse().find((b) => b.accepted);
    requireRule(
      s.phase === "buzzing" ||
        !last ||
        !s.buzzes.some((b) => b.playerId === id && b.sequence >= last.sequence),
      "Нажатие уже зарегистрировано",
    );
    const accepted = s.phase === "buzzing";
    s.buzzes.push({
      playerId: id,
      at: receivedAt,
      sequence: s.buzzes.length + 1,
      accepted,
    });
    if (accepted) {
      s.buzzWinner = id;
      s.phase = "judging";
      s.decisionToken = randomUUID();
    }
    return accepted
      ? "Первое допустимое нажатие: " + s.players.find((p) => p.id === id)?.name
      : "Нажатие зарегистрировано после первого";
  }
  if (c.type === "judge") {
    requireRule(
      host &&
        s.phase === "judging" &&
        s.buzzWinner &&
        q &&
        [4, 5].includes(q.round),
      "Сейчас нет отвечающего игрока",
    );
    const correct = z.boolean().parse(c.value);
    const points = s.config.buzzerPoints;
    const delta =
      q.round === 4
        ? correct
          ? points.fragmentCorrect
          : -points.fragmentWrong
        : correct
          ? points.memoryCorrect
          : -points.memoryWrong;
    s.lastDecision = {
      questionId: q.id,
      playerId: s.buzzWinner,
      delta,
      blocked: [...s.blocked],
      used: [...s.used],
      token: s.decisionToken!,
      buzzes: structuredClone(s.buzzes),
    };
    addPoints(s, s.buzzWinner, delta);
    s.answers[s.buzzWinner] = {
      choice: correct ? "correct" : "wrong",
      locked: true,
    };
    if (correct) reveal(s);
    else {
      s.blocked.push(s.buzzWinner);
      s.buzzWinner = null;
      if (s.roster.every((id) => s.blocked.includes(id))) reveal(s);
      else s.phase = "buzzing";
    }
    return correct
      ? "Устный ответ верный: +" + delta
      : "Устный ответ неверный: " + delta;
  }
  if (c.type === "undoDecision") {
    const d = s.lastDecision;
    requireRule(
      host &&
        d &&
        q?.id === d.questionId &&
        ["judging", "buzzing", "reveal"].includes(s.phase),
      "Нет решения для отмены",
    );
    addPoints(s, d.playerId, -d.delta);
    delete s.answers[d.playerId];
    s.blocked = [...d.blocked];
    s.used = [...d.used];
    s.buzzWinner = d.playerId;
    s.buzzes = structuredClone(d.buzzes);
    s.phase = "judging";
    s.decisionToken = randomUUID();
    s.lastDecision = null;
    return "Последнее судейское решение отменено; ручные поправки счёта сохранены";
  }
  if (c.type === "bet") {
    requireRule(
      !host &&
        id &&
        q?.round === 6 &&
        s.phase === "betting" &&
        s.bets[id] === undefined,
      "Ставки уже закрыты или ставка подтверждена",
    );
    const score = s.players.find((p) => p.id === id)!.score;
    s.bets[id] = z
      .number()
      .int()
      .min(0)
      .max(Math.floor(Math.max(0, score) * s.config.final.betLimit))
      .parse(c.value);
    if (s.roster.every((id) => s.bets[id] !== undefined)) loadPanorama(s);
    return "Тайная ставка подтверждена";
  }
  if (c.type === "beginLocation") {
    requireRule(host && s.phase === "betting", "Этап ставок уже завершён");
    requireRule(
      c.value === "ЗАВЕРШИТЬ СТАВКИ",
      "Подтвердите: отсутствующие ставки будут равны нулю",
    );
    for (const id of s.roster) s.bets[id] ??= 0;
    loadPanorama(s);
    return "Ставки завершены ведущим; отсутствующие ставки равны нулю";
  }
  if (c.type === "startLocation") {
    requireRule(
      host && s.phase === "loadingPanorama" && s.panoramaReady.host,
      "Дождитесь загрузки панорамы у ведущего",
    );
    requireRule(
      c.value === "ПРОДОЛЖИТЬ БЕЗ НЕГОТОВЫХ",
      "Подтвердите продолжение без неготовых участников",
    );
    s.panoramaExcluded = s.roster.filter((id) => !s.panoramaReady[id]);
    maybeStartPanorama(s, now);
    return "Ведущий запустил финал без ожидания неготовых участников";
  }
  if (c.type === "country" || c.type === "confirmCountry") {
    requireRule(
      !host &&
        id &&
        q?.round === 6 &&
        s.phase === "locating" &&
        !s.countries[id]?.locked,
      "Выбор страны закрыт",
    );
    if (c.type === "country") {
      const value = z
        .object({ code: z.string(), point: locationSchema })
        .parse(c.value);
      requireRule(
        validCountryPoint(value.code, value.point),
        "Нажмите внутри территории выбранной страны; океан не является ответом",
      );
      s.countries[id] = { ...value, locked: false };
      return "Игрок изменил страну и личный пин";
    }
    requireRule(s.countries[id]?.code, "Сначала выберите страну");
    s.countries[id].locked = true;
    if (s.roster.every((id) => s.countries[id]?.locked))
      finishCountrySelection(s);
    return "Страна подтверждена";
  }
  if (c.type === "next") {
    requireRule(host && s.phase === "reveal", "Сначала раскройте ответ");
    s.completed++;
    s.turn++;
    s.lastDecision = null;
    if (s.completed >= s.total) {
      s.roundIndex++;
      prepareRoundV2(s);
    } else {
      clearQuestion(s);
      s.phase = "choosing";
    }
    return "Ведущий перешёл к следующему заданию";
  }
  if (c.type === "reveal" || c.type === "endWaiting") {
    requireRule(host && q, "Нет текущего вопроса");
    if (q.round === 6) {
      requireRule(
        c.type === "reveal" && s.phase === "awaitingReveal",
        "Дождитесь ответов игроков или окончания времени",
      );
      reveal(s);
      return "Ведущий раскрыл финальные ответы и итоги";
    }
    if (s.phase === "point") {
      s.paused = true;
      return "Число ещё не подтверждено. Вопрос приостановлен; передайте ход следующему игроку";
    }
    requireRule(
      [
        "comparison",
        "answering",
        "buzzing",
        "judging",
        "awaitingReveal",
      ].includes(s.phase),
      "Раскрытие сейчас недоступно",
    );
    requireRule(
      c.value === "ЗАВЕРШИТЬ ОЖИДАНИЕ",
      "Подтвердите: отсутствующие ответы получат ноль",
    );
    reveal(s);
    return "Ведущий завершил ожидание и раскрыл ответ";
  }
  if (c.type === "active") {
    requireRule(
      host && ["intro", "choosing"].includes(s.phase),
      "Сменить выбирающего можно перед вопросом",
    );
    const index = s.order.indexOf(String(c.value));
    requireRule(index >= 0, "Игрок вне очереди");
    s.turn = index;
    return "Ведущий назначил активного игрока";
  }
  if (c.type === "skip") s.lastDecision = null;
  // Existing explicit reset/skip/final-cancellation and host utilities remain shared.
  if (["skip", "cancelFinal"].includes(c.type)) return null;
  throw Error("Действие недоступно по новым правилам");
}
