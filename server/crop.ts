import type { Router } from "express";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { unlink } from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import { cropSchema } from "../shared/content.js";
import { requireRule } from "./game.js";
import type { Store } from "./store.js";

export function registerCrop(router: Router, store: Store) {
  router.post("/crop", async (req, res) => {
    const input = z
      .object({ sourceId: z.string(), crop: cropSchema })
      .parse(req.body);
    const result = await store.serial(async () => {
      const original = await store.db.media.findUnique({
        where: { id: input.sourceId },
      });
      requireRule(
        original && original.mime.startsWith("image/"),
        "Выберите загруженное исходное изображение",
      );
      const source = sharp(resolve("uploads", original.filename), {
        limitInputPixels: 100_000_000,
      }).rotate();
      const normalized = await source.png().toBuffer();
      const { width, height } = await sharp(normalized).metadata();
      requireRule(width && height, "Не удалось прочитать размеры изображения");
      const left = Math.min(width - 1, Math.floor(input.crop.x * width));
      const top = Math.min(height - 1, Math.floor(input.crop.y * height));
      const crop = {
        left,
        top,
        width: Math.max(
          1,
          Math.min(width - left, Math.round(input.crop.width * width)),
        ),
        height: Math.max(
          1,
          Math.min(height - top, Math.round(input.crop.height * height)),
        ),
      };
      const id = randomUUID();
      const filename = id + ".png";
      const path = resolve("uploads", filename);
      const info = await sharp(normalized).extract(crop).png().toFile(path);
      try {
        const [media] = await store.db.$transaction([
          store.db.media.create({
            data: {
              id,
              filename,
              mime: "image/png",
              size: info.size,
              originalName: "Подготовленный фрагмент",
            },
          }),
          store.db.setting.create({
            data: { id: "crop-file:" + id, data: JSON.stringify(input) },
          }),
        ]);
        return media;
      } catch (error) {
        await unlink(path).catch(() => {});
        throw error;
      }
    });
    res.json(result);
  });
}
