import { test, expect, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import type { Ack, GameView } from "../../shared/types.js";
import { defaultConfig } from "../../shared/config.js";
import type { Question } from "../../shared/content.js";

test("имя, диапазон зачёта, личный результат и плитки всех раундов", async ({
  browser,
  page: h,
}) => {
  await h.emulateMedia({ reducedMotion: "reduce" });
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  expect(
    (
      await h.request.post("/api/login", {
        data: {
          role: "host",
          name: "Проверка результатов",
          password: credentials.host,
        },
      })
    ).ok(),
  ).toBe(true);
  let v: GameView;
  const cookie = (await h.context().cookies())
    .map((c) => c.name + "=" + c.value)
    .join("; ");
  const socket = io("http://127.0.0.1:4173", {
    auth: { role: "host" },
    extraHeaders: { Cookie: cookie },
    transports: ["websocket"],
  });
  socket.on("state", (value) => {
    v = value;
  });
  await expect.poll(() => !!v).toBe(true);
  const send = async (type: string, value?: unknown) => {
    const ack: Ack = await socket.timeout(7000).emitWithAck("command", {
      id: randomUUID(),
      revision: v.revision,
      phase: v.phase,
      roundEpoch: v.roundEpoch,
      finalAttemptId: v.finalAttemptId,
      command: { type, value, questionId: v.question?.id },
    });
    expect(ack, JSON.stringify(ack)).toMatchObject({ ok: true });
  };
  const contexts: BrowserContext[] = [];
  let qid = "";
  try {
    await send("reset", "СБРОС");
    for (const p of [...v!.players]) await send("remove", p.id);
    expect(
      (
        await h.request.post("/api/editor/settings", { data: defaultConfig })
      ).ok(),
    ).toBe(true);
    await h.goto("/host?mode=questions");
    await h.getByRole("button", { name: "Новый вопрос", exact: true }).click();
    await h.getByLabel("Категория", { exact: true }).fill("Проверка диапазона");
    await h
      .getByLabel("Текст вопроса", { exact: true })
      .fill("Сколько минут длится фильм?");
    await h.getByLabel("Максимум шкалы", { exact: true }).fill("300");
    await h.getByLabel("Единица измерения", { exact: true }).fill("минут");
    await h
      .getByLabel("Правильное числовое значение", { exact: true })
      .fill("194");
    await h.getByLabel("Засчитывать от", { exact: true }).fill("190");
    await h.getByLabel("Засчитывать до", { exact: true }).fill("198");
    await h
      .getByLabel("Пояснение после раскрытия", { exact: true })
      .fill("Длительность фильма — 194 минуты.");
    await h
      .getByLabel("Источник информации", { exact: true })
      .fill("Тестовый пример проверки диапазона");
    await h
      .getByRole("button", { name: "Сохранить вопрос", exact: true })
      .click();
    await expect(h.locator(".success")).toContainText("Вопрос опубликован");
    const editor = (await (await h.request.get("/api/editor")).json()) as {
      questions: Question[];
    };
    const q = editor.questions.find(
      (q) => q.category === "Проверка диапазона",
    )!;
    qid = q.id;
    expect(q).toMatchObject({ acceptedMin: 190, acceptedMax: 198 });
    const players = [];
    for (const [i, name] of ["Палитра 1", "Палитра 2"].entries()) {
      const context = await browser.newContext({
        viewport: i
          ? { width: 1280, height: 900 }
          : { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      contexts.push(context);
      expect(
        (
          await context.request.post("http://127.0.0.1:4173/api/login", {
            data: { role: "player", name, password: credentials.player },
          })
        ).ok(),
      ).toBe(true);
      const p = await context.newPage();
      await p.goto("/play");
      await expect(p.locator("#main")).toBeVisible();
      players.push(p);
    }
    const [a, b] = players;
    await send(
      "order",
      v!.players.map((p) => p.id),
    );
    await send("start");
    await send("begin");
    await h.goto("/host");
    await h
      .getByRole("button", { name: "Проверка диапазона", exact: true })
      .click();
    await expect(a.getByLabel("Числовой ответ", { exact: true })).toBeVisible();
    await send("pause");
    await a.getByRole("button", { name: "Изменить имя", exact: true }).click();
    await a.getByLabel("Новое имя", { exact: true }).fill("Даша");
    await a.getByRole("button", { name: "Сохранить имя", exact: true }).click();
    await expect(
      h.locator(".frame .nm").filter({ hasText: "Даша" }),
    ).toBeVisible();
    await a.reload();
    await expect(a.locator(".frame.me .nm")).toHaveText("Даша");
    await send("resume");
    await a.getByLabel("Числовой ответ", { exact: true }).fill("189");
    await a
      .getByRole("button", { name: "Зафиксировать отметку", exact: true })
      .click();
    await b.getByLabel("Положение диапазона").evaluate((el) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(el, "180");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await b
      .getByRole("button", { name: "Зафиксировать диапазон", exact: true })
      .click();
    await expect(a.locator(".personal-result")).toContainText(
      "Вы ответили неверно",
    );
    await expect(a.locator(".personal-result")).toContainText("0 очков");
    await expect(b.locator(".personal-result")).toContainText(
      "Вы ответили верно",
    );
    await expect(h.locator(".log-list")).toContainText("Палитра 2: +200 очков");
    await expect(h.locator(".log-list")).not.toContainText("отметк");
    await expect(a.locator(".correct-marker span")).toHaveCSS(
      "color",
      "rgb(46, 204, 113)",
    );
    await a.screenshot({
      path: "test-results/feedback-numeric-mobile.png",
      fullPage: true,
    });
    await h.screenshot({
      path: "test-results/feedback-numeric-host.png",
      fullPage: true,
    });
    await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
    await send("begin");
    await expect(h.locator(".category-list")).toHaveCount(0);
    await h.locator(".v2-board button:not(:disabled)").first().click();
    await expect(a.locator(".anchor-event b")).toHaveCount(0);
    const centered = await a.locator(".anchor-event strong").evaluate((el) => {
      const text = el.getBoundingClientRect();
      const title = document
        .querySelector(".question-title")!
        .getBoundingClientRect();
      return Math.abs(text.x + text.width / 2 - title.x - title.width / 2) < 2;
    });
    expect(centered).toBe(true);
    const r2 = editor.questions.find((q) => q.id === v!.question?.id)!;
    await a
      .getByRole("button", {
        name: r2.answer === "before" ? "После" : "До",
        exact: true,
      })
      .click();
    await send("reveal");
    await expect(a.locator(".personal-result")).toContainText(
      "Вы ответили неверно",
    );
    await a.screenshot({
      path: "test-results/feedback-choice-mobile.png",
      fullPage: true,
    });
    await a.setViewportSize({ width: 1440, height: 1080 });
    const positions = await a.evaluate(() => {
      const explanation = document
        .querySelector(".reveal-block")!
        .getBoundingClientRect();
      const result = document
        .querySelector(".personal-result")!
        .getBoundingClientRect();
      const camera = document
        .querySelector("#hostframe")!
        .getBoundingClientRect();
      return {
        below: result.top >= explanation.bottom,
        above: result.bottom <= camera.top,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(positions).toEqual({ below: true, above: true, overflow: false });
    await a.screenshot({
      path: "test-results/feedback-choice-desktop.png",
      fullPage: true,
    });
    await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
    await send("begin");
    await expect(h.locator(".v2-board button")).toHaveCount(v!.board.length);
    await expect(h.locator(".category-list")).toHaveCount(0);
    await h.screenshot({
      path: "test-results/feedback-round3-tiles.png",
      fullPage: true,
    });
    await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
    await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
    await send("begin");
    await expect(h.locator(".v2-board button").first()).toHaveText("Запомни 1");
    const firstTile = await h.locator(".v2-board button").nth(0).boundingBox();
    const nextRowTile = await h
      .locator(".v2-board button")
      .nth(2)
      .boundingBox();
    expect(nextRowTile!.y).toBeGreaterThanOrEqual(
      firstTile!.y + firstTile!.height + 8,
    );
    await expect(
      h.locator(".v2-board .qprice,.v2-board .theme-name"),
    ).toHaveCount(0);
    await h.screenshot({
      path: "test-results/feedback-memory-tiles.png",
      fullPage: true,
    });
  } finally {
    await send("reset", "СБРОС");
    if (qid) await h.request.delete("/api/editor/questions/" + qid);
    for (const p of [...v!.players]) await send("remove", p.id);
    socket.disconnect();
    for (const c of contexts) await c.close();
    await h.request.post("/api/logout", { data: { role: "host" } });
  }
});
