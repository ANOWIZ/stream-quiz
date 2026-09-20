import { expect, it } from "vitest";
import {
  initialState,
  joinPlayer,
  applyCommand,
  activeId,
  expire,
} from "../server/game.js";
import { demoQuestions } from "../server/content.js";
const host = { role: "host" as const, id: "host", name: "Ведущий" };
it.each([0, 1, 2, 3, 4, 5, 6])(
  "полная штатная партия на %s игроков, циклическая очередь и все вопросы банка",
  (count) => {
    const s = initialState();
    const bank = demoQuestions();
    for (let i = 0; i < count; i++) joinPlayer(s, "Игрок " + i);
    let time = 1000;
    const send = (type: string, value?: unknown, id?: string) =>
      applyCommand(
        s,
        id ? { role: "player", id, playerId: id, name: "Игрок" } : host,
        { type, value },
        bank,
        time++,
      );
    send("selectFinal", "demo-local-360");
    send("start");
    const choices: Record<number, Record<string, number>> = {};
    let questions = 0;
    while (s.phase !== "finished" && questions < 120) {
      if (s.phase === "intro") send("begin");
      if (s.phase === "choosing") {
        const active = activeId(s)!;
        choices[s.round] ??= {};
        choices[s.round][active] = (choices[s.round][active] ?? 0) + 1;
        const q = bank.find(
          (q) =>
            q.round === s.round &&
            q.active &&
            !s.used.includes(q.id) &&
            (s.round <= 3 || s.boardIds.includes(q.id)),
        )!;
        send("choose", s.round <= 3 ? q.category : q.id, active);
        questions++;
      }
      const q = s.question!;
      if (!count && ["point", "answering", "buzzing"].includes(s.phase))
        send("reveal");
      if (s.phase === "point" && q.round === 1) {
        send("point", q.answer, activeId(s)!);
        for (const id of s.roster.filter((id) => id !== activeId(s)))
          send(
            "range",
            {
              start: Math.max(
                q.min,
                Math.min(
                  q.max - (q.max - q.min) * s.config.numeric.narrow,
                  q.answer - ((q.max - q.min) * s.config.numeric.narrow) / 2,
                ),
              ),
              width: "narrow",
              locked: true,
            },
            id,
          );
      }
      if (s.phase === "answering") {
        for (const id of s.roster) send("answer", q.answer, id);
      }
      if (s.phase === "awaitingReveal") send("reveal");
      if (s.phase === "studying") {
        time = s.timer.deadline!;
        expire(s, time++);
      }
      if (s.phase === "buzzing") {
        if (count) {
          send("buzz", undefined, s.roster[0]);
          send("judge", true);
        } else send("reveal");
      }
      if (s.phase === "reveal") send("next");
      if (s.phase === "betting") {
        if (!count) send("beginLocation");
        for (const id of s.roster) send("bet", 0, id);
      }
      if (s.phase === "locating") {
        if (!count) expire(s, s.timer.deadline!);
        for (const id of s.roster) {
          send("country", "FR", id);
          send("confirmCountry", undefined, id);
        }
      }
    }
    expect(s.phase).toBe("finished");
    expect(s.used.length).toBe(bank.length);
    for (const r of count ? [1, 2, 3] : [])
      for (const n of Object.values(choices[r]))
        expect([Math.floor(12 / count), Math.ceil(12 / count)]).toContain(n);
    expect(s.players.every((p) => Number.isFinite(p.score))).toBe(true);
  },
);

it.each([0, 1])(
  "истечение точной отметки при %s участниках не ждёт пустую очередь диапазонов",
  (count) => {
    const s = initialState();
    for (let i = 0; i < count; i++) joinPlayer(s, "Игрок");
    const bank = demoQuestions();
    applyCommand(s, host, { type: "start" }, bank);
    applyCommand(s, host, { type: "begin" }, bank);
    applyCommand(
      s,
      host,
      { type: "choose", value: bank.find((q) => q.round === 1)!.category },
      bank,
    );
    expect(expire(s, s.timer.deadline!)).toBe(true);
    expect(s.phase).toBe("reveal");
    expect(s.players.every((p) => p.score === 0)).toBe(true);
  },
);
