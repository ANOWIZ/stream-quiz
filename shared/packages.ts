import { z } from "zod";
import { questionSchema, type Question } from "./content.js";
import { eventDateSchema } from "./dates.js";

export const packageSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(2000).default(""),
  revision: z.number().int().positive(),
  updatedAt: z.string(),
  questions: z.array(questionSchema),
});
export type GamePackage = z.infer<typeof packageSchema>;
export type PackageSummary = Pick<
  GamePackage,
  "id" | "name" | "description" | "revision" | "updatedAt"
> & {
  questionIds: string[];
  counts: Record<number, number>;
  issues: string[];
};
export function questionIssues(q: Question): string[] {
  const issues: string[] = [];
  if (!q.active) issues.push("вопрос отключён");
  if (!q.source.trim()) issues.push("укажите источник");
  if (
    q.round === 1 &&
    (q.numericKind ?? (q.unit === "%" ? "percent" : "number")) === "percent" &&
    (q.min !== 0 || q.max !== 100 || q.unit !== "%")
  )
    issues.push("процентная шкала должна быть 0–100 %");
  if (q.round === 1 && Math.ceil(q.min) > Math.floor(q.max))
    issues.push("шкала должна содержать хотя бы одно целое число");
  if (q.round === 3) {
    if (!q.speaker?.trim()) issues.push("укажите автора или персонажа");
    if (!q.work?.trim()) issues.push("укажите произведение или выступление");
    if (!q.verified) issues.push("подтвердите проверку цитаты по источнику");
    if (q.translated && !q.translationNote?.trim())
      issues.push("укажите сведения о переводе");
  }
  if (q.round === 4) {
    if (
      !q.fullImageFileId ||
      (!q.crop && !q.suppliedFragment) ||
      !q.media.fileId ||
      q.media.fileId === q.fullImageFileId
    )
      issues.push(
        "нужны исходное изображение и отдельный подготовленный фрагмент",
      );
    if (q.media.kind !== "image")
      issues.push("для фрагмента требуется изображение");
  }
  if (q.round === 5 && (q.media.kind !== "image" || !q.media.fileId))
    issues.push("для запоминания загрузите изображение на сервер");
  if (q.round === 6) {
    if (!q.panoramaFileId) issues.push("загрузите сферическую панораму");
    if (!q.location) issues.push("укажите фактические координаты съёмки");
    if (!q.license?.trim()) issues.push("укажите лицензию");
  }
  return issues;
}
export function packageIssues(pack: Pick<GamePackage, "questions">): string[] {
  const issues: string[] = [];
  if (new Set(pack.questions.map((q) => q.id)).size !== pack.questions.length)
    issues.push("В пакете повторяются задания");
  for (let round = 1; round <= 6; round++) {
    const rows = pack.questions.filter((q) => q.round === round);
    for (const q of rows)
      for (const issue of questionIssues(q))
        issues.push(`Раунд ${round}, «${q.category}»: ${issue}`);
  }
  return issues;
}
export function packageSummary(pack: GamePackage): PackageSummary {
  const { questions, ...info } = pack;
  return {
    ...info,
    questionIds: questions.map((q) => q.id),
    counts: Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((round) => [
        round,
        questions.filter((q) => q.round === round).length,
      ]),
    ),
    issues: packageIssues(pack),
  };
}

// Drafts are intentionally separate from published questions and can be incomplete.
const short = z.string().max(6000);
export const draftSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  round: z.number().int().min(1).max(6),
  category: short.optional(),
  text: short.optional(),
  answer: z.union([short, z.number()]).optional(),
  explanation: short.optional(),
  source: short.optional(),
  active: z.boolean().optional(),
  position: z.number().optional(),
  value: z.number().optional(),
  difficulty: z.number().optional(),
  alternatives: z.union([short, z.array(short)]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: short.optional(),
  numericKind: z.enum(["number", "percent"]).optional(),
  acceptedMin: z.union([short, z.number()]).optional(),
  acceptedMax: z.union([short, z.number()]).optional(),
  anchorText: short.optional(),
  anchorDate: z.union([eventDateSchema, short]).optional(),
  targetDate: z.union([eventDateSchema, short]).optional(),
  optionA: short.optional(),
  optionB: short.optional(),
  speaker: short.optional(),
  work: short.optional(),
  translated: z.boolean().optional(),
  translationNote: short.optional(),
  verified: z.boolean().optional(),
  fullImageFileId: short.optional(),
  suppliedFragment: z.boolean().optional(),
  crop: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  studySeconds: short.optional(),
  place: short.optional(),
  title: short.optional(),
  author: short.optional(),
  license: short.optional(),
  licenseUrl: short.optional(),
  panoramaFileId: short.optional(),
  location: z
    .object({ latitude: z.number(), longitude: z.number() })
    .optional(),
  camera: z
    .object({
      heading: z.number(),
      pitch: z.number(),
      zoom: z.number(),
      minZoom: z.number(),
      maxZoom: z.number(),
    })
    .optional(),
  mediaKind: z.enum(["image", "video", "youtube"]).optional(),
  fileId: short.optional(),
  url: short.optional(),
  alt: short.optional(),
  start: z.number().optional(),
  end: short.optional(),
  muted: z.boolean().optional(),
  autoplay: z.boolean().optional(),
});
export type QuestionDraft = z.infer<typeof draftSchema>;
