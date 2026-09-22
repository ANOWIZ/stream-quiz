import { z } from "zod";
import { panoramaCameraSchema, defaultPanoramaCamera } from "./panorama.js";
import { eventDateSchema, compareEventDates } from "./dates.js";
const text = z.string().trim().min(1).max(6000);
export const locationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof locationSchema>;
export const cropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (c) => c.x + c.width <= 1.000001 && c.y + c.height <= 1.000001,
    "Фрагмент выходит за границы изображения",
  );
export type ImageCrop = z.infer<typeof cropSchema>;
const url = z
  .string()
  .url()
  .max(2000)
  .refine((v) => v.startsWith("https://"), "Нужна HTTPS-ссылка");
export const mediaSchema = z
  .object({
    kind: z.enum(["image", "video", "youtube"]),
    fileId: z.string().max(100).optional(),
    url: url.optional(),
    alt: z.string().max(500).default("Иллюстрация к вопросу"),
    start: z.number().min(0).default(0),
    end: z.number().positive().optional(),
    muted: z.boolean().default(true),
    autoplay: z.boolean().default(false),
  })
  .refine((m) => !!m.fileId !== !!m.url, "Укажите файл или ссылку")
  .refine(
    (m) => m.end === undefined || m.end > m.start,
    "Конец фрагмента должен быть позже начала",
  );
export type MediaRef = z.infer<typeof mediaSchema>;
const base = {
  formatVersion: z.literal(2).optional(),
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  category: text.max(100),
  text: text,
  explanation: z.string().trim().max(6000).default(""),
  source: z.string().trim().max(6000).default(""),
  active: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
  value: z.number().int().min(0).default(100),
  difficulty: z.number().int().min(1).max(5).default(1),
  alternatives: z.array(z.string().max(300)).max(30).default([]),
  media: mediaSchema.optional(),
};
export const questionSchema = z
  .discriminatedUnion("round", [
    z.object({
      ...base,
      round: z.literal(1),
      numericKind: z.enum(["number", "percent"]).optional(),
      min: z.number().finite(),
      max: z.number().finite(),
      unit: z.string().max(60),
      answer: z.number().finite(),
      acceptedMin: z.number().finite().optional(),
      acceptedMax: z.number().finite().optional(),
    }),
    z.object({
      ...base,
      round: z.literal(2),
      anchorText: text,
      anchorDate: eventDateSchema,
      targetDate: eventDateSchema,
      answer: z.enum(["before", "after"]),
    }),
    z.object({
      ...base,
      round: z.literal(3),
      speaker: z.string().trim().max(500).optional(),
      work: z.string().trim().max(1000).optional(),
      translated: z.boolean().optional(),
      translationNote: z.string().trim().max(1000).optional(),
      verified: z.boolean().optional(),
      options: z.tuple([text.max(150), text.max(150)]),
      answer: z.enum(["a", "b"]),
    }),
    z.object({
      ...base,
      round: z.literal(4),
      fullImageFileId: z.string().max(100).optional(),
      suppliedFragment: z.boolean().optional(),
      crop: cropSchema.optional(),
      answer: text,
      media: mediaSchema,
    }),
    z.object({
      ...base,
      round: z.literal(5),
      answer: text,
      media: mediaSchema,
      studySeconds: z.number().positive().max(120).optional(),
    }),
    z.object({
      ...base,
      round: z.literal(6),
      location: locationSchema.optional(),
      source: text,
      answer: z.string().regex(/^[A-Z]{2}$/),
      place: text,
      panoramaFileId: z
        .string()
        .regex(/^[a-zA-Z0-9_-]{1,100}$/)
        .optional(),
      title: z.string().trim().max(150).optional(),
      author: z.string().trim().max(500).optional(),
      license: z.string().trim().max(1000).optional(),
      licenseUrl: url.optional(),
      camera: panoramaCameraSchema.default(defaultPanoramaCamera),
      addedAt: z.string().datetime().optional(),
    }),
  ])
  .superRefine((q, ctx) => {
    if (
      q.round === 1 &&
      (q.acceptedMin !== undefined || q.acceptedMax !== undefined)
    ) {
      if (
        q.acceptedMin === undefined ||
        q.acceptedMax === undefined ||
        q.acceptedMin > q.answer ||
        q.acceptedMax < q.answer ||
        q.acceptedMin < q.min ||
        q.acceptedMax > q.max ||
        Math.ceil(q.acceptedMin) > Math.floor(q.acceptedMax)
      )
        ctx.addIssue({
          code: "custom",
          message:
            "Укажите обе границы зачёта: диапазон должен быть внутри шкалы и включать правильный ответ",
        });
    }
    if (
      q.round === 1 &&
      (q.max <= q.min ||
        q.answer < q.min ||
        q.answer > q.max ||
        Math.ceil(q.min) > Math.floor(q.max))
    )
      ctx.addIssue({
        code: "custom",
        message: "Неверная шкала или ответ вне шкалы",
      });
    if (
      q.round === 2 &&
      q.answer !== compareEventDates(q.targetDate, q.anchorDate)
    )
      ctx.addIssue({
        code: "custom",
        message: "Даты должны различаться и соответствовать ответу",
      });
    if (q.round === 6 && q.active && !q.panoramaFileId)
      ctx.addIssue({
        code: "custom",
        message: "Загрузите локальный файл панорамы",
      });
  });
export type Question = z.infer<typeof questionSchema>;
export type FinalQuestion = Extract<Question, { round: 6 }>;
export const importSchema = z
  .object({
    version: z.literal(1),
    questions: z.array(questionSchema).max(10000),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.questions.map((q) => q.id)).size !== v.questions.length)
      ctx.addIssue({ code: "custom", message: "Дублирующиеся ID вопросов" });
  });
