import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { questionSchema, type FinalQuestion } from "../shared/content.js";
export function demoPanorama(): FinalQuestion {
  return questionSchema.parse({
    id: "demo-local-360",
    round: 6,
    category: "Мир",
    text: "Где это?",
    active: true,
    position: 0,
    value: 0,
    difficulty: 1,
    alternatives: [],
    title: "Kiara 1 Dawn — учебная панорама",
    place: "Долина у Кларенса, Южная Африка",
    answer: "ZA",
    panoramaFileId: "demo-local-panorama",
    author: "Greg Zaal",
    license: "CC0 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    source: "https://polyhaven.com/a/kiara_1_dawn",
    explanation:
      "Южная Африка. Панорама Kiara 1 Dawn снята у Кларенса; координаты на странице автора: −28.508926, 28.5664.",
    addedAt: "2026-09-18T00:00:00.000Z",
  }) as FinalQuestion;
}
export async function ensureLocalPanoramaDemo(
  db: PrismaClient,
  existingBank: boolean,
) {
  if (await db.setting.findUnique({ where: { id: "local-panorama-demo-v1" } }))
    return;
  const q = demoPanorama(),
    id = q.panoramaFileId!,
    filename = "demo-local-panorama.jpg";
  const image = readFileSync(resolve("assets/panoramas/kiara_1_dawn.jpg"));
  mkdirSync(resolve("uploads"), { recursive: true });
  if (!existsSync(resolve("uploads", filename)))
    writeFileSync(resolve("uploads", filename), image);
  await db.$transaction([
    db.media.upsert({
      where: { id },
      create: {
        id,
        filename,
        mime: "image/jpeg",
        size: image.length,
        originalName: "Панорама 360°",
      },
      update: {},
    }),
    db.setting.upsert({
      where: { id: "panorama-file:" + id },
      create: { id: "panorama-file:" + id, data: "normalized-v1" },
      update: {},
    }),
    ...(existingBank
      ? [
          db.question.upsert({
            where: { id: q.id },
            create: {
              id: q.id,
              round: 6,
              category: q.category,
              active: q.active,
              position: q.position,
              data: JSON.stringify(q),
            },
            update: {},
          }),
        ]
      : []),
    db.setting.create({ data: { id: "local-panorama-demo-v1", data: "true" } }),
  ]);
}
