import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  configSchema,
  defaultConfig,
  PLAYER_COLORS,
  FINAL_ANSWER_SECONDS,
} from "../shared/config.js";
import type { Config } from "../shared/config.js";
import type { GameState, Identity, Command } from "../shared/types.js";
import type { Question } from "../shared/content.js";
import { validateBank } from "./content.js";
import { roundCommand, scoreQuestion } from "./rounds.js";
import { finishCountrySelection } from "./final.js";
import { beginV2, commandV2, expireV2, prepareRoundV2 } from "./rules-v2.js";
import { previousRoundCheckpoint } from "./round-checkpoints.js";
export function requireRule(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
export function canAnswerDuringPause(s: GameState, who: Identity, c: Command) {
  return (
    s.round === 6 &&
    who.role === "player" &&
    ["bet", "country", "confirmCountry"].includes(c.type)
  );
}
export function initialState(
  config: Config = structuredClone(defaultConfig),
): GameState {
  return {
    roundEpoch: null,
    roundCheckpoint: null,
    roundCheckpoints: {},
    selectedPackageId: null,
    packageSnapshot: null,
    publicIds: {},
    mediaTokens: {},
    questionPublicId: null,
    panoramaReady: {},
    panoramaErrors: {},
    panoramaExcluded: [],
    decisionToken: null,
    lastDecision: null,
    acceptedCommands: {},
    revision: 0,
    finalSelection: null,
    finalRandom: false,
    finalAttemptId: null,
    phase: "lobby",
    players: [],
    joinOpen: true,
    round: 0,
    roundIndex: 0,
    order: [],
    roster: [],
    turn: 0,
    completed: 0,
    total: 0,
    used: [],
    question: null,
    answers: {},
    bets: {},
    countries: {},
    buzzes: [],
    blocked: [],
    buzzWinner: null,
    timer: { deadline: null, remaining: null },
    paused: false,
    video: { status: "stopped", offset: 0, changedAt: 0 },
    deltas: {},
    scoreBefore: {},
    config: configSchema.parse(config),
    boardIds: [],
  };
}
export function normalizeName(name: string) {
  return name.normalize("NFKC").trim().toLocaleLowerCase("ru-RU");
}
function availableName(s: GameState, name: unknown, exceptId?: string) {
  requireRule(typeof name === "string", "Введите имя");
  const clean = name.normalize("NFKC").trim();
  requireRule(
    clean.length >= 1 && clean.length <= 30 && !/[\p{Cc}\p{Cf}]/u.test(clean),
    "Имя должно содержать от 1 до 30 видимых символов",
  );
  requireRule(
    !s.players.some(
      (p) =>
        p.id !== exceptId && normalizeName(p.name) === normalizeName(clean),
    ),
    "Это имя уже занято",
  );
  return clean;
}
export function joinPlayer(s: GameState, name: string) {
  requireRule(s.joinOpen, "Вход новых игроков закрыт");
  requireRule(
    s.players.length < s.config.maxPlayers,
    "В комнате уже шесть игроков",
  );
  const clean = availableName(s, name);
  const player = {
    id: randomUUID(),
    name: clean,
    color: PLAYER_COLORS.find((c) => !s.players.some((p) => p.color === c))!,
    score: 0,
    ready: false,
  };
  s.players.push(player);
  return player;
}
export function shuffled<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}
export function arm(s: GameState, seconds: number, now: number) {
  s.timer = s.paused
    ? { deadline: null, remaining: seconds * 1000 }
    : { deadline: now + seconds * 1000, remaining: null };
}
export function stopTimer(s: GameState) {
  s.timer = { deadline: null, remaining: null };
}
export function questionToken(s: GameState) {
  if (s.config.rulesVersion === 2)
    return s.question ? (s.questionPublicId ?? undefined) : undefined;
  return s.question?.round === 6
    ? (s.finalAttemptId ?? s.question.id)
    : s.question?.id;
}
export function activeId(s: GameState) {
  return s.order.length ? s.order[s.turn % s.order.length] : null;
}
export function addPoints(s: GameState, id: string, amount: number) {
  const p = s.players.find((p) => p.id === id);
  if (p) {
    p.score += amount;
    s.deltas[id] = (s.deltas[id] ?? 0) + amount;
    if (s.roundCheckpoint)
      s.roundCheckpoint.awards[id] =
        (s.roundCheckpoint.awards[id] ?? 0) + amount;
  }
}
export function clearQuestion(s: GameState) {
  s.question = null;
  s.answers = {};
  s.buzzes = [];
  s.blocked = [];
  s.buzzWinner = null;
  s.deltas = {};
  s.video = { status: "stopped", offset: 0, changedAt: 0 };
  stopTimer(s);
}
export function captureRoundStart(s: GameState) {
  if (s.roundCheckpoint && s.roundCheckpoint.round !== s.round)
    s.roundCheckpoints[s.roundCheckpoint.round] = structuredClone(
      s.roundCheckpoint,
    );
  s.roundCheckpoint = {
    round: s.round,
    used: [...s.used],
    boardIds: [...s.boardIds],
    order: [...s.order],
    roster: [...s.roster],
    turn: s.turn,
    awards: {},
  };
}
// Legacy games use the live bank; newer games retain their package snapshot.
export function syncLegacyRoundBank(s: GameState, bank: Question[]) {
  if (s.config.rulesVersion !== 1 || s.round < 1 || s.round === 6) return;
  const rows = bank.filter((q) => q.active && q.round === s.round);
  s.boardIds = rows.map((q) => q.id);
  s.total =
    s.completed +
    (s.question ? 1 : 0) +
    rows.filter((q) => !s.used.includes(q.id) && q.id !== s.question?.id)
      .length;
}
function prepareRound(s: GameState, bank: Question[]) {
  s.round = s.config.roundOrder[s.roundIndex];
  s.phase = "intro";
  s.completed = 0;
  s.turn = 0;
  clearQuestion(s);
  s.roster = s.players.map((p) => p.id);
  s.order = [
    ...s.order.filter((id) => s.roster.includes(id)),
    ...s.roster.filter((id) => !s.order.includes(id)),
  ];
  s.total = 1;
  s.boardIds = [];
  syncLegacyRoundBank(s, bank);
  captureRoundStart(s);
}
export function beginQuestion(s: GameState, q: Question, now: number) {
  if (s.config.rulesVersion === 2) return beginV2(s, q, now);
  s.question = structuredClone(q);
  s.answers = {};
  s.buzzes = [];
  s.blocked = [];
  s.buzzWinner = null;
  s.deltas = {};
  s.scoreBefore = Object.fromEntries(s.players.map((p) => [p.id, p.score]));
  s.video = {
    status: q.media?.autoplay ? "playing" : "paused",
    offset: q.media?.start ?? 0,
    changedAt: now,
  };
  if (q.round === 1) {
    s.phase = "point";
    arm(s, s.config.timers.point, now);
  }
  if (q.round === 2 || q.round === 3) {
    s.phase = "answering";
    arm(s, s.config.timers.answer, now);
  }
  if (q.round === 4) {
    s.phase = "buzzing";
    arm(s, s.config.timers.buzz, now);
  }
  if (q.round === 5) {
    s.phase = "studying";
    arm(
      s,
      q.studySeconds ??
        s.config.timers.study[s.config.boardValues.indexOf(q.value)] ??
        s.config.timers.study[0],
      now,
    );
  }
  if (q.round === 6) {
    s.finalAttemptId = randomUUID();
    s.phase = "betting";
    s.bets = {};
    s.countries = {};
    arm(s, s.config.timers.bet, now);
  }
}
export function reveal(s: GameState) {
  requireRule(
    s.question && s.phase !== "reveal" && s.phase !== "finished",
    "Вопрос уже закрыт",
  );
  scoreQuestion(s);
  s.phase = s.round === 6 ? "finished" : "reveal";
  stopTimer(s);
  s.video.status = "stopped";
  if (!s.used.includes(s.question.id)) s.used.push(s.question.id);
}
export function expire(s: GameState, now: number): boolean {
  let videoEnded = false;
  if (
    !s.paused &&
    s.video.status === "playing" &&
    s.question?.media?.end !== undefined &&
    s.video.offset + (now - s.video.changedAt) / 1000 >= s.question.media.end
  ) {
    s.video.status = "paused";
    s.video.offset = s.question.media.end;
    s.video.changedAt = now;
    videoEnded = true;
  }
  if (s.config.rulesVersion === 2) return expireV2(s, now) || videoEnded;
  if (s.paused || s.timer.deadline === null || s.timer.deadline > now)
    return videoEnded;
  if (s.phase === "point") {
    s.phase = "ranges";
    arm(s, s.config.timers.ranges, now);
    if (s.roster.length <= 1) reveal(s);
  } else if (s.phase === "studying") {
    s.phase = "buzzing";
    s.video.status = "stopped";
    arm(s, s.config.timers.buzz, now);
  } else if (s.phase === "betting") {
    for (const id of s.roster) if (s.bets[id] === undefined) s.bets[id] = 0;
    s.phase = "locating";
    arm(s, FINAL_ANSWER_SECONDS, now);
  } else if (s.phase === "answering") {
    if (s.round === 3) reveal(s);
    else {
      s.phase = "awaitingReveal";
      stopTimer(s);
    }
  } else if (s.phase === "locating") {
    finishCountrySelection(s);
  } else if (["ranges", "buzzing"].includes(s.phase)) {
    reveal(s);
  } else stopTimer(s);
  return true;
}
export function applyCommand(
  s: GameState,
  who: Identity,
  c: Command,
  bank: Question[],
  now = Date.now(),
  receivedAt = now,
): string {
  if (c.type === "timer") {
    requireRule(who.role === "host", "Только ведущий меняет таймер");
    requireRule(
      s.question &&
        [
          "point",
          "ranges",
          "answering",
          "studying",
          "buzzing",
          "betting",
          "loadingPanorama",
          "locating",
        ].includes(s.phase) &&
        (s.timer.deadline !== null || s.timer.remaining !== null),
      "В этой фазе нет активного таймера",
    );
    const seconds = c.value;
    requireRule(
      typeof seconds === "number" &&
        Number.isSafeInteger(seconds) &&
        seconds >= 0 &&
        Number.isSafeInteger(now + seconds * 1000),
      "Введите целое неотрицательное число секунд",
    );
    if (s.paused || s.phase === "loadingPanorama")
      s.timer = { deadline: null, remaining: seconds * 1000 };
    else arm(s, seconds, now);
    return "Таймер установлен: " + seconds + " сек.";
  }
  if (c.type === "rename") {
    requireRule(who.role === "player", "Игрок может изменить только своё имя");
    const player = s.players.find((p) => p.id === who.playerId);
    requireRule(player, "Игрок не найден");
    player.name = availableName(s, c.value, player.id);
    return "Имя игрока изменено";
  }
  if (c.type === "restartGame") {
    requireRule(who.role === "host", "Только ведущий запускает новую партию");
    requireRule(s.round > 0 && s.phase !== "lobby", "Сначала начните игру");
    requireRule(
      c.value === "НАЧАТЬ ИГРУ ЗАНОВО",
      "Подтвердите начало новой партии тем же составом",
    );
    const fresh = initialState(s.config);
    fresh.players = s.players.map((p) => ({ ...p, score: 0, ready: false }));
    fresh.order = [
      ...s.order.filter((id) => s.players.some((p) => p.id === id)),
      ...s.players.map((p) => p.id).filter((id) => !s.order.includes(id)),
    ];
    fresh.selectedPackageId = s.selectedPackageId;
    fresh.packageSnapshot = structuredClone(s.packageSnapshot);
    fresh.finalSelection = structuredClone(s.finalSelection);
    fresh.finalRandom = s.finalRandom;
    fresh.resumeVideo = false;
    fresh.revision = s.revision;
    fresh.acceptedCommands = { ...s.acceptedCommands };
    applyCommand(fresh, who, { type: "start" }, bank, now, receivedAt);
    fresh.roundEpoch = randomUUID();
    Object.assign(s, fresh);
    return "Начата новая партия тем же составом. Очки, ответы и ставки обнулены";
  }
  if (["restartRound", "nextRound", "previousRound"].includes(c.type)) {
    requireRule(who.role === "host", "Только ведущий управляет раундами");
    requireRule(s.round > 0 && s.phase !== "lobby", "Сначала начните игру");
    if (c.type === "restartRound" || c.type === "previousRound") {
      const previous = c.type === "previousRound";
      requireRule(
        c.value === (previous ? "ПРЕДЫДУЩИЙ РАУНД" : "НАЧАТЬ РАУНД ЗАНОВО"),
        "Подтвердите возврат к началу раунда",
      );
      const checkpoint = previous
        ? previousRoundCheckpoint(s)
        : s.roundCheckpoint;
      requireRule(
        checkpoint && (previous || checkpoint.round === s.round),
        "В сохранении нет начала этого раунда. Возврат недоступен.",
      );
      for (const p of s.players) {
        p.score -= checkpoint.awards[p.id] ?? 0;
        if (previous) p.score -= s.roundCheckpoint!.awards[p.id] ?? 0;
      }
      if (previous) {
        s.roundIndex--;
        s.round = checkpoint.round;
        for (const round of s.config.roundOrder.slice(s.roundIndex))
          delete s.roundCheckpoints[round];
      }
      s.roundCheckpoint = structuredClone(checkpoint);
      s.used = [...checkpoint.used];
      s.boardIds = [...checkpoint.boardIds];
      s.order = [...checkpoint.order];
      s.roster = [...checkpoint.roster];
      s.turn = checkpoint.turn;
      s.roundCheckpoint.awards = {};
      s.completed = 0;
      s.total = s.round === 6 ? 1 : s.boardIds.length;
      clearQuestion(s);
      s.questionPublicId = null;
      s.scoreBefore = {};
      s.phase = "intro";
      s.finalAttemptId = null;
      s.bets = {};
      s.countries = {};
      s.panoramaReady = {};
      s.panoramaErrors = {};
      s.panoramaExcluded = [];
      s.lastDecision = null;
      s.decisionToken = null;
      s.paused = false;
      s.resumeVideo = false;
      s.roundEpoch = randomUUID();
      syncLegacyRoundBank(s, bank);
      return previous
        ? "Возврат к началу предыдущего раунда: начисления обоих раундов отменены, более ранние очки и ручные поправки сохранены"
        : "Раунд начат заново: ответы и начисления раунда отменены, предыдущие очки и ручные поправки сохранены";
    }
    requireRule(
      c.value === "СЛЕДУЮЩИЙ РАУНД",
      "Подтвердите переход к следующему раунду",
    );
    requireRule(
      s.roundIndex < s.config.roundOrder.length - 1 && s.phase !== "finished",
      "Это последний раунд",
    );
    if (s.question) {
      if (s.phase !== "reveal")
        for (const [id, delta] of Object.entries(s.deltas)) {
          const p = s.players.find((p) => p.id === id);
          if (p) p.score -= delta;
          if (s.roundCheckpoint)
            s.roundCheckpoint.awards[id] =
              (s.roundCheckpoint.awards[id] ?? 0) - delta;
        }
      s.turn++;
    }
    const currentBank =
      s.config.rulesVersion === 2 ? (s.packageSnapshot?.questions ?? []) : bank;
    s.used = [
      ...new Set([
        ...s.used,
        ...currentBank.filter((q) => q.round === s.round).map((q) => q.id),
      ]),
    ];
    s.roundIndex++;
    s.paused = false;
    s.resumeVideo = false;
    if (s.config.rulesVersion === 2) prepareRoundV2(s);
    else prepareRound(s, bank);
    s.roundEpoch = randomUUID();
    return "Ведущий перешёл к следующему раунду; оставшиеся задания пропущены";
  }
  if (s.config.rulesVersion === 2) {
    const result = commandV2(s, who, c, bank, now, receivedAt);
    if (result !== null) return result;
  }
  if (["selectFinal", "randomFinal", "cancelFinal"].includes(c.type)) {
    requireRule(who.role === "host", "Только ведущий выбирает панораму");
    if (c.type === "cancelFinal") {
      requireRule(
        s.round === 6 &&
          [
            "betting",
            "loadingPanorama",
            "locating",
            "awaitingReveal",
            "finished",
          ].includes(s.phase),
        "Нет активной попытки финала",
      );
      requireRule(c.value === "ОТМЕНИТЬ ФИНАЛ", "Подтвердите отмену финала");
      for (const [id, delta] of Object.entries(s.deltas)) {
        const p = s.players.find((p) => p.id === id);
        if (p) p.score -= delta;
        if (s.roundCheckpoint)
          s.roundCheckpoint.awards[id] =
            (s.roundCheckpoint.awards[id] ?? 0) - delta;
      }
      if (s.question) s.used = s.used.filter((id) => id !== s.question!.id);
      clearQuestion(s);
      s.bets = {};
      s.countries = {};
      s.scoreBefore = {};
      s.finalSelection = null;
      s.finalRandom = false;
      s.finalAttemptId = null;
      s.paused = false;
      s.resumeVideo = false;
      s.phase = "intro";
      return "Финал отменён. Ставки и ответы сброшены; очки предыдущих раундов сохранены";
    }
    requireRule(
      !s.finalAttemptId,
      "Финал уже начался. Сначала отмените финал и выберите другую панораму",
    );
    if (c.type === "randomFinal") {
      s.finalRandom = z.boolean().parse(c.value);
      if (s.finalRandom) s.finalSelection = null;
      return s.finalRandom
        ? "Ведущий включил случайный выбор финала"
        : "Включён ручной выбор финала";
    }
    const q = bank.find((q) => q.id === c.value && q.round === 6 && q.active);
    requireRule(q?.round === 6, "Выберите активную панораму из библиотеки");
    requireRule(
      q.source.trim() && q.license?.trim(),
      "Заполните источник и лицензию панорамы",
    );
    s.finalSelection = structuredClone(q);
    s.finalRandom = false;
    return "Панорама финала выбрана ведущим";
  }
  if (c.type === "ready") {
    requireRule(
      who.role === "player" && s.phase === "lobby",
      "Готовность доступна игрокам в лобби",
    );
    const p = s.players.find((p) => p.id === who.playerId);
    requireRule(p, "Сессия игрока удалена");
    p.ready = c.value === true;
    return p.name + " изменил готовность";
  }
  if (c.type === "joinOpen") {
    requireRule(who.role === "host", "Действие доступно только ведущему");
    s.joinOpen = c.value === true;
    return s.joinOpen ? "Вход открыт" : "Вход закрыт";
  }
  if (c.type === "pause" || c.type === "resume") {
    requireRule(
      who.role === "host" && !["lobby", "finished"].includes(s.phase),
      "Пауза недоступна",
    );
    if (c.type === "pause") {
      requireRule(!s.paused, "Игра уже на паузе");
      s.resumeVideo = s.video.status === "playing";
      s.paused = true;
      s.timer.remaining =
        s.timer.deadline === null
          ? s.timer.remaining
          : Math.max(0, s.timer.deadline - now);
      s.timer.deadline = null;
      if (s.video.status === "playing") {
        s.video.offset += (now - s.video.changedAt) / 1000;
        s.video.status = "paused";
      }
    } else {
      requireRule(s.paused, "Игра не на паузе");
      s.paused = false;
      if (s.phase !== "loadingPanorama") {
        s.timer.deadline =
          s.timer.remaining === null ? null : now + s.timer.remaining;
        s.timer.remaining = null;
      }
      if (s.resumeVideo) {
        s.video.status = "playing";
        s.video.changedAt = now;
        s.resumeVideo = false;
      }
    }
    return s.paused ? "Игра приостановлена" : "Игра продолжена";
  }
  requireRule(!s.paused || canAnswerDuringPause(s, who, c), "Игра на паузе");
  if (c.type === "choose") {
    requireRule(s.phase === "choosing", "Сейчас нельзя выбирать вопрос");
    requireRule(
      who.role === "host" || who.playerId === activeId(s),
      "Сейчас выбирает другой игрок",
    );
    const byId = s.round <= 3 && bank.some((q) => q.id === c.value);
    const q = bank.find(
      (q) =>
        q.active &&
        q.round === s.round &&
        !s.used.includes(q.id) &&
        (s.round <= 3
          ? byId
            ? q.id === c.value
            : q.category === c.value
          : s.boardIds.includes(q.id) && q.id === c.value),
    );
    requireRule(q, "Вопрос недоступен");
    beginQuestion(s, q, now);
    return "Выбран вопрос: " + q.category + " / " + q.value;
  }
  if (who.role === "player") {
    requireRule(
      who.playerId && s.roster.includes(who.playerId),
      "Вы вступите в игру со следующего раунда",
    );
    requireRule(
      !c.questionId || c.questionId === questionToken(s),
      "Этот вопрос уже закрыт",
    );
  }
  const result = roundCommand(s, who, c, now, receivedAt);
  if (result !== null) return result;
  requireRule(who.role === "host", "Действие доступно только ведущему");
  if (c.type === "start") {
    requireRule(s.phase === "lobby", "Игра уже началась");
    const errors = validateBank(bank, s.config, s.players.length);
    requireRule(!errors.length, errors.join("; "));
    if (s.order.length !== s.players.length)
      s.order = shuffled(s.players.map((p) => p.id));
    s.joinOpen = false;
    s.roundIndex = 0;
    prepareRound(s, bank);
    return "Игра началась. Порядок определён";
  }
  if (c.type === "begin") {
    requireRule(s.phase === "intro", "Сначала перейдите к новому раунду");
    if (s.round === 6) {
      const eligible = bank.filter(
        (q) =>
          q.round === 6 && q.active && q.source.trim() && q.license?.trim(),
      );
      const q = s.finalRandom
        ? shuffled(eligible)[0]
        : bank.find((q) => q.id === s.finalSelection?.id && q.active);
      requireRule(
        q?.round === 6,
        s.finalRandom
          ? "Нет доступных панорам для случайного выбора"
          : "Перед финалом выберите панораму в разделе «Финальные панорамы»",
      );
      requireRule(
        q.source.trim() && q.license?.trim(),
        "Заполните источник и лицензию панорамы",
      );
      s.finalSelection = structuredClone(q);
      beginQuestion(s, q, now);
    } else if (s.total === 0) {
      s.roundIndex++;
      prepareRound(s, bank);
      return "Пустой раунд пропущен ведущим";
    } else s.phase = "choosing";
    return "Раунд " + s.round + " начат";
  }
  if (c.type === "next") {
    requireRule(
      s.phase === "reveal",
      "Сначала раскройте или пропустите вопрос",
    );
    s.completed++;
    s.turn++;
    clearQuestion(s);
    syncLegacyRoundBank(s, bank);
    if (s.completed >= s.total) {
      s.roundIndex++;
      prepareRound(s, bank);
    } else {
      s.phase = "choosing";
    }
    return "Переход к следующему вопросу";
  }
  if (c.type === "reveal") {
    if (s.question?.round === 6)
      requireRule(
        s.phase === "awaitingReveal",
        "Дождитесь ответов игроков или окончания времени",
      );
    requireRule(
      [
        "point",
        "ranges",
        "answering",
        "awaitingReveal",
        "buzzing",
        "judging",
        "locating",
      ].includes(s.phase),
      "Раскрытие сейчас недоступно",
    );
    reveal(s);
    return "Ответ раскрыт";
  }
  if (c.type === "skip") {
    requireRule(
      s.question && !["finished", "reveal", "betting"].includes(s.phase),
      "Нет открытого вопроса",
    );
    for (const [id, delta] of Object.entries(s.deltas)) {
      const p = s.players.find((p) => p.id === id);
      if (p) p.score -= delta;
      if (s.roundCheckpoint)
        s.roundCheckpoint.awards[id] =
          (s.roundCheckpoint.awards[id] ?? 0) - delta;
    }
    s.deltas = {};
    s.phase = s.round === 6 ? "finished" : "reveal";
    stopTimer(s);
    s.video.status = "stopped";
    s.used.push(s.question.id);
    return "Испорченный вопрос пропущен, начисления отменены";
  }
  if (c.type === "score") {
    const v = z
      .object({
        playerId: z.string(),
        amount: z.number().int().min(-1000000).max(1000000),
        reason: z.string().trim().min(3).max(300),
      })
      .parse(c.value);
    const p = s.players.find((p) => p.id === v.playerId);
    requireRule(p, "Игрок не найден");
    p.score += v.amount;
    return (
      "Корректировка " +
      p.name +
      ": " +
      (v.amount > 0 ? "+" : "") +
      v.amount +
      ". Причина: " +
      v.reason
    );
  }
  if (c.type === "active") {
    requireRule(
      ["choosing", "intro"].includes(s.phase),
      "Сменить выбирающего можно перед вопросом",
    );
    const idx = s.order.indexOf(String(c.value));
    requireRule(idx >= 0, "Игрок вне очереди");
    s.turn = idx;
    return "Ведущий назначил активного игрока";
  }
  if (c.type === "remove") {
    requireRule(s.phase === "lobby", "Удаление доступно только в лобби");
    s.players = s.players.filter((p) => p.id !== c.value);
    s.order = s.order.filter((id) => id !== c.value);
    return "Игрок удалён из лобби";
  }
  if (c.type === "order") {
    requireRule(
      s.phase === "lobby" || s.phase === "intro",
      "Порядок меняется в лобби или между раундами",
    );
    const ids = z.array(z.string()).parse(c.value);
    const expected =
      s.phase === "lobby" ? s.players.map((p) => p.id) : s.roster;
    requireRule(
      ids.length === expected.length &&
        new Set(ids).size === ids.length &&
        expected.every((id) => ids.includes(id)),
      "Укажите всех игроков по одному разу",
    );
    s.order = ids;
    return "Порядок игроков изменён";
  }
  if (c.type === "video") {
    requireRule(
      s.question?.media &&
        s.question.media.kind !== "image" &&
        ["answering", "studying", "buzzing"].includes(s.phase),
      "Видео сейчас недоступно",
    );
    const op = z.enum(["play", "pause", "restart", "stop"]).parse(c.value);
    if (s.video.status === "playing")
      s.video.offset += (now - s.video.changedAt) / 1000;
    if (op === "restart") s.video.offset = s.question.media.start;
    s.video.status =
      op === "play" || op === "restart"
        ? "playing"
        : op === "pause"
          ? "paused"
          : "stopped";
    s.video.changedAt = now;
    if (op === "stop" && s.phase === "studying") {
      s.phase = "buzzing";
      arm(s, s.config.timers.buzz, now);
    }
    return "Видео: " + op;
  }
  throw new Error("Команда недоступна в текущей фазе");
}
