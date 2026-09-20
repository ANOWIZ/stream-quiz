import { demoPanorama, ensureLocalPanoramaDemo } from "./demo-panorama.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { questionSchema, type Question } from "../shared/content.js";
import { defaultConfig, type Config } from "../shared/config.js";
export function demoQuestions(): Question[] {
  const bank: Question[] = [];
  const base = {
    active: true,
    position: 0,
    value: 100,
    difficulty: 1,
    alternatives: [],
    explanation: "Учебный пример. Замените его своим контентом в редакторе.",
    source: "Авторский демонстрационный набор",
  };
  for (let i = 0; i < 12; i++) {
    bank.push(
      questionSchema.parse({
        ...base,
        id: "demo-number-" + i,
        round: 1,
        category: ["Считаем", "Геометрия", "Проценты"][i % 3],
        text:
          i % 3 === 0
            ? "Чему равно " + (i + 3) + " × 12?"
            : i % 3 === 1
              ? "Сколько градусов в " + (i + 1) + " прямых углах?"
              : "Сколько составляет " + (i + 1) + "% от 1000?",
        min: 0,
        max: i % 3 === 1 ? 1200 : 300,
        unit: i % 3 === 1 ? "градусов" : "",
        answer:
          i % 3 === 0
            ? (i + 3) * 12
            : i % 3 === 1
              ? (i + 1) * 90
              : (i + 1) * 10,
        position: i,
      }),
    );
    const anchor = 2000 + i;
    const target = anchor + (i % 2 ? 4 : -3);
    bank.push(
      questionSchema.parse({
        ...base,
        id: "demo-time-" + i,
        round: 2,
        category: ["Архив станции", "Экспедиция", "История города"][i % 3],
        text:
          "В учебной хронике событие «Этап " +
          (i + 1) +
          "» произошло " +
          (i % 2 ? "через четыре года после" : "за три года до") +
          " открытия станции. До или после опорного события?",
        anchorText: "Открытие станции (вымышленная хроника)",
        anchorDate: anchor,
        targetDate: target,
        answer: target < anchor ? "before" : "after",
        position: i,
      }),
    );
    bank.push(
      questionSchema.parse({
        ...base,
        id: "demo-worlds-" + i,
        round: 3,
        category: [
          "Чётное / нечётное",
          "Фигура / число",
          "Гласная / согласная",
        ][i % 3],
        text:
          i % 3 === 0
            ? String(11 + i)
            : i % 3 === 1
              ? i % 2
                ? "Треугольник"
                : "Семь"
              : i % 2
                ? "А"
                : "Б",
        options:
          i % 3 === 0
            ? ["Чётное", "Нечётное"]
            : i % 3 === 1
              ? ["Фигура", "Число"]
              : ["Гласная", "Согласная"],
        answer: i % 3 === 0 ? ((11 + i) % 2 ? "b" : "a") : i % 2 ? "a" : "b",
        position: i,
      }),
    );
  }
  for (const round of [4, 5] as const)
    for (let cat = 0; cat < 5; cat++)
      for (let level = 0; level < 3; level++) {
        const n = cat + 2 + level;
        const color = [
          "коралловый",
          "зелёный",
          "синий",
          "фиолетовый",
          "жёлтый",
        ][(cat + level) % 5];
        bank.push(
          questionSchema.parse({
            ...base,
            id: "demo-" + round + "-" + cat + "-" + level,
            round,
            category: ["Студия", "Формы", "Цвета", "Предметы", "Детали"][cat],
            position: cat * 3 + level,
            value: [100, 200, 300][level],
            text:
              round === 4
                ? [
                    "Назовите фигуру в центре фрагмента.",
                    "Как называется инструмент слева?",
                    "Какой предмет расположен справа?",
                  ][level]
                : [
                    "Сколько кругов в верхней части кадра?",
                    "Какого цвета большой круг?",
                    "Какое число написано на карточке?",
                  ][level],
            answer:
              round === 4
                ? ["Круг", "Карандаш", "Чашка"][level]
                : [String(n), color, String(17 + cat * 3 + level)][level],
            alternatives: round === 4 && level === 0 ? ["Окружность"] : [],
            media: {
              kind: "image",
              fileId:
                round === 5
                  ? "demo-memory-" + cat + "-" + level
                  : "demo-scene-" + cat,
              alt:
                round === 5
                  ? "Учебный натюрморт. Запомните расположение и детали."
                  : "Фрагмент учебного натюрморта",
              start: 0,
              muted: true,
              autoplay: false,
            },
          }),
        );
      }
  bank.push(demoPanorama());
  return bank;
}
export function validateBank(
  bank: Question[],
  _config: Config = defaultConfig,
  _playerCount = 6,
  files?: Set<string>,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const raw of bank) {
    const parsed = questionSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push(
        raw.id + ": " + parsed.error.issues.map((i) => i.message).join("; "),
      );
      continue;
    }
    const q = parsed.data;
    if (ids.has(q.id)) errors.push("Дублирующийся ID: " + q.id);
    ids.add(q.id);
    if (
      q.round === 6 &&
      q.panoramaFileId &&
      files &&
      !files.has(q.panoramaFileId)
    )
      errors.push(q.id + ": отсутствует файл панорамы");
    if (q.media?.fileId && files && !files.has(q.media.fileId))
      errors.push(q.id + ": отсутствует медиафайл " + q.media.fileId);
  }
  return errors;
}
export async function seed(db: PrismaClient) {
  const existingBank = !!(await db.setting.findUnique({
    where: { id: "seeded" },
  }));
  await ensureLocalPanoramaDemo(db, existingBank);
  if (existingBank) return;
  mkdirSync(resolve("uploads"), { recursive: true });
  for (let cat = 0; cat < 5; cat++) {
    const filename = "demo-scene-" + cat + ".svg";
    const path = resolve("uploads", filename);
    const colors = ["#ff947c", "#a9ce85", "#8bbef3", "#b09ce5", "#f1cd76"];
    const circles = Array.from(
      { length: cat + 2 },
      (_, n) =>
        '<circle cx="' + (130 + n * 110) + '" cy="110" r="24" fill="#e9e6dd"/>',
    ).join("");
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#252d38"/><path d="M0 520H1200V700H0z" fill="#151b23"/>' +
      circles +
      '<circle cx="570" cy="350" r="138" fill="' +
      colors[cat] +
      '"/><rect x="220" y="240" width="38" height="280" rx="8" transform="rotate(24 240 380)" fill="#e3c581"/><path d="M228 514l18 45 17-45" fill="#eee7d6"/><path d="M850 345h135v155H850zM985 365h50v90h-50" fill="#ddd9d2" stroke="#ddd9d2" stroke-width="18" stroke-linejoin="round"/><rect x="440" y="550" width="300" height="105" rx="4" fill="#f4ecdb"/><text x="590" y="625" fill="#242b35" font-size="66" text-anchor="middle" font-family="Arial">' +
      (17 + cat) +
      "</text></svg>";
    if (!existsSync(path)) writeFileSync(path, svg);
    await db.media.upsert({
      where: { id: "demo-scene-" + cat },
      create: {
        id: "demo-scene-" + cat,
        filename,
        mime: "image/svg+xml",
        size: Buffer.byteLength(svg),
        originalName: "Учебный натюрморт " + (cat + 1),
      },
      update: {},
    });
  }

  for (let cat = 0; cat < 5; cat++)
    for (let level = 0; level < 3; level++) {
      const id = "demo-memory-" + cat + "-" + level;
      const filename = id + ".svg";
      const path = resolve("uploads", filename);
      const palette = ["#ff947c", "#a9ce85", "#8bbef3", "#b09ce5", "#f1cd76"];
      const dots = Array.from(
        { length: cat + 2 + level },
        (_, i) =>
          '<circle cx="' +
          (110 + i * 110) +
          '" cy="110" r="22" fill="#e9e6dd"/>',
      ).join("");
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700" viewBox="0 0 1200 700"><rect width="1200" height="700" fill="#29333d"/><path d="M0 520H1200V700H0z" fill="#1a222b"/>' +
        dots +
        '<circle cx="' +
        (470 + level * 85) +
        '" cy="350" r="125" fill="' +
        palette[(cat + level) % 5] +
        '"/><rect x="160" y="280" width="60" height="240" rx="8" fill="#e3c581"/><path d="M830 350h135v150H830zM965 370h50v85h-50" fill="#dad6ca" stroke="#dad6ca" stroke-width="15"/><rect x="400" y="550" width="360" height="110" fill="#f5ecdb"/><text x="580" y="630" font-family="Arial" font-size="66" fill="#242b35" text-anchor="middle">' +
        (17 + cat * 3 + level) +
        "</text></svg>";
      if (!existsSync(path)) writeFileSync(path, svg);
      await db.media.create({
        data: {
          id,
          filename,
          mime: "image/svg+xml",
          size: Buffer.byteLength(svg),
          originalName: "Кадр для памяти " + (cat * 3 + level + 1),
        },
      });
    }

  const mark = await db.setting.findUnique({ where: { id: "seeded" } });
  if (!mark) {
    await db.$transaction([
      ...demoQuestions().map((q) =>
        db.question.create({
          data: {
            id: q.id,
            round: q.round,
            category: q.category,
            position: q.position,
            active: q.active,
            data: JSON.stringify(q),
          },
        }),
      ),
      db.setting.create({ data: { id: "seeded", data: "true" } }),
    ]);
    const qs = demoQuestions();
    const cats = [...new Set(qs.map((q) => q.round + "|" + q.category))];
    for (const c of cats) {
      const [r, name] = c.split("|");
      await db.category.upsert({
        where: { name_round: { name, round: Number(r) } },
        create: {
          id: "category-" + r + "-" + cats.indexOf(c),
          name,
          round: Number(r),
        },
        update: {},
      });
    }
  }
}
