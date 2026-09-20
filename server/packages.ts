import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  draftSchema,
  packageIssues,
  packageSchema,
  packageSummary,
  questionIssues,
  type GamePackage,
} from "../shared/packages.js";
import type { Question } from "../shared/content.js";
import { requireRule } from "./game.js";
import { validPanoramaPoint } from "./geography.js";
import { validateFinalFile } from "./panorama-files.js";
import type { Store } from "./store.js";

export function questionMediaIds(q: Question): string[] {
  return [
    q.media?.fileId,
    q.round === 4 ? q.fullImageFileId : undefined,
    q.round === 6 ? q.panoramaFileId : undefined,
  ].filter((id): id is string => !!id);
}
export async function validatePackageFiles(
  store: Store,
  pack: GamePackage,
  checkPackageStructure = true,
): Promise<string[]> {
  const issues = checkPackageStructure
    ? packageIssues(pack)
    : pack.questions.flatMap(questionIssues);
  for (const q of pack.questions) {
    for (const id of questionMediaIds(q)) {
      const row = await store.db.media.findUnique({ where: { id } });
      if (!row) {
        issues.push(`«${q.category}»: файл отсутствует`);
        continue;
      }
      try {
        await stat(resolve("uploads", row.filename));
      } catch {
        issues.push(`«${q.category}»: файл недоступен на диске`);
      }
      if ([4, 5, 6].includes(q.round) && !row.mime.startsWith("image/"))
        issues.push(`«${q.category}»: требуется изображение`);
    }
    if (
      q.round === 4 &&
      !q.suppliedFragment &&
      q.media.fileId &&
      q.fullImageFileId &&
      q.crop
    ) {
      const proof = await store.db.setting.findUnique({
        where: { id: "crop-file:" + q.media.fileId },
      });
      const crop = proof ? JSON.parse(proof.data) : null;
      if (
        !crop ||
        crop.sourceId !== q.fullImageFileId ||
        JSON.stringify(crop.crop) !== JSON.stringify(q.crop)
      )
        issues.push(
          `«${q.category}»: подготовьте фрагмент из выбранного оригинала`,
        );
    }
    if (q.round === 6) {
      if (q.location && !validPanoramaPoint(q.answer, q.location))
        issues.push(
          "Координаты панорамы не совпадают с правильной страной на карте",
        );
      if (q.panoramaFileId)
        try {
          await validateFinalFile(store.db, q, true);
        } catch (error) {
          issues.push(
            error instanceof Error ? error.message : "Панорама недоступна",
          );
        }
    }
  }
  return [...new Set(issues)];
}
export function registerPackages(router: Router, store: Store) {
  const db = store.db;
  router.get("/packages/:id", (req, res) => {
    const pack = store.packages.find((p) => p.id === req.params.id);
    requireRule(pack, "Пакет не найден");
    res.json(pack);
  });
  router.post("/packages", async (req, res) => {
    const input = z
      .object({
        id: z
          .string()
          .regex(/^[a-zA-Z0-9_-]{1,100}$/)
          .optional(),
        name: z.string().trim().min(1).max(150),
        description: z.string().max(2000).default(""),
        questionIds: z.array(z.string()),
      })
      .parse(req.body);
    const result = await store.serial(async () => {
      const old = store.packages.find((p) => p.id === input.id);
      const questions = input.questionIds.map((id) => {
        const q =
          store.bank.find((q) => q.id === id) ??
          old?.questions.find((q) => q.id === id);
        requireRule(q, "Вопрос не опубликован: " + id);
        return structuredClone(q);
      });
      requireRule(
        new Set(input.questionIds).size === questions.length,
        "Вопросы пакета не должны повторяться",
      );
      const pack = packageSchema.parse({
        ...input,
        id: input.id ?? randomUUID(),
        revision: (old?.revision ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        questions,
      });
      const data = JSON.stringify(pack);
      await db.setting.upsert({
        where: { id: "package:" + pack.id },
        create: { id: "package:" + pack.id, data },
        update: { data },
      });
      await store.refreshPackages();
      await store.mutate(
        () => "Сохранён пакет «" + pack.name + "», версия " + pack.revision,
        false,
      );
      return {
        ...packageSummary(pack),
        issues: await validatePackageFiles(store, pack),
      };
    });
    res.json(result);
  });
  router.post("/packages/:id/use", async (req, res) => {
    await store.serial(() =>
      store.mutate(() => {
        requireRule(
          store.state.phase === "lobby",
          "Выберите пакет перед началом партии",
        );
        const pack = store.packages.find((p) => p.id === req.params.id);
        requireRule(pack, "Пакет не найден");
        store.state.selectedPackageId = pack.id;
        store.state.packageSnapshot = null;
        return "Выбран пакет «" + pack.name + "»";
      }, false),
    );
    res.json({ ok: true });
  });
  router.get("/packages/:id/check", async (req, res) => {
    const pack = store.packages.find((p) => p.id === req.params.id);
    requireRule(pack, "Пакет не найден");
    res.json({
      ...packageSummary(pack),
      issues: await validatePackageFiles(store, pack),
    });
  });
  router.delete("/packages/:id", async (req, res) => {
    await store.serial(async () => {
      await db.setting.delete({ where: { id: "package:" + req.params.id } });
      await store.refreshPackages();
      await store.mutate(() => {
        if (
          store.state.phase === "lobby" &&
          store.state.selectedPackageId === req.params.id
        )
          store.state.selectedPackageId = null;
        return "Пакет удалён из библиотеки; вопросы и начатая партия сохранены";
      }, false);
    });
    res.json({ ok: true });
  });
  router.post("/drafts", async (req, res) => {
    const draft = draftSchema.parse(req.body);
    await store.serial(async () => {
      requireRule(
        store.state.question?.id !== draft.id,
        "Этот вопрос сейчас показывается игрокам",
      );
      const data = JSON.stringify(draft);
      await db.setting.upsert({
        where: { id: "question-draft:" + draft.id },
        create: { id: "question-draft:" + draft.id, data },
        update: { data },
      });
    });
    res.json({ ok: true });
  });
  router.delete("/drafts/:id", async (req, res) => {
    await db.setting.deleteMany({
      where: { id: "question-draft:" + req.params.id },
    });
    res.json({ ok: true });
  });
}
