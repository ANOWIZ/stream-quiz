import { z } from "zod";
export const ROUND_NAMES: Record<number, string> = {
  1: "Больше-меньше",
  2: "До или после",
  3: "Два мира",
  4: "Угадай по фрагменту",
  5: "Запомни кадр",
  6: "Где это?",
};
export const roundNamesSchema = z
  .record(z.string().trim().min(1).max(100))
  .refine(
    (names) =>
      Object.keys(names).length === 6 &&
      [1, 2, 3, 4, 5, 6].every((round) => !!names[round]),
    "Укажите названия всех шести раундов",
  );
const positive = z.number().finite().positive();
export const configSchema = z
  .object({
    rulesVersion: z.union([z.literal(1), z.literal(2)]).default(1),
    comparison: z
      .object({
        points: z.number().int().positive(),
        percentTolerance: z.number().positive(),
        relativeTolerance: z.number().positive().max(1),
      })
      .default({ points: 1000, percentTolerance: 5, relativeTolerance: 0.05 }),
    buzzerPoints: z
      .object({
        fragmentCorrect: z.number().int().positive(),
        fragmentWrong: z.number().int().positive(),
        memoryCorrect: z.number().int().positive(),
        memoryWrong: z.number().int().positive(),
      })
      .default({
        fragmentCorrect: 1000,
        fragmentWrong: 500,
        memoryCorrect: 1000,
        memoryWrong: 1000,
      }),
    maxPlayers: z.number().int().min(2).max(6),
    roundNames: roundNamesSchema.default(ROUND_NAMES),
    roundOrder: z
      .array(z.number().int().min(1).max(6))
      .length(6)
      .refine(
        (a) => new Set(a).size === 6 && a[5] === 6,
        "Все раунды по одному разу, финал последним",
      ),
    questionCounts: z.record(z.number().int().positive()),
    numeric: z.object({
      narrow: positive.max(1),
      wide: positive.max(1),
      thresholds: z.tuple([positive, positive, positive]),
      activePoints: z.tuple([positive, positive, positive]),
      narrowPoints: positive,
      widePoints: positive,
    }),
    choicePoints: z.object({ beforeAfter: positive, twoWorlds: positive }),
    boardValues: z
      .tuple([positive.int(), positive.int(), positive.int()])
      .refine((a) => new Set(a).size === 3, "Стоимость должна различаться"),
    timers: z.object({
      point: positive.max(600),
      ranges: positive.max(600),
      answer: positive.max(600),
      buzz: positive.max(600),
      judge: positive.max(600),
      bet: positive.max(600),
      study: z.tuple([positive.max(120), positive.max(120), positive.max(120)]),
    }),
    final: z.object({
      // Read old saved percentages, but the current rules allow the full score.
      betLimit: z
        .number()
        .min(0)
        .max(1)
        .transform(() => 1),
      seconds: positive.max(120),
    }),
    uploads: z.object({
      imageMB: positive.max(50),
      videoMB: positive.max(500),
    }),
  })
  .superRefine((c, ctx) => {
    if (c.numeric.narrow >= c.numeric.wide)
      ctx.addIssue({
        code: "custom",
        message: "Узкий коридор должен быть уже широкого",
      });
    if (!(
      c.numeric.thresholds[0] <= c.numeric.thresholds[1] &&
      c.numeric.thresholds[1] <= c.numeric.thresholds[2] &&
      c.numeric.thresholds[2] <= 1
    ))
      ctx.addIssue({
        code: "custom",
        message: "Пороги отклонений должны возрастать в пределах 1",
      });
    if (
      c.rulesVersion === 2 &&
      (c.final.seconds !== 60 ||
        c.timers.study.some((n) => n !== 30) ||
        c.roundOrder.join() !== "1,2,3,4,5,6")
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Новые правила: порядок раундов 1–6, память 30 секунд, география 60 секунд",
      });
  });
export type Config = z.infer<typeof configSchema>;
export const defaultConfig: Config = {
  rulesVersion: 1,
  comparison: { points: 1000, percentTolerance: 5, relativeTolerance: 0.05 },
  buzzerPoints: {
    fragmentCorrect: 1000,
    fragmentWrong: 500,
    memoryCorrect: 1000,
    memoryWrong: 1000,
  },
  maxPlayers: 6,
  roundNames: { ...ROUND_NAMES },
  roundOrder: [1, 2, 3, 4, 5, 6],
  questionCounts: { 2: 10, 3: 9, 4: 8, 5: 10, 6: 12 },
  numeric: {
    narrow: 0.1,
    wide: 0.2,
    thresholds: [0.05, 0.1, 0.2],
    activePoints: [300, 200, 100],
    narrowPoints: 200,
    widePoints: 100,
  },
  choicePoints: { beforeAfter: 200, twoWorlds: 200 },
  boardValues: [100, 200, 300],
  timers: {
    point: 45,
    ranges: 45,
    answer: 35,
    buzz: 45,
    judge: 30,
    bet: 45,
    study: [30, 20, 15],
  },
  final: { betLimit: 1, seconds: 120 },
  uploads: { imageMB: 15, videoMB: 150 },
};
export const V2_ROUND_NAMES: Record<number, string> = {
  1: "Больше-меньше",
  2: "До и после",
  3: "Кто это сказал?",
  4: "Угадай по фрагменту",
  5: "Запомни",
  6: "География",
};
export function upgradeConfig(config: Config = defaultConfig): Config {
  return configSchema.parse({
    ...structuredClone(config),
    rulesVersion: 2,
    roundNames: Object.fromEntries(
      Object.entries(config.roundNames).map(([round, name]) => [
        round,
        name === ROUND_NAMES[Number(round)]
          ? V2_ROUND_NAMES[Number(round)]
          : name,
      ]),
    ),
    roundOrder: [1, 2, 3, 4, 5, 6],
    choicePoints: { beforeAfter: 1500, twoWorlds: 2000 },
    questionCounts: { 2: 10, 3: 10, 4: 10, 5: 10, 6: 10 },
    timers: { ...config.timers, study: [30, 30, 30] },
    final: { betLimit: 1, seconds: 60 },
  });
}
export const PLAYER_COLORS = [
  "#B7ADFF",
  "#80DCC8",
  "#FFAD85",
  "#8CC8FF",
  "#F2C86B",
  "#F596C3",
];
