import { expect, it } from "vitest";
import {
  compareEventDates,
  eventDateSchema,
  formatEventDate,
} from "../shared/dates.js";
import { questionSchema } from "../shared/content.js";
import { v2Fixture, hostV2 } from "./v2-fixture.js";
import { project } from "../server/projection.js";
import type { Store } from "../server/store.js";

const film = {
  id: "same-year",
  round: 2,
  category: "Кино",
  text: "Гарри Поттер",
  anchorText: "Шрек",
  anchorDate: "2001-05-18",
  targetDate: "2001-11-16",
  answer: "after",
  explanation: "Премьеры в США",
  source: "Документ ведущего",
};
it("сравнивает точные даты одного года и сохраняет старые числовые годы", () => {
  expect(questionSchema.parse(film)).toMatchObject({
    anchorDate: "2001-05-18",
    answer: "after",
  });
  expect(questionSchema.safeParse({ ...film, answer: "before" }).success).toBe(
    false,
  );
  expect(compareEventDates(1991, 1997)).toBe("before");
  expect(compareEventDates("1977-09-10", "1977-05-25")).toBe("after");
  expect(compareEventDates("1970-04", "1969-07")).toBe("after");
  expect(compareEventDates("2001-05-18", 2001)).toBeNull();
  expect(compareEventDates("2001-05-18", "2001-05")).toBeNull();
  expect(formatEventDate("2001-05-18")).toContain("18 мая 2001");
  expect(formatEventDate(1991)).toBe("1991");
});
it("отклоняет несуществующие даты и принимает високосный день", () => {
  for (const value of [
    "2001-02-29",
    "2001-13-01",
    "2001-00",
    "2001-04-31",
    "",
    2001.5,
  ])
    expect(eventDateSchema.safeParse(value).success).toBe(false);
  expect(eventDateSchema.parse("2000-02-29")).toBe("2000-02-29");
});
it("держит обе точные даты в секрете до раскрытия", () => {
  const { state, questions } = v2Fixture(2);
  state.round = 2;
  state.question = questionSchema.parse(film);
  state.phase = "answering";
  const store = { state, bank: questions, events: [] } as unknown as Store;
  const player = {
    id: "p",
    role: "player" as const,
    name: "Игрок",
    playerId: state.players[0].id,
  };
  for (const who of [hostV2, player]) {
    const hidden = project(store, who, new Set()).question;
    expect(hidden).not.toHaveProperty("anchorDate");
    expect(hidden).not.toHaveProperty("targetDate");
    expect(hidden).not.toHaveProperty("answer");
  }
  state.phase = "reveal";
  expect(project(store, player, new Set()).question).toMatchObject({
    anchorDate: "2001-05-18",
    targetDate: "2001-11-16",
    answer: "after",
  });
});
