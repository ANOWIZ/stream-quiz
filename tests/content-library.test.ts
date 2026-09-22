import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  librarySchema,
  seedContentLibrary,
} from "../server/content-library.js";
import { questionMediaIds } from "../server/packages.js";

let folder: string;
let db: PrismaClient;
const directory = resolve("server/content/library");
beforeAll(async () => {
  mkdirSync(".local", { recursive: true });
  folder = mkdtempSync(resolve(".local", "library-test-"));
  const file = join(folder, "quiz.db");
  writeFileSync(file, "");
  const url = "file:" + file.replaceAll("\\", "/");
  execFileSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
    { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );
  db = new PrismaClient({ datasourceUrl: url });
}, 30000);
afterAll(async () => {
  await db?.$disconnect();
  if (folder?.startsWith(resolve(".local") + sep))
    rmSync(folder, { recursive: true, force: true });
});

it("published library contains complete media dependencies and no game data", () => {
  const bundle = librarySchema.parse(
    JSON.parse(readFileSync(join(directory, "library.json"), "utf8")),
  );
  expect(Object.keys(bundle).sort()).toEqual([
    "categories",
    "config",
    "media",
    "mediaSettings",
    "packages",
    "questions",
    "version",
  ]);
  const mediaIds = new Set(bundle.media.map((m) => m.id));
  for (const q of [
    ...bundle.questions,
    ...bundle.packages.flatMap((p) => p.questions),
  ])
    for (const id of questionMediaIds(q)) expect(mediaIds.has(id)).toBe(true);
  for (const setting of bundle.mediaSettings)
    if (setting.id.startsWith("panorama-original:"))
      expect(mediaIds.has(setting.data)).toBe(true);
  for (const file of bundle.media) {
    const bytes = readFileSync(join(directory, "media", file.filename));
    expect(bytes.length).toBe(file.size);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
  }
});

it("first install validates content, survives restart and never restores removed questions", async () => {
  const uploads = join(folder, "uploads");
  const bundle = librarySchema.parse(
    JSON.parse(readFileSync(join(directory, "library.json"), "utf8")),
  );
  // All files are validated before any content is committed.
  const invalid = join(folder, "invalid");
  mkdirSync(invalid);
  writeFileSync(
    join(invalid, "library.json"),
    JSON.stringify({ ...bundle, sessions: [{ id: "must-not-import" }] }),
  );
  await expect(seedContentLibrary(db, invalid, uploads)).rejects.toThrow();
  expect(await db.question.count()).toBe(0);
  expect(await db.game.count()).toBe(0);
  expect(await seedContentLibrary(db, directory, uploads)).toBe(true);
  const state = JSON.parse(
    (await db.game.findUniqueOrThrow({ where: { id: "main" } })).state,
  );
  expect(state).toMatchObject({
    phase: "lobby",
    players: [],
    finalSelection: null,
    selectedPackageId: bundle.packages[0].id,
  });
  expect(await db.question.count()).toBe(bundle.questions.length);
  expect(await db.session.count()).toBe(0);
  expect(await db.event.count()).toBe(0);
  const q = bundle.questions[0];
  await db.question.delete({ where: { id: q.id } });
  await db.$disconnect();
  expect(await seedContentLibrary(db, directory, uploads)).toBe(false);
  expect(await db.question.findUnique({ where: { id: q.id } })).toBeNull();
  expect(await db.media.count()).toBe(bundle.media.length);
});
