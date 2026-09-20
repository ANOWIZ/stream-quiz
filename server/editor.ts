import {
  validateFinalFile,
  savePanoramaFile,
  panoramaFormats,
} from "./panorama-files.js";
import { downloadPanorama } from "./panorama-import.js";
import { youtubeId } from "../shared/media.js";
import { Router, type Express } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { extname, resolve, join } from "node:path";
import {
  mkdir,
  rename,
  unlink,
  open,
  copyFile,
  writeFile,
  stat,
} from "node:fs/promises";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";
import { identity, cookieName } from "./auth.js";
import { requireRule } from "./game.js";
import {
  questionSchema,
  importSchema,
  type Question,
} from "../shared/content.js";
import { configSchema, roundNamesSchema } from "../shared/config.js";
import { validateBank } from "./content.js";
import { countryCodes } from "./final.js";
import type { Store } from "./store.js";
import { draftSchema, packageSummary } from "../shared/packages.js";
import {
  registerPackages,
  questionMediaIds,
  validatePackageFiles,
} from "./packages.js";
import { registerCrop } from "./crop.js";
import sharp from "sharp";
const allowed: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "video/mp4": [".mp4"],
  "video/webm": [".webm"],
};
function unlocked(store: Store, id: string) {
  requireRule(
    store.state.question?.id !== id,
    "Этот вопрос сейчас показывается игрокам. Перейдите к следующему вопросу перед редактированием.",
  );
  requireRule(
    !(
      store.state.config.rulesVersion !== 2 &&
      [4, 5].includes(store.state.round) &&
      store.state.boardIds.includes(id) &&
      !store.state.used.includes(id) &&
      store.state.phase !== "lobby"
    ),
    "Вопрос закреплён на поле текущего раунда. Измените его после завершения раунда.",
  );
}
async function validateQuestion(store: Store, q: Question) {
  if (q.formatVersion === 2) {
    const issues = await validatePackageFiles(
      store,
      {
        id: "validation",
        name: "Проверка",
        description: "",
        revision: 1,
        updatedAt: "",
        questions: [{ ...q, active: true }],
      },
      false,
    );
    requireRule(
      !issues.length,
      "Вопрос остаётся черновиком: " + issues.join("; "),
    );
  }
  if (q.round === 6 && q.panoramaFileId)
    await validateFinalFile(store.db, q, false);
  if (q.media?.fileId) {
    const file = await store.db.media.findUnique({
      where: { id: q.media.fileId },
    });
    requireRule(file, "Медиафайл не найден. Загрузите его перед сохранением.");
    requireRule(
      q.media.kind === "image"
        ? file.mime.startsWith("image/")
        : q.media.kind === "video" && file.mime.startsWith("video/"),
      "Тип медиа не соответствует содержимому выбранного файла",
    );
  }
  if (q.media?.kind === "youtube") {
    requireRule(q.media.url, "YouTube требует ссылку");
    requireRule(
      youtubeId(q.media.url),
      "Нужна действительная ссылка на видео YouTube",
    );
  }
  if (q.round === 6)
    requireRule(
      countryCodes.has(q.answer),
      "Правильная страна отсутствует на локальной карте",
    );
}
const record = (q: Question) => ({
  round: q.round,
  category: q.category,
  active: q.active,
  position: q.position,
  data: JSON.stringify(q),
});
export function registerEditor(app: Express, store: Store) {
  const router = Router();
  const db = store.db;
  router.use(async (req, res, next) => {
    const who = await identity(
      store,
      req.signedCookies[cookieName("host")],
      "host",
    );
    if (!who)
      return res
        .status(403)
        .json({ error: "Редактор доступен только ведущему" });
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/", async (_req, res) => {
    const media = await db.media.findMany({ orderBy: { createdAt: "desc" } });
    const existing = new Set<string>();
    for (const m of media) {
      try {
        await stat(resolve("uploads", m.filename));
        existing.add(m.id);
      } catch {
        /* validator reports missing */
      }
    }
    res.json({
      drafts: (
        await db.setting.findMany({
          where: { id: { startsWith: "question-draft:" } },
        })
      ).map((row) => draftSchema.parse(JSON.parse(row.data))),
      packages: store.packages.map(packageSummary),
      questions: store.bank,
      categories: await db.category.findMany({
        orderBy: [{ round: "asc" }, { name: "asc" }],
      }),
      media,
      panoramaUsage: Object.fromEntries(
        (
          await db.setting.findMany({
            where: { id: { startsWith: "panorama-used:" } },
          })
        ).map((row) => [row.id.slice(14), row.data]),
      ),
      config: store.state.config,
      used: store.state.used,
      locked: [
        store.state.question?.id,
        ...(store.state.config.rulesVersion !== 2 &&
        [4, 5].includes(store.state.round)
          ? store.state.boardIds.filter((id) => !store.state.used.includes(id))
          : []),
      ].filter(Boolean),
      warnings: validateBank(
        store.bank,
        store.state.config,
        Math.max(2, store.state.players.length),
        existing,
      ),
    });
  });
  registerPackages(router, store);
  registerCrop(router, store);
  router.post("/questions", async (req, res) => {
    const q = questionSchema.parse(req.body);
    await store.serial(async () => {
      unlocked(store, q.id);
      const previous = store.bank.find((item) => item.id === q.id);
      if (
        req.body.autoPlacement === true &&
        (!previous ||
          previous.round !== q.round ||
          previous.category !== q.category)
      ) {
        const peers = store.bank.filter(
          (item) =>
            item.id !== q.id &&
            item.round === q.round &&
            item.category === q.category,
        );
        q.position = Math.max(-1, ...peers.map((item) => item.position)) + 1;
        if (q.round === 4 || q.round === 5) {
          const values = store.state.config.boardValues;
          const counts = values.map(
            (value) => peers.filter((item) => item.value === value).length,
          );
          q.value = values[counts.indexOf(Math.min(...counts))];
        }
      }
      if (q.round === 6) {
        const old = store.bank.find((item) => item.id === q.id);
        const row = old
          ? await db.question.findUnique({ where: { id: q.id } })
          : null;
        q.addedAt =
          old?.round === 6
            ? (old.addedAt ?? row?.updatedAt.toISOString())
            : new Date().toISOString();
      }
      questionSchema.parse(q);
      await validateQuestion(store, q);
      await db.$transaction([
        db.question.upsert({
          where: { id: q.id },
          create: { id: q.id, ...record(q) },
          update: record(q),
        }),
        db.category.upsert({
          where: { name_round: { name: q.category, round: q.round } },
          create: { id: randomUUID(), name: q.category, round: q.round },
          update: {},
        }),
        db.setting.deleteMany({ where: { id: "question-draft:" + q.id } }),
      ]);
      await store.refreshBank();
      await store.mutate(() => {
        if (
          (store.state.config.rulesVersion !== 2 ||
            store.state.phase === "lobby") &&
          store.state.finalSelection?.id === q.id &&
          q.round === 6
        )
          store.state.finalSelection = q.active ? structuredClone(q) : null;
        return "Сохранён вопрос " + q.id;
      }, false);
    });
    res.json({ ok: true });
  });
  router.delete("/questions/:id", async (req, res) => {
    await store.serial(async () => {
      const id = String(req.params.id);
      unlocked(store, id);
      await db.question.delete({ where: { id } });
      await store.refreshBank();
      await store.mutate(() => {
        if (
          (store.state.config.rulesVersion !== 2 ||
            store.state.phase === "lobby") &&
          store.state.finalSelection?.id === id
        )
          store.state.finalSelection = null;
        return "Удалён вопрос " + id;
      }, false);
    });
    res.json({ ok: true });
  });
  router.post("/bulk", async (req, res) => {
    const v = z
      .object({
        ids: z.array(z.string()).min(1).max(10000),
        active: z.boolean(),
      })
      .parse(req.body);
    await store.serial(async () => {
      const qs = v.ids.map((id) => {
        unlocked(store, id);
        const q = store.bank.find((q) => q.id === id);
        requireRule(q, "Вопрос не найден");
        return questionSchema.parse({ ...q, active: v.active });
      });
      for (const q of qs) if (v.active) await validateQuestion(store, q);
      await db.$transaction(
        qs.map((q) =>
          db.question.update({ where: { id: q.id }, data: record(q) }),
        ),
      );
      await store.refreshBank();
      await store.mutate(
        () => "Массовое изменение статуса вопросов: " + qs.length,
        false,
      );
    });
    res.json({ ok: true });
  });
  router.post("/import", async (req, res) => {
    const v = importSchema.parse(req.body);
    await store.serial(async () => {
      for (const q of v.questions) {
        unlocked(store, q.id);
        await validateQuestion(store, q);
      }
      const cats = [
        ...new Map(
          v.questions.map((q) => [
            q.round + "|" + q.category,
            { round: q.round, name: q.category },
          ]),
        ).values(),
      ];
      await db.$transaction([
        ...v.questions.map((q) =>
          db.question.upsert({
            where: { id: q.id },
            create: { id: q.id, ...record(q) },
            update: record(q),
          }),
        ),
        ...cats.map((c) =>
          db.category.upsert({
            where: { name_round: c },
            create: { id: randomUUID(), ...c },
            update: {},
          }),
        ),
      ]);
      await store.refreshBank();
      await store.mutate(
        () => "Импортировано вопросов: " + v.questions.length,
        false,
      );
    });
    res.json({ ok: true, count: v.questions.length });
  });
  router.get("/export", (_req, res) => {
    res.attachment("quiz-questions.json");
    res.json({ version: 1, questions: store.bank });
  });
  router.post("/backup", async (_req, res) => {
    const name =
      new Date().toISOString().replaceAll(":", "-") +
      "-" +
      randomUUID().slice(0, 8);
    const folder = resolve("backups", name);
    await store.serial(async () => {
      await mkdir(join(folder, "uploads"), { recursive: true });
      await db.$executeRawUnsafe(
        "VACUUM INTO '" +
          join(folder, "quiz.db").replaceAll("\\", "/").replaceAll("'", "''") +
          "'",
      );
      for (const file of await db.media.findMany())
        await copyFile(
          resolve("uploads", file.filename),
          join(folder, "uploads", file.filename),
        );
      await writeFile(
        join(folder, "questions.json"),
        JSON.stringify({ version: 1, questions: store.bank }, null, 2),
      );
    });
    res.json({ ok: true, name });
  });
  router.post("/categories", async (req, res) => {
    const v = z
      .object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(100),
        round: z.number().int().min(1).max(6),
      })
      .parse(req.body);
    await store.serial(async () => {
      const other = await db.category.findMany({ where: { round: v.round } });
      requireRule(
        !other.some(
          (c) =>
            c.id !== v.id &&
            c.name.toLocaleLowerCase("ru") === v.name.toLocaleLowerCase("ru"),
        ),
        "Категория уже существует",
      );
      const old = v.id
        ? await db.category.findUnique({ where: { id: v.id } })
        : null;
      const qs = old
        ? store.bank.filter(
            (q) => q.round === old.round && q.category === old.name,
          )
        : [];
      for (const q of qs) {
        unlocked(store, q.id);
        requireRule(
          q.round === v.round,
          "Нельзя переносить непустую категорию в другой раунд",
        );
      }
      await db.$transaction([
        ...qs.map((q) =>
          db.question.update({
            where: { id: q.id },
            data: record({ ...q, category: v.name }),
          }),
        ),
        db.category.upsert({
          where: { id: v.id ?? randomUUID() },
          create: { id: v.id ?? randomUUID(), name: v.name, round: v.round },
          update: { name: v.name, round: v.round },
        }),
      ]);
      await store.refreshBank();
      await store.mutate(() => "Сохранена категория " + v.name, false);
    });
    res.json({ ok: true });
  });
  router.delete("/categories/:id", async (req, res) => {
    await store.serial(async () => {
      const id = String(req.params.id);
      const category = await db.category.findUnique({ where: { id } });
      requireRule(category, "Категория не найдена");
      requireRule(
        !store.bank.some(
          (q) => q.round === category.round && q.category === category.name,
        ),
        "Сначала перенесите или удалите вопросы этой категории",
      );
      await db.category.delete({ where: { id } });
    });
    res.json({ ok: true });
  });
  router.post("/round-names", async (req, res) => {
    const names = roundNamesSchema.parse(req.body);
    await store.serial(() =>
      store.mutate(async () => {
        store.state.config.roundNames = names;
        const data = JSON.stringify(store.state.config);
        await db.setting.upsert({
          where: { id: "main" },
          create: { id: "main", data },
          update: { data },
        });
        return "Названия раундов обновлены";
      }, false),
    );
    res.json({ ok: true });
  });
  router.post("/settings", async (req, res) => {
    const cfg = configSchema.parse(req.body);
    await store.serial(async () => {
      requireRule(
        store.state.config.rulesVersion !== 2 || cfg.rulesVersion === 2,
        "Возврат к прежней версии правил не поддерживается",
      );
      requireRule(
        store.state.phase === "lobby",
        "Изменяйте правила в лобби, чтобы сохранить условия текущей партии",
      );
      await store.mutate(async () => {
        store.state.config = cfg;
        await db.setting.upsert({
          where: { id: "main" },
          create: { id: "main", data: JSON.stringify(cfg) },
          update: { data: JSON.stringify(cfg) },
        });
        return "Настройки игры обновлены";
      }, false);
    });
    res.json({ ok: true });
  });
  router.post(
    "/panorama-upload",
    (req, res, next) => {
      const upload = multer({
        storage: multer.memoryStorage(),
        limits: {
          fileSize: store.state.config.uploads.imageMB * 1024 * 1024,
          files: 1,
        },
        fileFilter: (_req, file, cb) => {
          if (
            !panoramaFormats[file.mimetype]?.includes(
              extname(file.originalname).toLowerCase(),
            )
          )
            return cb(
              new Error(
                "Допустимы JPG, PNG, WebP; MIME и расширение должны совпадать",
              ),
            );
          cb(null, true);
        },
      }).single("file");
      upload(req, res, (error) =>
        next(
          error
            ? new Error(
                error instanceof multer.MulterError &&
                  error.code === "LIMIT_FILE_SIZE"
                  ? "Панорама превышает лимит " +
                      store.state.config.uploads.imageMB +
                      " МБ"
                  : error.message,
              )
            : undefined,
        ),
      );
    },
    async (req, res) => {
      requireRule(req.file, "Выберите файл панорамы");
      res.json(
        await savePanoramaFile(
          db,
          req.file.buffer,
          req.file.mimetype,
          store.state.config.uploads.imageMB,
        ),
      );
    },
  );
  router.post("/panorama-import", async (req, res) => {
    const url = z.string().url().max(2000).parse(req.body.url);
    const maxMB = store.state.config.uploads.imageMB;
    const result = await downloadPanorama(url, maxMB * 1024 * 1024);
    res.json(await savePanoramaFile(db, result.buffer, result.mime, maxMB));
  });
  router.post(
    "/media",
    (req, res, next) => {
      const limit =
        Math.max(
          store.state.config.uploads.imageMB,
          store.state.config.uploads.videoMB,
        ) *
        1024 *
        1024;
      const upload = multer({
        storage: multer.diskStorage({
          destination: "uploads",
          filename: (_req, _file, cb) => cb(null, randomUUID() + ".pending"),
        }),
        limits: { fileSize: limit, files: 1 },
        fileFilter: (_req, file, cb) => {
          if (
            !allowed[file.mimetype]?.includes(
              extname(file.originalname).toLowerCase(),
            )
          )
            return cb(
              new Error(
                "Допустимы JPG, PNG, WebP, GIF, MP4, WebM. MIME и расширение должны совпадать.",
              ),
            );
          cb(null, true);
        },
      }).single("file");
      upload(req, res, (err) => {
        if (err)
          return next(
            new Error(
              err instanceof multer.MulterError &&
                err.code === "LIMIT_FILE_SIZE"
                ? "Файл превышает допустимый размер"
                : err.message,
            ),
          );
        next();
      });
    },
    async (req, res) => {
      const file = req.file;
      requireRule(file, "Выберите файл");
      let disk = file.path;
      try {
        const handle = await open(file.path, "r");
        const buffer = Buffer.alloc(Math.min(file.size, 65536));
        try {
          await handle.read(buffer, 0, buffer.length, 0);
        } finally {
          await handle.close();
        }
        const detected = await fileTypeFromBuffer(buffer);
        requireRule(
          detected && detected.mime === file.mimetype,
          "Содержимое файла не соответствует MIME-типу",
        );
        const max =
          (file.mimetype.startsWith("image/")
            ? store.state.config.uploads.imageMB
            : store.state.config.uploads.videoMB) *
          1024 *
          1024;
        requireRule(
          file.size <= max,
          "Файл слишком большой. Лимит: " +
            Math.floor(max / 1024 / 1024) +
            " МБ",
        );
        const id = randomUUID();
        const filename = id + allowed[file.mimetype][0];
        let storedSize = file.size;
        if (file.mimetype.startsWith("image/")) {
          const normalized = await sharp(file.path, {
            animated: true,
            limitInputPixels: 100_000_000,
            failOn: "warning",
          })
            .rotate()
            .toBuffer();
          requireRule(
            normalized.length <=
              store.state.config.uploads.imageMB * 1024 * 1024,
            "Обработанное изображение превышает лимит размера",
          );
          await writeFile(file.path, normalized);
          storedSize = normalized.length;
        }
        disk = resolve("uploads", filename);
        await rename(file.path, disk);
        const media = await db.media.create({
          data: {
            id,
            filename,
            mime: file.mimetype,
            size: storedSize,
            originalName: file.originalname
              .normalize("NFKC")
              .replace(/[\p{Cc}\p{Cf}]/gu, "")
              .slice(0, 200),
          },
        });
        res.json(media);
      } catch (e) {
        await unlink(disk).catch(() => {});
        throw e;
      }
    },
  );
  router.delete("/media/:id", async (req, res) => {
    await store.serial(async () => {
      const id = String(req.params.id);
      const states = [store.state, ...store.history];
      const originalLink = await db.setting.findFirst({
        where: { id: { startsWith: "panorama-original:" }, data: id },
      });
      requireRule(
        !originalLink,
        "Оригинал связан с панорамой. Сначала удалите её копию для просмотра.",
      );
      const link = await db.setting.findUnique({
        where: { id: "panorama-original:" + id },
      });
      const linkedIds = link ? [id, link.data] : [id];
      const questions = [
        ...store.bank,
        ...store.packages.flatMap((p) => p.questions),
        ...states.flatMap((s) => [
          ...(s.packageSnapshot?.questions ?? []),
          ...(s.question ? [s.question] : []),
          ...(s.finalSelection ? [s.finalSelection] : []),
        ]),
      ];
      const drafts = (
        await db.setting.findMany({
          where: { id: { startsWith: "question-draft:" } },
        })
      ).map((row) => draftSchema.parse(JSON.parse(row.data)));
      requireRule(
        !questions.some((q) =>
          questionMediaIds(q).some((fileId) => linkedIds.includes(fileId)),
        ) &&
          !drafts.some((d) =>
            [d.fileId, d.fullImageFileId, d.panoramaFileId].some(
              (fileId) => fileId && linkedIds.includes(fileId),
            ),
          ),
        "Медиа используется вопросом, пакетом, черновиком или сохранённой партией. Сначала уберите ссылки на него.",
      );
      const file = await db.media.findUnique({ where: { id } });
      requireRule(file, "Файл не найден");
      const original = link
        ? await db.media.findUnique({ where: { id: link.data } })
        : null;
      await db.$transaction([
        db.media.deleteMany({
          where: { id: { in: [id, ...(original ? [original.id] : [])] } },
        }),
        db.setting.deleteMany({
          where: {
            id: { in: ["panorama-original:" + id, "panorama-file:" + id] },
          },
        }),
      ]);
      await unlink(resolve("uploads", file.filename)).catch(() => {});
      if (original)
        await unlink(resolve("uploads", original.filename)).catch(() => {});
    });
    res.json({ ok: true });
  });
  app.use("/api/editor", router);
}
