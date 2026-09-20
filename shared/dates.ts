import { z } from "zod";

// Existing content stores years as numbers. Exact dates also support events
// within the same year, without inventing a day for a year-only source.
export const eventDateSchema = z.union([
  z.number().int().min(-9999).max(9999),
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}(?:-\d{2})?$/)
    .refine((value) => {
      const [year, month, day = 1] = value.split("-").map(Number);
      const date = new Date(0);
      date.setUTCFullYear(year, month - 1, day);
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    }, "Укажите существующую дату: ГГГГ-ММ или ГГГГ-ММ-ДД"),
]);
export type EventDate = z.infer<typeof eventDateSchema>;

function bounds(value: EventDate): [number, number] {
  if (typeof value === "number")
    return [value * 10000 + 101, value * 10000 + 1231];
  const [year, month, day] = value.split("-").map(Number);
  return [
    year * 10000 + month * 100 + (day ?? 1),
    year * 10000 + month * 100 + (day ?? 31),
  ];
}
export function compareEventDates(target: EventDate, anchor: EventDate) {
  const a = bounds(anchor),
    b = bounds(target);
  return b[1] < a[0] ? "before" : b[0] > a[1] ? "after" : null;
}
export function formatEventDate(value: EventDate | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number" || !/^\d{4}-\d{2}(?:-\d{2})?$/.test(value))
    return String(value);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day ?? 1);
  return new Intl.DateTimeFormat("ru", {
    ...(day === undefined ? {} : { day: "numeric" }),
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
