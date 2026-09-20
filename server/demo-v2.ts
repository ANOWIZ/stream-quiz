import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { questionSchema, type Question } from "../shared/content.js";
import { packageSchema } from "../shared/packages.js";
import { demoPanorama } from "./demo-panorama.js";

// This separate teaching package is original demonstration content, not a factual question bank.
const objects = [
  [
    "Часы",
    '<circle cx="400" cy="240" r="130" fill="#efcb67"/><path d="M400 140v100l80 40" fill="none" stroke="#182134" stroke-width="18"/>',
  ],
  [
    "Карандаш",
    '<path d="M290 110h70v270l-35 70-35-70z" fill="#ffd54f" transform="rotate(-25 400 240)"/><path d="M300 380h50l-25 60z" fill="#172135" transform="rotate(-25 400 240)"/>',
  ],
  [
    "Кружка",
    '<path d="M280 130h230v260H280z" fill="#81dccc"/><path d="M510 175h85v140h-85" fill="none" stroke="#81dccc" stroke-width="30"/>',
  ],
  [
    "Зонт",
    '<path d="M200 220a200 170 0 0 1 400 0z" fill="#af9dfa"/><path d="M400 220v180q0 70-70 20" fill="none" stroke="#fff0cc" stroke-width="20"/>',
  ],
  [
    "Книга",
    '<path d="M210 130q95-50 190 0 95-50 190 0v260q-95-50-190 0-95-50-190 0z" fill="#fff0cc"/><path d="M400 130v260M250 200h100M450 200h100M250 250h100M450 250h100" stroke="#304c6b" stroke-width="10"/>',
  ],
  [
    "Фотоаппарат",
    '<rect x="220" y="160" width="360" height="240" rx="30" fill="#8bbef3"/><path d="M270 160v-50h120v50" fill="#8bbef3"/><circle cx="410" cy="275" r="82" fill="#152133"/><circle cx="410" cy="275" r="48" fill="#415e7c"/>',
  ],
  [
    "Наушники",
    '<path d="M260 300v-90a140 140 0 0 1 280 0v90" fill="none" stroke="#f5c777" stroke-width="30"/><rect x="235" y="245" width="80" height="160" rx="30" fill="#f5c777"/><rect x="485" y="245" width="80" height="160" rx="30" fill="#f5c777"/>',
  ],
  [
    "Ключ",
    '<circle cx="310" cy="180" r="80" fill="none" stroke="#e9c25d" stroke-width="30"/><path d="M368 238l160 160m-80-80 45-45m-5 85 45-45" stroke="#e9c25d" stroke-width="30"/>',
  ],
  [
    "Рюкзак",
    '<rect x="270" y="130" width="260" height="310" rx="60" fill="#e99aaa"/><path d="M345 140v-50h110v50" fill="none" stroke="#e99aaa" stroke-width="22"/><rect x="315" y="280" width="170" height="120" rx="20" fill="#96516b"/>',
  ],
  [
    "Лампа",
    '<path d="M330 100h140l70 170H260z" fill="#d9ed9a"/><path d="M400 270v160m-90 0h180" stroke="#d9ed9a" stroke-width="24"/>',
  ],
] as const;
const pairs = [
  [
    "Бортовой журнал",
    "Письмо",
    "Запас кислорода проверен. Курс на север сохранён.",
    "Капитан учебной экспедиции",
  ],
  [
    "Кино",
    "Видеоигра",
    "Нажми рычаг — и мост откроется.",
    "Персонаж учебной игры",
  ],
  [
    "Сказка",
    "Инструкция",
    "В тридевятой долине жил фонарь, который боялся темноты.",
    "Рассказчик учебной сказки",
  ],
  [
    "Радиоспектакль",
    "Дневник",
    "Дорогой дневник, сегодня я впервые увидел море.",
    "Автор учебного дневника",
  ],
  [
    "Бизнес-книга",
    "Басня",
    "Сначала запиши расходы, а потом считай прибыль.",
    "Автор учебного пособия",
  ],
  [
    "Песня",
    "Стихотворение",
    "Над окном плывёт заря, тихо дышит край двора.",
    "Лирический герой учебного стихотворения",
  ],
  [
    "Пьеса",
    "Путеводитель",
    "Я останусь здесь, пока часы не пробьют полночь!",
    "Герой учебной пьесы",
  ],
  [
    "Реклама",
    "Репортаж",
    "На площади собрались жители; открытие началось в полдень.",
    "Репортёр вымышленного города",
  ],
  [
    "Комикс",
    "Лекция",
    "Бум! Мой бумажный самолёт спас целый город!",
    "Персонаж учебного комикса",
  ],
  [
    "Подкаст",
    "Письмо из будущего",
    "Пишу тебе из завтрашнего дня: не забудь посадить дерево.",
    "Герой учебного письма",
  ],
] as const;
export async function seedV2(db: PrismaClient) {
  if (await db.setting.findUnique({ where: { id: "demo-package-v2-seeded" } }))
    return;
  await mkdir(resolve("uploads"), { recursive: true });
  const questions: Question[] = [];
  const base = {
    formatVersion: 2,
    active: true,
    value: 1000,
    position: 0,
    difficulty: 1,
    alternatives: [],
    source:
      "Авторский демонстрационный набор, 2026. Иллюстрации и учебные тексты: CC0 1.0.",
    explanation: "Авторский учебный пример для проверки механики.",
  };
  const media = async (buffer: Buffer, name: string) => {
    const id = randomUUID();
    const filename = id + ".png";
    await writeFile(resolve("uploads", filename), buffer, { flag: "wx" });
    await db.media.create({
      data: {
        id,
        filename,
        mime: "image/png",
        size: buffer.length,
        originalName: name,
      },
    });
    return id;
  };
  for (let i = 0; i < 10; i++) {
    const percent = i % 2 === 0;
    const answer = percent ? (i + 2) * 8 : (i + 3) * 12;
    questions.push(
      questionSchema.parse({
        ...base,
        id: "demo-v2-number-" + i,
        round: 1,
        category: "Учебные числа " + (i + 1),
        position: i,
        text: percent
          ? "Какой процент составляют " + answer + " жетонов из ста?"
          : "Чему равно " + (i + 3) + " × 12?",
        answer,
        min: 0,
        max: percent ? 100 : 300,
        unit: percent ? "%" : "ед.",
        numericKind: percent ? "percent" : "number",
        explanation: percent
          ? answer + " из 100 — это " + answer + "%."
          : i + 3 + " × 12 = " + answer + ".",
      }),
    );
    const earlier = i % 2 === 0;
    const anchorDate = 2000 + i * 3,
      targetDate = anchorDate + (earlier ? -2 : 2);
    questions.push(
      questionSchema.parse({
        ...base,
        id: "demo-v2-time-" + i,
        round: 2,
        position: i,
        category: "Учебная хроника " + (i + 1),
        anchorText: "Открытие станции «Сектор " + (i + 1) + "»",
        text: "Прибытие экспедиции «Маршрут " + (i + 1) + "»",
        anchorDate,
        targetDate,
        answer: earlier ? "before" : "after",
        explanation:
          "В вымышленной хронике станция открылась в " +
          anchorDate +
          ", экспедиция прибыла в " +
          targetDate +
          ". Это авторский учебный пример, не исторический факт.",
      }),
    );
    const pair = pairs[i];
    questions.push(
      questionSchema.parse({
        ...base,
        id: "demo-v2-quote-" + i,
        round: 3,
        position: i,
        category: pair[0] + " / " + pair[1],
        text: pair[2],
        options: [pair[0], pair[1]],
        answer: i % 2 === 0 ? "a" : "b",
        speaker: pair[3],
        work: "Учебные тексты, миниатюра " + (i + 1),
        verified: true,
        translated: false,
        explanation:
          "Цитата специально написана для демонстрации. Источник: «" +
          (i % 2 === 0 ? pair[0] : pair[1]) +
          "». Не приписывается реальному человеку.",
      }),
    );
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#1c293e"/>' +
      objects[i][1] +
      "</svg>";
    const full = await sharp(Buffer.from(svg)).png().toBuffer();
    const fullId = await media(full, "Оригинал учебной иллюстрации " + (i + 1));
    const crop = { x: 0.35, y: 0.24, width: 0.35, height: 0.36 };
    const fragment = await sharp(full)
      .extract({ left: 280, top: 120, width: 280, height: 180 })
      .png()
      .toBuffer();
    const fragmentId = await media(
      fragment,
      "Подготовленный фрагмент " + (i + 1),
    );
    await db.setting.create({
      data: {
        id: "crop-file:" + fragmentId,
        data: JSON.stringify({ sourceId: fullId, crop }),
      },
    });
    questions.push(
      questionSchema.parse({
        ...base,
        id: "demo-v2-fragment-" + i,
        round: 4,
        position: i,
        category: "Предмет " + (i + 1),
        text: "Какой предмет изображён на фрагменте?",
        answer: objects[i][0],
        alternatives: [objects[i][0].toLocaleLowerCase("ru")],
        fullImageFileId: fullId,
        crop,
        media: { kind: "image", fileId: fragmentId, alt: "Учебный фрагмент" },
        explanation: "Полная авторская иллюстрация: " + objects[i][0] + ".",
      }),
    );
    const count = i + 2;
    const dots = Array.from(
      { length: count },
      (_, n) =>
        '<circle cx="' +
        (70 + (n % 6) * 130) +
        '" cy="' +
        (100 + Math.floor(n / 6) * 120) +
        '" r="28" fill="#ffca59"/>',
    ).join("");
    const memory =
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#182238"/>' +
      dots +
      '<rect x="150" y="350" width="110" height="80" fill="#ab9ffa"/><path d="M530 330l70 100H460z" fill="#80dcca"/></svg>';
    const fileId = await media(
      await sharp(Buffer.from(memory)).png().toBuffer(),
      "Кадр для запоминания " + (i + 1),
    );
    questions.push(
      questionSchema.parse({
        ...base,
        id: "demo-v2-memory-" + i,
        round: 5,
        position: i,
        category: "Учебная память " + (i + 1),
        text: "Сколько жёлтых кругов было на изображении?",
        answer: String(count),
        alternatives: [String(count)],
        media: { kind: "image", fileId, alt: "Изображение для запоминания" },
        explanation:
          "На изображении ровно " +
          count +
          " жёлтых кругов. Прямоугольник и треугольник не считаются.",
      }),
    );
  }
  questions.push(
    questionSchema.parse({
      ...demoPanorama(),
      id: "demo-v2-geography",
      formatVersion: 2,
      location: { latitude: -28.508926, longitude: 28.5664 },
    }),
  );
  const pack = packageSchema.parse({
    id: "demo-v2-51",
    name: "Учебный пакет на 51 задание",
    description:
      "Отдельный редактируемый набор для проверки новых правил. Авторские примеры, иллюстрации и свободная панорама; замените учебные вопросы своими перед эфиром.",
    revision: 1,
    updatedAt: new Date().toISOString(),
    questions,
  });
  const cats = [
    ...new Map(
      questions.map((q) => [
        q.round + "|" + q.category,
        { name: q.category, round: q.round },
      ]),
    ).values(),
  ];
  await db.$transaction([
    ...questions.map((q) =>
      db.question.upsert({
        where: { id: q.id },
        create: {
          id: q.id,
          round: q.round,
          category: q.category,
          position: q.position,
          active: q.active,
          data: JSON.stringify(q),
        },
        update: {},
      }),
    ),
    ...cats.map((c) =>
      db.category.upsert({
        where: { name_round: c },
        create: { id: randomUUID(), ...c },
        update: {},
      }),
    ),
    db.setting.create({
      data: { id: "package:" + pack.id, data: JSON.stringify(pack) },
    }),
    db.setting.create({ data: { id: "demo-package-v2-seeded", data: "true" } }),
  ]);
}
