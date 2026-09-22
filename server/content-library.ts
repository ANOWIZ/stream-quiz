import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { configSchema } from "../shared/config.js";
import { questionSchema } from "../shared/content.js";
import { packageSchema } from "../shared/packages.js";
import { initialState } from "./game.js";
import { questionMediaIds } from "./packages.js";

const libraryDirectory = resolve("server/content/library");
const safeName = z
  .string()
  .regex(/^[a-zA-Z0-9_.-]+$/)
  .refine((s) => s !== "." && s !== "..");
export const librarySchema = z
  .object({
    version: z.literal(1),
    config: configSchema,
    questions: z.array(questionSchema),
    packages: z.array(packageSchema),
    categories: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        round: z.number().int().min(1).max(6),
      }),
    ),
    media: z.array(
      z.object({
        id: safeName,
        filename: safeName,
        mime: z.string(),
        size: z.number().int().nonnegative(),
        originalName: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    ),
    mediaSettings: z.array(
      z.object({
        id: z
          .string()
          .regex(
            /^(panorama-file|panorama-original|crop-file):[a-zA-Z0-9_-]+$/,
          ),
        data: z.string().max(6000),
      }),
    ),
  })
  .strict();
const digest = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

// Export only published content and its dependencies; never game/session/event
// tables, drafts, credentials, saved commands or historical settings.
export async function exportContentLibrary(
  db: PrismaClient,
  directory = libraryDirectory,
) {
  const [rows, packageRows, categories, configRow, mediaRows, settings] =
    await db.$transaction([
      db.question.findMany({ orderBy: { position: "asc" } }),
      db.setting.findMany({ where: { id: { startsWith: "package:" } } }),
      db.category.findMany(),
      db.setting.findUniqueOrThrow({ where: { id: "main" } }),
      db.media.findMany(),
      db.setting.findMany({
        where: {
          OR: ["crop-file:", "panorama-file:", "panorama-original:"].map(
            (startsWith) => ({ id: { startsWith } }),
          ),
        },
      }),
    ]);
  const questions = rows.map((row) =>
    questionSchema.parse(JSON.parse(row.data)),
  );
  const packages = packageRows.map((row) =>
    packageSchema.parse(JSON.parse(row.data)),
  );
  const ids = new Set(
    [...questions, ...packages.flatMap((p) => p.questions)].flatMap(
      questionMediaIds,
    ),
  );
  for (const setting of settings)
    if (
      setting.id.startsWith("panorama-original:") &&
      ids.has(setting.id.slice("panorama-original:".length))
    )
      ids.add(setting.data);
  const mediaSettings = settings.filter((s) =>
    ids.has(s.id.slice(s.id.indexOf(":") + 1)),
  );
  await mkdir(resolve(directory, "media"), { recursive: true });
  const media = [];
  for (const id of ids) {
    const row = mediaRows.find((m) => m.id === id);
    if (!row) throw Error("Library media missing: " + id);
    safeName.parse(row.filename);
    const data = await readFile(resolve("uploads", row.filename));
    if (data.length !== row.size)
      throw Error("Library media size mismatch: " + id);
    media.push({
      id,
      filename: row.filename,
      mime: row.mime,
      size: row.size,
      originalName: basename(row.originalName),
      sha256: digest(data),
    });
    await writeFile(resolve(directory, "media", row.filename), data);
  }
  const bundle = librarySchema.parse({
    version: 1,
    questions,
    packages,
    categories,
    config: JSON.parse(configRow.data),
    media,
    mediaSettings,
  });
  await writeFile(
    resolve(directory, "library.json"),
    JSON.stringify(bundle, null, 2) + "\n",
  );
  return {
    questions: questions.length,
    packages: packages.length,
    media: media.length,
  };
}

// A bundle is a first-install seed, never a restore operation over a live game.
export async function seedContentLibrary(
  db: PrismaClient,
  directory = libraryDirectory,
  uploadDirectory = resolve("uploads"),
) {
  const counts = await db.$transaction([
    db.game.count(),
    db.question.count(),
    db.media.count(),
    db.setting.count(),
    db.category.count(),
    db.session.count(),
    db.event.count(),
  ]);
  if (counts.some(Boolean)) return false;
  let text: string;
  try {
    text = await readFile(resolve(directory, "library.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const bundle = librarySchema.parse(JSON.parse(text));
  for (const file of bundle.media) {
    const bytes = await readFile(resolve(directory, "media", file.filename));
    if (bytes.length !== file.size || digest(bytes) !== file.sha256)
      throw Error("Library media checksum mismatch: " + file.id);
  }
  await mkdir(uploadDirectory, { recursive: true });
  for (const file of bundle.media) {
    const target = resolve(uploadDirectory, file.filename);
    try {
      await copyFile(
        resolve(directory, "media", file.filename),
        target,
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST" ||
        digest(await readFile(target)) !== file.sha256
      )
        throw error;
    }
  }
  const state = initialState(bundle.config);
  state.selectedPackageId = bundle.packages[0]?.id ?? null;
  await db.$transaction([
    ...bundle.media.map(({ sha256: _checksum, ...data }) =>
      db.media.create({ data }),
    ),
    ...bundle.questions.map((q) =>
      db.question.create({
        data: {
          id: q.id,
          round: q.round,
          category: q.category,
          active: q.active,
          position: q.position,
          data: JSON.stringify(q),
        },
      }),
    ),
    ...bundle.categories.map((data) => db.category.create({ data })),
    ...bundle.packages.map((p) =>
      db.setting.create({
        data: { id: "package:" + p.id, data: JSON.stringify(p) },
      }),
    ),
    ...bundle.mediaSettings.map((data) => db.setting.create({ data })),
    ...[
      "seeded",
      "demo-package-v2-seeded",
      "local-panorama-demo-v1",
      "local-panorama-provider-v1",
      "display-names-unbranded-v1",
      "display-names-unbranded-v2",
      "round-one-docx1-named-tiles-v1",
      "imported-fragments-user-only-v1",
      "player-palette-v2",
      "published-library-v1",
    ].map((id) => db.setting.create({ data: { id, data: "true" } })),
    db.setting.create({
      data: { id: "main", data: JSON.stringify(bundle.config) },
    }),
    db.game.create({
      data: { id: "main", state: JSON.stringify(state), history: "[]" },
    }),
  ]);
  return true;
}
