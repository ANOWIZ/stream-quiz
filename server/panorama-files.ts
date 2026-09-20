import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { readFile, stat, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FinalQuestion } from "../shared/content.js";
import { countryCodes } from "./final.js";
import { requireRule } from "./game.js";
export const panoramaFormats: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};
const maxPixels = 8192 * 4096;
export async function normalizePanorama(buffer: Buffer, mime: string) {
  const detected = await fileTypeFromBuffer(buffer);
  requireRule(
    detected && panoramaFormats[mime] && detected.mime === mime,
    "Панорама должна быть JPG, PNG или WebP; MIME и содержимое должны совпадать",
  );
  try {
    const input = sharp(buffer, {
      limitInputPixels: maxPixels,
      failOn: "warning",
    });
    const meta = await input.metadata();
    requireRule(
      (meta.pages ?? 1) === 1,
      "Анимированная панорама не поддерживается",
    );
    requireRule(
      meta.width &&
        meta.height &&
        meta.width >= 512 &&
        meta.width === meta.height * 2,
      "Нужна полная эквидистантная панорама 360° с пропорциями 2:1, шириной 512–8192 px",
    );
    requireRule(
      !meta.orientation || meta.orientation <= 4,
      "Сохраните панораму горизонтально с пропорциями 2:1",
    );
    // Re-encoding removes EXIF/XMP/GPS and limits GPU texture memory on mobile.
    return await input
      .rotate()
      .resize({ width: 4096, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? "Не удалось обработать панораму: " + e.message
        : "Неверное изображение панорамы",
    );
  }
}
export async function savePanoramaFile(
  db: PrismaClient,
  buffer: Buffer,
  mime: string,
  maxMB: number,
) {
  requireRule(
    buffer.length <= maxMB * 1024 * 1024,
    "Файл превышает лимит " + maxMB + " МБ",
  );
  const image = await normalizePanorama(buffer, mime);
  const id = randomUUID(),
    filename = id + ".jpg",
    path = resolve("uploads", filename);
  const originalId = randomUUID();
  const originalFilename = originalId + panoramaFormats[mime][0];
  const originalPath = resolve("uploads", originalFilename);
  await mkdir(resolve("uploads"), { recursive: true });
  try {
    await writeFile(originalPath, buffer, { flag: "wx" });
    await writeFile(path, image, { flag: "wx" });
    const file = await db.$transaction(async (tx) => {
      await tx.media.create({
        data: {
          id: originalId,
          filename: originalFilename,
          mime,
          size: buffer.length,
          originalName: "Оригинал панорамы 360°",
        },
      });
      const saved = await tx.media.create({
        data: {
          id,
          filename,
          mime: "image/jpeg",
          size: image.length,
          originalName: "Панорама 360°",
        },
      });
      await tx.setting.create({
        data: { id: "panorama-file:" + id, data: "normalized-v1" },
      });
      await tx.setting.create({
        data: { id: "panorama-original:" + id, data: originalId },
      });
      return saved;
    });
    return file;
  } catch (e) {
    await unlink(path).catch(() => {});
    await unlink(originalPath).catch(() => {});
    throw e;
  }
}
export async function validateFinalFile(
  db: PrismaClient,
  q: FinalQuestion,
  checkActive = true,
) {
  requireRule(!checkActive || q.active, "Панорама отключена");
  requireRule(countryCodes.has(q.answer), "Укажите правильную страну на карте");
  requireRule(
    q.source.trim() && q.license?.trim(),
    "Заполните источник и лицензию панорамы",
  );
  requireRule(q.panoramaFileId, "Загрузите локальный файл панорамы");
  const file = await db.media.findUnique({ where: { id: q.panoramaFileId } });
  const mark = await db.setting.findUnique({
    where: { id: "panorama-file:" + q.panoramaFileId },
  });
  requireRule(file && mark, "Загрузите файл через раздел «Финальные панорамы»");
  const path = resolve("uploads", file.filename);
  let bytes: Buffer;
  try {
    const info = await stat(path);
    requireRule(
      info.isFile() && info.size === file.size,
      "Файл панорамы изменён",
    );
    bytes = await readFile(path);
  } catch {
    throw new Error("Файл панорамы недоступен. Загрузите его заново.");
  }
  const detected = await fileTypeFromBuffer(bytes);
  requireRule(
    detected?.mime === "image/jpeg" && file.mime === "image/jpeg",
    "Неподдерживаемый формат файла панорамы",
  );
  const meta = await sharp(bytes, { limitInputPixels: maxPixels }).metadata();
  requireRule(
    meta.width &&
      meta.height &&
      meta.width === 2 * meta.height &&
      meta.width <= 4096,
    "Неверный формат 360°-панорамы",
  );
}
