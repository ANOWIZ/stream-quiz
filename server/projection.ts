import type { GameView, Identity, PublicQuestion } from "../shared/types.js";
import { previousRoundCheckpoint } from "./round-checkpoints.js";
import type { Store } from "./store.js";
import { activeId, questionToken } from "./game.js";
import { packageSummary } from "../shared/packages.js";
import { numericKind, comparisonResult } from "../shared/comparison.js";
import { numericScore } from "../shared/numeric-score.js";

function categoryLabel(category: string): string {
  return category === "Рэп / Политика · 1" || category === "Рэп / Политика · 2"
    ? "Рэп / Политика"
    : category;
}

export function project(
  store: Store,
  who: Identity,
  connected: Set<string>,
  now = Date.now(),
): GameView {
  const s = store.state;
  const packages = store.packages ?? [];
  const q = s.question;
  const v2 = s.config.rulesVersion === 2;
  const revealed = s.phase === "reveal" || s.phase === "finished";
  let question: PublicQuestion | null = null;
  if (q) {
    question = {
      id: questionToken(s)!,
      category:
        q.round === 6 && !revealed
          ? "Финальная локация"
          : v2 && q.round === 5 && !revealed
            ? "Задание на память"
            : categoryLabel(q.category),
      round: q.round,
      value: q.value,
    };
    if (
      !(q.round === 5 && s.phase === "studying") &&
      !(q.round === 6 && s.phase === "betting")
    )
      question.text = q.round === 6 && !revealed ? "Где это?" : q.text;
    if (
      q.media &&
      q.round !== 6 &&
      (q.round !== 5 || s.phase === "studying" || revealed)
    )
      question.media = {
        ...q.media,
        ...(q.round === 4 && revealed && q.fullImageFileId
          ? { fileId: q.fullImageFileId }
          : {}),
        ...(!revealed && (q.round === 5 || q.round === 4)
          ? {
              alt:
                q.round === 5
                  ? "Изображение для запоминания"
                  : "Фрагмент изображения",
            }
          : {}),
      };
    if (v2 && question.media?.fileId)
      question.media.fileId = s.mediaTokens[question.media.fileId];
    if (q.round === 1) {
      question.min = q.min;
      question.max = q.max;
      question.unit = q.unit;
      if (v2) question.numericKind = numericKind(q);
    }
    if (q.round === 2) {
      question.anchorText = q.anchorText;
      if (revealed) question.anchorDate = q.anchorDate;
      if (revealed) question.targetDate = q.targetDate;
    }
    if (q.round === 3) question.options = q.options;
    if (q.round === 6 && s.phase !== "betting")
      question.panorama = q.panoramaFileId
        ? {
            provider: "local",
            fileId: v2 ? s.mediaTokens[q.panoramaFileId] : q.panoramaFileId,
            camera: q.camera,
          }
        : undefined;
    if (revealed) {
      question.answer = q.answer;
      question.explanation = q.explanation;
      question.source = q.source;
      question.alternatives = q.alternatives;
      if (q.round === 1) {
        question.acceptedMin = q.acceptedMin;
        question.acceptedMax = q.acceptedMax;
      }
      if (q.round === 3) {
        question.speaker = q.speaker;
        question.work = q.work;
        question.translated = q.translated;
        question.translationNote = q.translationNote;
      }
      if (q.round === 6) {
        question.place = q.place;
        question.author = q.author;
        question.license = q.license;
        question.licenseUrl = q.licenseUrl;
        question.location = q.location;
      }
    }
  }
  const own = who.playerId;
  const showAnswers = revealed || (!v2 && s.round === 1);
  const answers = showAnswers
    ? s.answers
    : own && s.answers[own]
      ? { [own]: s.answers[own] }
      : {};
  if (v2 && s.round === 1 && !revealed) {
    const active = activeId(s);
    if (active && s.answers[active])
      answers[active] = {
        value: s.answers[active].value,
        locked: s.answers[active].locked,
      };
  }
  const bets = revealed
    ? s.bets
    : own && s.bets[own] !== undefined
      ? { [own]: s.bets[own] }
      : {};
  const countries = revealed
    ? s.countries
    : own && s.countries[own]
      ? { [own]: s.countries[own] }
      : {};
  const rows = (v2 ? (s.packageSnapshot?.questions ?? []) : store.bank).filter(
    (q) =>
      q.active &&
      q.round === s.round &&
      (v2
        ? s.boardIds.includes(q.id)
        : s.round <= 3 || s.boardIds.includes(q.id)),
  );
  return {
    ...(revealed && q
      ? {
          answerResults: Object.fromEntries(
            s.roster.map((id) => {
              const a = s.answers[id];
              if (q.round === 1) {
                if (!v2)
                  return [
                    id,
                    numericScore(q, a, id === activeId(s), s.config).result,
                  ];
                const guess = s.answers[activeId(s) ?? ""];
                if (!a?.locked || !guess?.locked || guess.value === undefined)
                  return [id, "missing"];
                const result = comparisonResult(q, guess.value, s.config);
                return [
                  id,
                  (
                    id === activeId(s)
                      ? result.correct
                      : a.choice === result.choice
                  )
                    ? "correct"
                    : "wrong",
                ];
              }
              if (q.round === 2 || q.round === 3)
                return [
                  id,
                  !a?.locked
                    ? "missing"
                    : a.choice === q.answer
                      ? "correct"
                      : "wrong",
                ];
              if (q.round === 6)
                return [
                  id,
                  !s.countries[id]?.code
                    ? "missing"
                    : s.countries[id].code === q.answer
                      ? "correct"
                      : "wrong",
                ];
              if (a?.locked && (a.choice === "correct" || a.choice === "wrong"))
                return [id, a.choice];
              return [
                id,
                s.blocked.includes(id)
                  ? "wrong"
                  : (s.deltas[id] ?? 0) > 0
                    ? "correct"
                    : "missing",
              ];
            }),
          ) as GameView["answerResults"],
        }
      : {}),
    ...(revealed && q?.round === 6
      ? {
          finalCorrect: Object.fromEntries(
            s.roster.map((id) => [id, s.countries[id]?.code === q.answer]),
          ),
        }
      : {}),
    ...(who.role === "host"
      ? {
          packages: packages.map(packageSummary),
          selectedPackage: packages.find(
            (pack) => pack.id === s.selectedPackageId,
          )
            ? packageSummary(
                packages.find((pack) => pack.id === s.selectedPackageId)!,
              )
            : null,
          canUndoDecision: !!s.lastDecision,
          canPreviousRound: !!previousRoundCheckpoint(s),
          undoDecisionToken: s.lastDecision?.token ?? null,
        }
      : {}),
    packageName: s.packageSnapshot?.name,
    panoramaReady: s.panoramaReady,
    panoramaErrors:
      who.role === "host"
        ? s.panoramaErrors
        : own && s.panoramaErrors[own]
          ? { [own]: s.panoramaErrors[own] }
          : {},
    decisionToken: who.role === "host" ? s.decisionToken : null,
    revision: s.revision,
    roundEpoch: s.roundEpoch,
    finalAttemptId: s.finalAttemptId,
    ...(who.role === "host"
      ? { finalSelection: s.finalSelection, finalRandom: s.finalRandom }
      : {}),
    serverNow: now,
    phase: s.phase,
    round: s.round,
    roundIndex: s.roundIndex,
    players: s.players.map((p) => ({
      ...p,
      connected: connected.has(p.id),
      answered: !!s.answers[p.id]?.locked,
      betDone: s.bets[p.id] !== undefined,
      countryDone: !!s.countries[p.id]?.locked,
    })),
    self: {
      ...who,
      name: s.players.find((p) => p.id === own)?.name ?? who.name,
    },
    joinOpen: s.joinOpen,
    activePlayerId: activeId(s),
    order: s.order,
    roster: s.roster,
    completed: s.completed,
    total: s.total,
    question,
    board: (s.round === 6 ? [] : rows).map((q, index) => ({
      id: v2 ? s.publicIds[q.id] : q.id,
      category:
        v2 && q.round === 5 ? String(index + 1) : categoryLabel(q.category),
      value: v2 ? 0 : q.value,
      used: s.used.includes(q.id),
    })),
    answers,
    bets,
    countries,
    timer: s.timer,
    paused: s.paused,
    buzzWinner: s.buzzWinner,
    blocked: s.blocked,
    buzzes: who.role === "host" ? s.buzzes : [],
    video: s.video,
    config: s.config,
    deltas: s.deltas,
    events: who.role === "host" ? store.events : [],
    judgingGuide:
      who.role === "host" &&
      s.phase === "judging" &&
      q &&
      [4, 5].includes(q.round)
        ? { answer: String(q.answer), alternatives: q.alternatives }
        : undefined,
    warnings: [],
  };
}
