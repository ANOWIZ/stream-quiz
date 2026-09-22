import sharp from "sharp";
import type { EditorData } from "../../shared/editor-types.js";
import {
  test,
  expect,
  request,
  type Browser,
  type Page,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { geoEqualEarth } from "d3-geo";
import { upgradeConfig } from "../../shared/config.js";
import type { GameView, Ack } from "../../shared/types.js";
import type { GamePackage } from "../../shared/packages.js";
const base = "http://127.0.0.1:4173";
test.describe.configure({ mode: "serial" });
let api: APIRequestContext;
let socket: Socket;
let view: GameView;
const contexts: BrowserContext[] = [];
async function wait(check: () => boolean) {
  const end = Date.now() + 15000;
  while (!check()) {
    if (Date.now() > end) throw Error("Состояние не обновилось");
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function send(type: string, value?: unknown) {
  const response: Ack = await socket.timeout(7000).emitWithAck("command", {
    id: randomUUID(),
    revision: view.revision,
    phase: view.phase,
    finalAttemptId: view.finalAttemptId,
    roundEpoch: view.roundEpoch,
    decisionToken: view.decisionToken,
    undoDecisionToken: view.undoDecisionToken,
    buzzWinner: view.buzzWinner,
    command: { type, value, questionId: view.question?.id },
  });
  expect(response, JSON.stringify(response)).toMatchObject({ ok: true });
}
async function pageFor(
  browser: Browser,
  storage: Awaited<ReturnType<APIRequestContext["storageState"]>>,
  host = false,
  mobile = false,
) {
  const context = await browser.newContext({
    storageState: storage,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1920, height: 1080 },
    reducedMotion: "reduce",
  });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(host ? "/host" : "/play");
  await expect(page.locator("#main")).toBeVisible();
  return page;
}
test.beforeEach(async () => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  api = await request.newContext({ baseURL: base });
  expect(
    (
      await api.post("/api/login", {
        data: {
          role: "host",
          name: "Ведущий новых правил",
          password: credentials.host,
        },
      })
    ).ok(),
  ).toBe(true);
  const cookie = (await api.storageState()).cookies
    .map((c) => c.name + "=" + c.value)
    .join("; ");
  socket = io(base, {
    auth: { role: "host" },
    extraHeaders: { Cookie: cookie },
    transports: ["websocket"],
  });
  view = undefined as unknown as GameView;
  socket.on("state", (v) => {
    view = v;
  });
  await wait(() => !!view);
  await send("reset", "СБРОС");
  for (const p of [...view.players]) await send("remove", p.id);
  expect(
    (await api.post("/api/editor/settings", { data: upgradeConfig() })).ok(),
  ).toBe(true);
  await wait(() => view.config.rulesVersion === 2);
});
test.afterEach(async () => {
  socket?.disconnect();
  for (const c of contexts) await c.close();
  contexts.length = 0;
  await api.post("/api/logout", { data: { role: "host" } });
  await api.dispose();
});
async function expire() {
  const response = await api.post("/api-test/expire", {
    headers: {
      "x-test-secret": readFileSync(".local/e2e/clock-secret.txt", "utf8"),
    },
  });
  expect(response.ok()).toBe(true);
}
test("свободное количество вопросов: редактор без предупреждений и раунд из двух заданий", async ({
  browser,
}) => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  for (const name of ["Свободный размер 1", "Свободный размер 2"]) {
    const p = await request.newContext({ baseURL: base });
    expect(
      (
        await p.post("/api/login", {
          data: { role: "player", name, password: credentials.player },
        })
      ).ok(),
    ).toBe(true);
    await p.dispose();
  }
  const data: EditorData = await (await api.get("/api/editor")).json();
  const questions = data.questions
    .filter((q) => q.round === 2 && q.active && q.formatVersion === 2)
    .slice(0, 2);
  expect(questions).toHaveLength(2);
  const id = "flexible-count-" + randomUUID();
  const saved = await api.post("/api/editor/packages", {
    data: {
      id,
      name: "Два вопроса для эфира",
      questionIds: questions.map((q) => q.id),
    },
  });
  expect(saved.ok()).toBe(true);
  expect((await saved.json()).issues).toEqual([]);
  expect(
    (await api.post(`/api/editor/packages/${id}/use`, { data: {} })).ok(),
  ).toBe(true);
  await wait(() => view.selectedPackage?.id === id);
  const h = await pageFor(browser, await api.storageState(), true);
  await h.getByRole("button", { name: "Вопросы", exact: true }).click();
  await expect(h.getByLabel("Поиск вопросов")).toBeVisible();
  await expect(h.getByText(/Проверка банка|нужно .* вопросов/)).toHaveCount(0);
  await h.screenshot({
    path: "test-results/question-bank-no-warnings.png",
    fullPage: true,
  });
  await h.getByRole("button", { name: "Игра", exact: true }).click();
  await h.getByRole("button", { name: "Начать игру", exact: true }).click();
  await expect(
    h.getByRole("button", { name: "Пропустить пустой раунд", exact: true }),
  ).toBeVisible();
  await h
    .getByRole("button", { name: "Пропустить пустой раунд", exact: true })
    .click();
  await expect(h.locator("#main")).toHaveAttribute("data-round", "2");
  expect(view.total).toBe(2);
  await h.getByRole("button", { name: "Начать раунд", exact: true }).click();
  await expect(h.locator(".board .cell")).toHaveCount(2);
  await h.reload();
  await expect(h.locator(".board .cell")).toHaveCount(2);
  await h.screenshot({
    path: "test-results/two-questions-round.png",
    fullPage: true,
  });
  for (let n = 0; n < 2; n++) {
    await h.locator(".board .cell:not(:disabled)").first().click();
    await expect(h.locator("#main")).toHaveAttribute("data-phase", "answering");
    await h
      .getByRole("button", { name: "Показать ответ", exact: true })
      .click();
    await expect(h.getByRole("dialog")).toHaveCount(0);
    await expect(h.locator("#main")).toHaveAttribute("data-phase", "reveal");
    await h
      .getByRole("button", { name: "Следующий вопрос", exact: true })
      .click();
  }
  await expect(h.locator("#main")).toHaveAttribute("data-round", "3");
  for (const round of [4, 5, 6]) {
    await h
      .getByRole("button", { name: "Пропустить пустой раунд", exact: true })
      .click();
    await expect(h.locator("#main")).toHaveAttribute(
      "data-round",
      String(round),
    );
  }
  await expect(
    h.getByRole("link", { name: "Выбрать панораму", exact: true }),
  ).toBeVisible();
  await expect(
    h.getByRole("button", { name: "Начать раунд", exact: true }),
  ).toBeDisabled();
  expect(view.question).toBeNull();
});
async function clickCountry(
  page: Page,
  code: string,
  longitude: number,
  latitude: number,
  selectable = true,
) {
  await expect(
    page.locator('[data-country="' + code + '"]').first(),
  ).toBeVisible();
  const projection = geoEqualEarth().fitExtent(
    [
      [12, 12],
      [948, 486],
    ],
    { type: "Sphere" },
  );
  const pixel = projection([longitude, latitude])!;
  const point = await page.locator(".map-svg > g").evaluate((group, pixel) => {
    const point = new DOMPoint(pixel[0], pixel[1]).matrixTransform(
      (group as SVGGElement).getScreenCTM()!,
    );
    return { x: point.x, y: point.y };
  }, pixel);
  await page.mouse.click(point.x, point.y);
  if (selectable)
    await expect(
      page.locator('[data-country="' + code + '"]').first(),
    ).toHaveAttribute("aria-pressed", "true");
  return point;
}
test("кнопки предыдущего раунда и новой партии сохраняют состав и работают после финала", async ({
  browser,
}) => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  let playerStorage:
    Awaited<ReturnType<APIRequestContext["storageState"]>> | undefined;
  for (const name of ["Алиса повтора", "Борис повтора"]) {
    const p = await request.newContext({ baseURL: base });
    expect(
      (
        await p.post("/api/login", {
          data: { role: "player", name, password: credentials.player },
        })
      ).ok(),
    ).toBe(true);
    playerStorage ??= await p.storageState();
    await p.dispose();
  }
  await wait(() => view.players.length === 2);
  expect(
    (await api.post("/api/editor/packages/demo-v2-51/use", { data: {} })).ok(),
  ).toBe(true);
  await wait(() => view.selectedPackage?.id === "demo-v2-51");
  await send("selectFinal", "demo-v2-geography");
  const h = await pageFor(browser, await api.storageState(), true);
  const a = await pageFor(browser, playerStorage!);
  const label = "Начать игру заново тем же составом";
  await expect(h.getByRole("button", { name: label, exact: true })).toHaveCount(
    0,
  );
  await send("start");
  await wait(() => view.phase === "intro");
  const ids = view.players.map((p) => p.id);
  const order = [...view.order];
  await send("score", {
    playerId: ids[0],
    amount: 1000,
    reason: "Перед новой партией",
  });
  await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  await send("pause");
  await expect(h.locator("#main")).toHaveAttribute("data-round", "2");
  await expect(a.getByRole("button", { name: label, exact: true })).toHaveCount(
    0,
  );

  const previous = h.getByRole("button", {
    name: "Предыдущий раунд",
    exact: true,
  });
  await expect(previous).toBeEnabled();
  await expect(
    a.getByRole("button", { name: "Предыдущий раунд", exact: true }),
  ).toHaveCount(0);
  await previous.click();
  const dialog = h.locator(".game-dialog-overlay");
  await expect(dialog).toContainText("текущего и предыдущего раундов");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(view.round).toBe(2);
  await previous.click();
  await dialog
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await expect(h.locator("#main")).toHaveAttribute("data-round", "1");
  await expect(a.locator("#main")).toHaveAttribute("data-phase", "intro");
  expect(view.players[0].score).toBe(1000);
  expect(view.players.map((p) => p.id)).toEqual(ids);
  expect(view.paused).toBe(false);
  await expect(previous).toHaveCount(0);
  await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  await send("pause");
  await h.reload();
  await expect(previous).toBeEnabled();
  const answers = h.getByRole("group", { name: "Ответы ведущего" });
  await expect(answers.getByRole("button")).toHaveCount(3);
  for (const button of await answers.getByRole("button").all()) {
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  }
  await expect(
    h
      .locator("#controls")
      .getByRole("button", { name: /^(Верно|Неверно|Показать ответ)$/ }),
  ).toHaveCount(0);
  await previous.scrollIntoViewIfNeeded();
  await h.screenshot({
    path: "test-results/previous-round-button.png",
    fullPage: true,
  });

  await h.getByRole("button", { name: label, exact: true }).click();
  await h
    .locator(".game-dialog-overlay")
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  expect(view.round).toBe(2);
  expect(view.players[0].score).toBe(1000);

  await h.getByRole("button", { name: label, exact: true }).click();
  await h
    .locator(".game-dialog-overlay")
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await expect(h.locator("#main")).toHaveAttribute("data-round", "1");
  await expect(a.locator("#main")).toHaveAttribute("data-phase", "intro");
  expect(view.players.map((p) => p.id)).toEqual(ids);
  expect(view.players.map((p) => p.score)).toEqual([0, 0]);
  expect(view.order).toEqual(order);
  expect(view.paused).toBe(false);
  await a.reload();
  await expect(a.locator('[data-player-id="' + ids[0] + '"].me')).toBeVisible();
  for (let round = 1; round < 6; round++)
    await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  await send("begin");
  await send("beginLocation", "ЗАВЕРШИТЬ СТАВКИ");
  await wait(() => view.panoramaReady.host === true);
  await send("startLocation", "ПРОДОЛЖИТЬ БЕЗ НЕГОТОВЫХ");
  await expire();
  await wait(() => view.phase === "awaitingReveal");
  await send("reveal");
  await expect(h.locator("#main")).toHaveAttribute("data-phase", "finished");
  await expect(previous).toBeEnabled();
  await expect(
    h.getByRole("button", { name: label, exact: true }),
  ).toBeVisible();
  await h.screenshot({
    path: "test-results/restart-game-button.png",
    fullPage: true,
  });

  await h.getByRole("button", { name: label, exact: true }).click();
  await h
    .locator(".game-dialog-overlay")
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await expect(h.locator("#main")).toHaveAttribute("data-round", "1");
  await expect(a.locator("#main")).toHaveAttribute("data-phase", "intro");
  expect(view.players.map((p) => p.id)).toEqual(ids);
  expect(view.finalSelection?.id).toBe("demo-v2-geography");
});

test("диапазон редактора попадает в игру, раскрытие ответа без лишнего подтверждения", async ({
  browser,
}) => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  const data: EditorData = await (await api.get("/api/editor")).json();
  const source = data.questions.find((q) => q.round === 1)!;
  const q = {
    ...source,
    id: randomUUID(),
    category: "Проверка допуска",
    text: "Проверка диапазона 151",
    min: 0,
    max: 300,
    answer: 151,
    unit: "видов",
    numericKind: "number",
    acceptedMin: undefined,
    acceptedMax: undefined,
    active: true,
  };
  expect((await api.post("/api/editor/questions", { data: q })).ok()).toBe(
    true,
  );
  const packId = randomUUID();
  expect(
    (
      await api.post("/api/editor/packages", {
        data: { id: packId, name: "Проверка диапазона", questionIds: [q.id] },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await api.post(`/api/editor/packages/${packId}/use`, { data: {} })).ok(),
  ).toBe(true);
  const h = await pageFor(browser, await api.storageState(), true);
  await h.getByRole("button", { name: "Вопросы", exact: true }).click();
  await h.getByRole("button", { name: q.text, exact: true }).click();
  await h.getByLabel("Засчитывать от", { exact: true }).fill("145");
  await h.getByLabel("Засчитывать до", { exact: true }).fill("155");
  await h.getByLabel("Пояснение после раскрытия", { exact: true }).fill("");
  await h
    .getByRole("button", { name: "Сохранить вопрос", exact: true })
    .click();
  await expect(h.locator(".success")).toContainText("Вопрос опубликован");
  const saved: EditorData = await (await api.get("/api/editor")).json();
  expect(saved.questions.find((row) => row.id === q.id)?.explanation).toBe("");
  const p = await request.newContext({ baseURL: base });
  expect(
    (
      await p.post("/api/login", {
        data: {
          role: "player",
          name: "Проверка шкалы",
          password: credentials.player,
        },
      })
    ).ok(),
  ).toBe(true);
  const a = await pageFor(browser, await p.storageState());
  await p.dispose();
  await h.getByRole("button", { name: "Игра", exact: true }).click();
  await h.getByRole("button", { name: "Начать игру", exact: true }).click();
  await h.getByRole("button", { name: "Начать раунд", exact: true }).click();
  await h.locator(".v2-board button").first().click();
  const slider = a.getByRole("slider", { name: "Точная отметка", exact: true });
  await expect(slider).toBeVisible();
  const label = (await slider.locator(".circle-value").boundingBox())!;
  const box = (await slider.boundingBox())!;
  await a.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
  await a.mouse.down();
  await a.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, {
    steps: 12,
  });
  expect(Number(await slider.getAttribute("aria-valuenow"))).toBeGreaterThan(
    200,
  );
  await a.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 12 });
  await a.mouse.up();
  expect(await a.evaluate(() => getSelection()?.toString() ?? "")).toBe("");
  await expect(slider).toBeFocused();
  await slider.press("Home");
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "1");
  await a.getByLabel("Числовой ответ", { exact: true }).fill("144");
  await a.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(h.locator("#main")).toHaveAttribute("data-phase", "comparison");
  await h.getByRole("button", { name: "Показать ответ", exact: true }).click();
  await expect(h.locator(".game-dialog-overlay")).toHaveCount(0);
  await expect(a.locator(".comparison-actions")).toContainText(
    "Засчитывается: 145–155 видов",
  );
  await expect(a.locator(".personal-result")).toContainText(
    "Вы ответили неверно",
  );
  await expect(a.locator(".frame.me .sc")).toHaveText("0");
  await a.screenshot({
    path: "test-results/scale-published-range.png",
    fullPage: true,
  });
});

for (const count of [2, 6])
  test(
    "новая полная партия: " +
      count +
      " игроков, 51 задание, секреты и география",
    async ({ browser }) => {
      test.setTimeout(300000);
      const credentials = JSON.parse(
        readFileSync(".local/e2e/credentials.json", "utf8"),
      );
      const players: Page[] = [];
      const h = await pageFor(browser, await api.storageState(), true);
      for (let i = 0; i < count; i++) {
        const p = await request.newContext({ baseURL: base });
        expect(
          (
            await p.post("/api/login", {
              data: {
                role: "player",
                name: "Участник " + (i + 1),
                password: credentials.player,
              },
            })
          ).ok(),
        ).toBe(true);
        players.push(
          await pageFor(
            browser,
            await p.storageState(),
            false,
            count === 2 && i === 0,
          ),
        );
        await p.dispose();
      }
      await wait(() => view.players.length === count);
      expect(view.finalSelection).toBeNull();
      if (view.selectedPackage && !view.selectedPackage.issues.length)
        await expect(
          h.getByRole("button", { name: "Начать игру", exact: true }),
        ).toBeEnabled();
      else
        await expect(
          h.getByRole("button", { name: "Начать игру", exact: true }),
        ).toBeDisabled();
      await h.getByRole("button", { name: "Пакеты", exact: true }).click();
      const card = h
        .locator(".package-editor article.theme")
        .filter({ hasText: "учебный пакет" });
      await card
        .getByRole("button", { name: "Проверить пакет", exact: true })
        .click();
      await expect(h.locator(".validation-warnings")).toContainText("готово");
      await card
        .getByRole("button", { name: "Выбрать для партии", exact: true })
        .click();
      await card
        .getByRole("button", {
          name: "Использовать панораму пакета в финале",
          exact: true,
        })
        .click();
      await wait(() => !!view.finalSelection);
      await h.getByRole("button", { name: "Игра", exact: true }).click();
      const pack = (await (
        await api.get("/api/editor/packages/demo-v2-51")
      ).json()) as GamePackage;
      await h.getByRole("button", { name: "Начать игру", exact: true }).click();
      await wait(() => view.phase === "intro");
      const order = [...view.order];
      const byId = new Map(view.players.map((p, i) => [p.id, players[i]]));
      const obs = await h.context().newPage();
      await obs.goto("/obs");
      await expect(
        obs.locator("#controls,.host-nav,.answer-panel"),
      ).toHaveCount(0);
      let questionNumber = 0;
      for (let round = 1; round <= 5; round++) {
        await expect(h.locator("#main")).toHaveAttribute("data-phase", "intro");
        await expect(h.locator(".round-scoreboard")).toBeVisible();
        await h
          .getByRole("button", { name: "Начать раунд", exact: true })
          .click();
        for (let n = 0; n < 10; n++) {
          await expect(h.locator("#main")).toHaveAttribute(
            "data-phase",
            "choosing",
          );
          await expect(h.locator(".v2-board button")).toHaveCount(10);
          if (round === 1) {
            await expect(h.locator(".memory-tiles")).toHaveCount(0);
            await expect(h.locator(".scene-title")).toHaveText(
              "Выберите категорию",
            );
            await expect(h.locator(".v2-board button").nth(n)).toHaveText(
              pack.questions.filter((q) => q.round === 1)[n].category,
            );
            await expect(
              h.locator(".category-list,.categories-board"),
            ).toHaveCount(0);
            await expect(h.locator("#app")).not.toContainText("СТОН");
          }
          expect(view.activePlayerId).toBe(order[questionNumber % count]);
          const index = view.board.findIndex((q) => !q.used);
          const q = pack.questions.filter((q) => q.round === round)[index];
          if (round === 5) {
            await expect(h.locator(".v2-board")).not.toContainText(
              "Учебная память",
            );
            await expect(h.locator(".v2-board img")).toHaveCount(0);
          }
          await h.locator(".v2-board button:not(:disabled)").first().click();
          await wait(() => view.phase !== "choosing");
          if (round === 1) {
            const active = byId.get(view.activePlayerId!)!;
            if (n < 2 && q.round === 1) {
              const slider = active.getByRole("slider", {
                name: "Точная отметка",
                exact: true,
              });
              await slider.scrollIntoViewIfNeeded();
              const label = (await slider
                .locator(".circle-value")
                .boundingBox())!;
              const box = (await slider.boundingBox())!;
              await active.mouse.move(
                label.x + label.width / 2,
                label.y + label.height / 2,
              );
              await active.mouse.down();
              await active.mouse.move(
                box.x + box.width * 0.9,
                box.y + box.height * 0.5,
                { steps: 12 },
              );
              await expect(slider).toBeFocused();
              expect(
                Number(await slider.getAttribute("aria-valuenow")),
              ).toBeGreaterThan((q.min + q.max) / 2);
              await active.mouse.move(box.x + box.width / 2, box.y - 40, {
                steps: 12,
              });
              await active.mouse.up();
              expect(
                await active.evaluate(() => getSelection()?.toString() ?? ""),
              ).toBe("");
              await slider.press("Home");
              await expect(slider).toHaveAttribute(
                "aria-valuenow",
                String(q.min),
              );
              await slider.press("ArrowRight");
              await expect(slider).toHaveAttribute(
                "aria-valuenow",
                String(q.min + 1),
              );
            }
            await active
              .getByLabel("Числовой ответ", { exact: true })
              .fill(String(q.answer));
            await expect(
              active.getByRole("slider", {
                name: "Точная отметка",
                exact: true,
              }),
            ).toBeVisible();
            await active
              .getByRole("button", { name: "Подтвердить", exact: true })
              .click();
            for (const [id, page] of byId)
              if (id !== view.activePlayerId) {
                await page
                  .getByRole("button", { name: "Больше", exact: true })
                  .click();
                expect(view.answers[id]).toBeUndefined();
                await page
                  .getByRole("button", { name: "Столько же", exact: true })
                  .click();
                await page
                  .getByRole("button", { name: "Подтвердить", exact: true })
                  .click();
              }
          } else if (round === 2 || round === 3) {
            if (round === 2)
              await expect(h.locator(".anchor-event b")).toHaveCount(0);
            for (const page of players) {
              await page
                .locator(".choice-buttons button")
                .nth(q.answer === "before" || q.answer === "a" ? 0 : 1)
                .click();
              await page
                .getByRole("button", { name: "Подтвердить", exact: true })
                .click();
            }
          } else {
            if (round === 5) {
              expect(view.question?.text).toBeUndefined();
              expect(view.timer.deadline! - view.serverNow).toBeGreaterThan(
                25000,
              );
              expect(view.timer.deadline! - view.serverNow).toBeLessThanOrEqual(
                30000,
              );
              await expect(players[0].locator("#main img")).toHaveCount(1);
              await players[0].keyboard.press("Space");
              expect(view.phase).toBe("studying");
              await expire();
              await expect(players[0].locator("#main img")).toHaveCount(0);
            }
            if (n === 0) {
              await Promise.all(
                players.map(async (page) => {
                  await page
                    .locator("body")
                    .click({ position: { x: 3, y: 3 } });
                  await page.keyboard.press("Space");
                }),
              );
              await wait(() => view.phase === "judging");
              expect(view.buzzes.filter((b) => b.accepted)).toHaveLength(1);
              const answerControls = h.getByRole("group", {
                name: "Ответы ведущего",
              });
              await expect(answerControls.getByRole("button")).toHaveCount(3);
              const controlsBox = (await answerControls.boundingBox())!;
              const cameraBox = (await h
                .locator("#hostframe .frame.host")
                .boundingBox())!;
              const stageBox = (await h.locator("#main").boundingBox())!;
              expect(controlsBox.y).toBeGreaterThanOrEqual(
                stageBox.y + stageBox.height,
              );
              expect(controlsBox.x + controlsBox.width).toBeLessThanOrEqual(
                cameraBox.x,
              );
              expect(
                Math.abs(
                  cameraBox.x +
                    cameraBox.width / 2 -
                    stageBox.x -
                    stageBox.width / 2,
                ),
              ).toBeLessThan(1);
              await h.screenshot({
                path: `test-results/host-answers-round-${round}.png`,
              });
              await h
                .getByRole("button", { name: "Чистый экран", exact: true })
                .click();
              await expect(answerControls).toHaveCount(0);
              await h.locator(".game-toolbar").hover();
              await h
                .getByRole("button", { name: "Вернуть панель", exact: true })
                .click();
              await h.setViewportSize({ width: 390, height: 844 });
              for (const label of ["Верно", "Неверно", "Показать ответ"])
                await expect(
                  answerControls.getByRole("button", {
                    name: label,
                    exact: true,
                  }),
                ).toBeVisible();
              expect(
                await h.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth,
                ),
              ).toBe(true);
              await h.screenshot({
                path: `test-results/host-answers-mobile-round-${round}.png`,
                fullPage: true,
              });
              await h.setViewportSize({ width: 1920, height: 1080 });
              for (const page of [...players, obs])
                await expect(page.locator(".host-answer-controls")).toHaveCount(
                  0,
                );
              const wrong = view.buzzWinner!;
              await h
                .getByRole("button", { name: "Неверно", exact: true })
                .click();
              await wait(() => view.phase === "buzzing");
              await expect(byId.get(wrong)!.locator("#buzzbtn")).toBeDisabled();
              if (round === 5)
                await expect(players[0].locator("#main img")).toHaveCount(0);
              const next = byId.get(
                view.players.find((p) => p.id !== wrong)!.id,
              )!;
              await next.locator("#buzzbtn").click();
            } else await players[0].locator("#buzzbtn").click();
            await expect(
              h.getByRole("button", { name: "Верно", exact: true }),
            ).toBeVisible();
            await h.getByRole("button", { name: "Верно", exact: true }).click();
          }
          await expect(h.locator("#main")).toHaveAttribute(
            "data-phase",
            "reveal",
          );
          if (n === 0) {
            await h.screenshot({
              path: "test-results/v2-" + count + "-round-" + round + ".png",
              fullPage: true,
            });
            if (round === 1 && count === 2)
              await players[0].screenshot({
                path: "test-results/v2-mobile-number.png",
                fullPage: true,
              });
          }
          if (round === 2 && n === 0) {
            await players[0].reload();
            await expect(players[0].locator("#main")).toHaveAttribute(
              "data-phase",
              "reveal",
            );
          }
          questionNumber++;
          await h
            .getByRole("button", { name: "Следующий вопрос", exact: true })
            .click();
        }
      }
      await expect(h.locator("#main")).toHaveAttribute("data-round", "6");
      await h
        .getByRole("button", { name: "Начать раунд", exact: true })
        .click();
      await wait(() => view.phase === "betting");
      expect(view.question?.panorama).toBeUndefined();
      expect(view.question?.location).toBeUndefined();
      const before = view.players.map((p) => p.score);
      for (const page of players) {
        await expect(page.locator(".bet-area")).not.toContainText(
          "положительного счёта",
        );
        const input = page.getByLabel("Ставка", { exact: true });
        await input.fill("0");
        await input.press("End");
        await input.press("Backspace");
        await expect(input).toHaveValue("");
        await input.pressSequentially("6");
        await expect(input).toHaveValue("6");
        await page
          .getByLabel("Ставка", { exact: true })
          .fill(count === 6 && page === players[0] ? "0" : "1000");
        await page
          .getByRole("button", { name: "Подтвердить ставку", exact: true })
          .click();
      }
      await wait(() => view.phase === "locating");
      expect(view.timer.deadline! - view.serverNow).toBeGreaterThan(55000);
      expect(view.timer.deadline! - view.serverNow).toBeLessThanOrEqual(60000);
      expect(view.bets).toEqual({});
      expect(view.countries).toEqual({});
      const panorama = players[0].getByLabel("Панорама 360 градусов", {
        exact: true,
      });
      await expect(panorama).toHaveAttribute("aria-busy", "false");
      await panorama.focus();
      await players[0].keyboard.press("ArrowRight");
      await players[0].keyboard.press("+");
      const heading = await panorama.getAttribute("data-heading"),
        zoom = await panorama.getAttribute("data-zoom");
      let chosenLongitude = "";
      for (let i = 0; i < count; i++) {
        const page = players[i];
        await page
          .getByRole("button", { name: "Выбрать страну", exact: true })
          .click();
        await clickCountry(
          page,
          i === 1 ? "LS" : count === 6 && i === 0 ? "RU" : "ZA",
          i === 1 ? 28 : count === 6 && i === 0 ? 37.62 : 20,
          i === 1 ? -29.5 : count === 6 && i === 0 ? 55.75 : -30,
        );
        if (i === 0) {
          chosenLongitude = (await page
            .locator('[data-pin="Ваш выбор"]')
            .getAttribute("data-longitude"))!;
          expect(
            Math.abs(Number(chosenLongitude) - (count === 6 ? 37.62 : 20)),
          ).toBeLessThan(1);
          await page
            .getByRole("button", { name: "Вернуться к панораме", exact: true })
            .last()
            .click();
          await expect(panorama).toHaveAttribute("data-heading", heading!);
          await expect(panorama).toHaveAttribute("data-zoom", zoom!);
          await page
            .getByRole("button", { name: "Выбрать страну", exact: true })
            .click();
          await expect(
            page.locator(
              '[data-country="' + (count === 6 ? "RU" : "ZA") + '"]',
            ),
          ).toHaveAttribute("aria-pressed", "true");
        }
        if (i < count - 1 || count === 6)
          await page
            .getByRole("button", { name: "Подтвердить страну", exact: true })
            .click();
        else {
          await page
            .getByRole("button", { name: "Вернуться к панораме", exact: true })
            .last()
            .click();
          await expire();
        }
      }
      await expect(h.locator("#main")).toHaveAttribute(
        "data-phase",
        "awaitingReveal",
      );
      expect(view.countries).toEqual({});
      expect(view.bets).toEqual({});
      expect(view.question?.answer).toBeUndefined();
      await expect(players[0].locator(".answer-status")).toContainText(
        "ведущий",
      );
      await expect(h.locator(".final-results")).toHaveCount(0);
      await players[0].reload();
      await expect(players[0].locator("#main")).toHaveAttribute(
        "data-phase",
        "awaitingReveal",
      );
      await expect(players[0].locator(".panorama canvas")).toBeVisible();
      await expect(players[0].getByRole("alert")).toHaveCount(0);
      await h
        .getByRole("button", { name: "Показать ответы", exact: true })
        .click();
      await expect(h.locator("#main")).toHaveAttribute(
        "data-phase",
        "finished",
      );
      expect(view.players[0].score).toBe(before[0] + (count === 6 ? 0 : 1000));
      if (count === 6) {
        const zeroBet = h.locator(
          '[data-result-player="' + view.players[0].id + '"]',
        );
        await expect(zeroBet).toHaveAttribute("data-correct", "false");
        await expect(zeroBet).toContainText("Россия");
        await expect(zeroBet).toContainText("Неверно");
        await expect(zeroBet).toContainText("Ставка 0");
      }
      expect(view.players[1].score).toBe(before[1] - 1000);
      const podium = h.locator(".podium");
      await expect(podium.locator(".pod")).toHaveCount(Math.min(3, count));
      const ranking = [...view.players].sort((a, b) => b.score - a.score);
      for (let i = 0; i < Math.min(3, count); i++)
        await expect(
          podium.locator('[data-place="' + (i + 1) + '"]'),
        ).toContainText(ranking[i].name);
      const map = h.locator(".final-results .world-map");
      const mapBox = (await map.boundingBox())!,
        podiumBox = (await podium.boundingBox())!;
      expect(mapBox.y + mapBox.height).toBeLessThan(podiumBox.y);
      expect(
        Math.abs(
          mapBox.x + mapBox.width / 2 - (podiumBox.x + podiumBox.width / 2),
        ),
      ).toBeLessThan(2);
      await expect(
        map.locator('[data-country][role="button"],[data-country][tabindex]'),
      ).toHaveCount(0);
      const country = map.locator('[data-country="ZA"]');
      const fill = await country.evaluate((e) => getComputedStyle(e).fill);
      const pixel = geoEqualEarth().fitExtent(
        [
          [12, 12],
          [948, 486],
        ],
        { type: "Sphere" },
      )([20, -30])!;
      const hover = await map.locator(".map-svg > g").evaluate((g, xy) => {
        const point = new DOMPoint(xy[0], xy[1]).matrixTransform(
          (g as SVGGElement).getScreenCTM()!,
        );
        return { x: point.x, y: point.y };
      }, pixel);
      await h.mouse.move(hover.x, hover.y);
      await expect
        .poll(() => country.evaluate((e) => e.matches(":hover")))
        .toBe(true);
      expect(await country.evaluate((e) => getComputedStyle(e).fill)).toBe(
        fill,
      );
      await h.mouse.click(hover.x, hover.y);
      await expect(country).not.toHaveAttribute("aria-pressed");
      await expect(h.locator('[data-pin="✓ Место съёмки"]')).toHaveAttribute(
        "data-latitude",
        "-28.508926",
      );
      await expect(h.locator('[data-pin="Участник 1"]')).toHaveAttribute(
        "data-longitude",
        chosenLongitude,
      );
      const labelsFit = await h
        .locator(".final-results .map-svg")
        .evaluate((svg) => {
          const area = svg.getBoundingClientRect();
          return [...svg.querySelectorAll(".map-pin-label")].every((label) => {
            const box = label.getBoundingClientRect();
            return (
              box.left >= area.left &&
              box.right <= area.right &&
              box.top >= area.top &&
              box.bottom <= area.bottom
            );
          });
        });
      expect(labelsFit).toBe(true);
      await h.screenshot({
        path: "test-results/v2-" + count + "-final.png",
        fullPage: true,
      });
      if (count === 2)
        await players[0].screenshot({
          path: "test-results/mobile-final.png",
          fullPage: true,
        });
    },
  );

test("редактор v2: серверный черновик, отдельный фрагмент и предпросмотр", async ({
  browser,
}) => {
  const h = await pageFor(browser, await api.storageState(), true);
  await h.getByRole("button", { name: "Вопросы", exact: true }).click();
  await h.getByRole("button", { name: "Новый вопрос", exact: true }).click();
  await h.getByLabel("Раунд", { exact: true }).selectOption("4");
  await h.getByLabel("Категория", { exact: true }).fill("Тест кадрирования");
  await h
    .getByLabel("Текст вопроса", { exact: true })
    .fill("Что изображено в центре?");
  await h
    .getByLabel("Правильный голосовой ответ", { exact: true })
    .fill("Круг");
  await h
    .getByLabel("Пояснение после раскрытия", { exact: true })
    .fill("В центре нарисован жёлтый круг.");
  await h
    .getByLabel("Источник информации", { exact: true })
    .fill("Собственная иллюстрация теста, CC0");
  await expect
    .poll(async () => {
      const data = (await (await api.get("/api/editor")).json()) as EditorData;
      return data.drafts.some((d) => d.text === "Что изображено в центре?");
    })
    .toBe(true);
  expect(
    (
      (await (await api.get("/api/editor")).json()) as EditorData
    ).questions.some((q) => q.text === "Что изображено в центре?"),
  ).toBe(false);
  await h.close();
  const editor = await pageFor(browser, await api.storageState(), true);
  await editor.getByRole("button", { name: "Вопросы", exact: true }).click();
  await editor.locator(".draft-list summary").click();
  await editor
    .locator(".draft-list button")
    .filter({ hasText: "Что изображено в центре?" })
    .click();
  await expect(
    editor.getByLabel("Правильный голосовой ответ", { exact: true }),
  ).toHaveValue("Круг");
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#213044"/><circle cx="400" cy="250" r="150" fill="#ffd83d"/></svg>';
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  await editor
    .getByLabel("Загрузить оригинал", { exact: true })
    .setInputFiles({ name: "circle.png", mimeType: "image/png", buffer });
  await expect(
    editor.getByAltText("Полное изображение для кадрирования", { exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Подготовить фрагмент", exact: true })
    .click();
  await expect(
    editor.getByAltText("Фрагмент, который увидят игроки", { exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("button", { name: "Предпросмотр", exact: true })
    .click();
  await expect(editor.locator(".content-preview img").first()).toBeVisible();
  await editor.locator(".content-preview summary").click();
  await expect(editor.locator(".content-preview img")).toHaveCount(2);
  await editor.screenshot({
    path: "test-results/v2-editor-fragment.png",
    fullPage: true,
  });
  await editor
    .getByRole("button", { name: "Сохранить вопрос", exact: true })
    .click();
  await expect(editor.locator(".success")).toContainText("Вопрос опубликован");
  const data = (await (await api.get("/api/editor")).json()) as EditorData;
  const q = data.questions.find((q) => q.text === "Что изображено в центре?")!;
  expect(q.round).toBe(4);
  expect(data.drafts.some((d) => d.id === q.id)).toBe(false);
  if (q.round !== 4) throw Error("Неверный тип вопроса");
  expect(q.media.fileId).not.toBe(q.fullImageFileId);
});

test("старт с нулём и одним игроком, чистый журнал каждой партии", async ({
  browser,
}) => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  const h = await pageFor(browser, await api.storageState(), true);
  expect(
    (await api.post("/api/editor/packages/demo-v2-51/use", { data: {} })).ok(),
  ).toBe(true);
  await wait(() => view.selectedPackage?.id === "demo-v2-51");
  const startButton = h.getByRole("button", {
    name: "Начать игру",
    exact: true,
  });
  await expect(h.locator(".lobby-sub")).not.toContainText("минимум");
  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(h.locator("#main")).toHaveAttribute("data-phase", "intro");
  expect(view.players).toEqual([]);
  expect(view.events).toEqual([]);
  await send("begin");
  await send("choose", view.board[0].id);
  await expect(h.locator("#main")).toHaveAttribute(
    "data-phase",
    "awaitingReveal",
  );
  await send("reveal", "ЗАВЕРШИТЬ ОЖИДАНИЕ");
  await expect(h.locator("#main")).toHaveAttribute("data-phase", "reveal");
  await send("endGame", "ЗАВЕРШИТЬ ИГРУ");
  const playerApi = await request.newContext({ baseURL: base });
  expect(
    (
      await playerApi.post("/api/login", {
        data: {
          role: "player",
          name: "Один игрок",
          password: credentials.player,
        },
      })
    ).ok(),
  ).toBe(true);
  const player = await pageFor(
    browser,
    await playerApi.storageState(),
    false,
    true,
  );
  await playerApi.dispose();
  await wait(() => view.players.length === 1);
  expect(view.players[0].ready).toBe(false);
  const score = async (amount: number) =>
    send("score", {
      playerId: view.players[0].id,
      amount,
      reason: "Проверка нового журнала",
    });
  await score(1000);
  await expect(h.locator(".log-row")).toHaveCount(1);
  await expect(startButton).toBeEnabled();
  await startButton.click();
  await expect(h.locator("#main")).toHaveAttribute("data-phase", "intro");
  await expect(player.locator("#main")).toHaveAttribute("data-phase", "intro");
  await expect(h.locator(".log-row")).toHaveCount(0);
  await score(1000);
  await score(-1700);
  await expect(h.locator(".log-row")).toHaveCount(2);
  await h
    .getByRole("button", {
      name: "Начать игру заново тем же составом",
      exact: true,
    })
    .click();
  await h
    .locator(".game-dialog-overlay")
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await expect(h.locator(".log-row")).toHaveCount(0);
  expect(view.players[0].score).toBe(0);
  await h.reload();
  await expect(h.locator("#main")).toHaveAttribute("data-phase", "intro");
  await expect(h.locator(".log-row")).toHaveCount(0);
  await score(25);
  await expect(h.locator(".log-row")).toHaveText(["Один игрок: +25 очков"]);
  await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  await expect(h.locator(".log-row")).toHaveText(["Один игрок: +25 очков"]);
  await send("endGame", "ЗАВЕРШИТЬ ИГРУ");
  await expect(h.locator("#main")).toHaveAttribute("data-phase", "lobby");
  await expect(h.locator(".log-row")).toHaveCount(0);
  await expect(startButton).toBeEnabled();
  await h.screenshot({
    path: "test-results/empty-lobby-clean-log.png",
    fullPage: true,
  });
});

test("завершить игру: пустое лобби, отключение игроков и новый вход теми же именами", async ({
  browser,
}) => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  const h = await pageFor(browser, await api.storageState(), true);
  const finish = h.getByRole("button", { name: "Завершить игру", exact: true });
  await expect(finish).toBeDisabled();
  const players: Page[] = [];
  const names = ["Повторный вход А", "Повторный вход Б"];
  for (const [index, name] of names.entries()) {
    const playerApi = await request.newContext({ baseURL: base });
    expect(
      (
        await playerApi.post("/api/login", {
          data: { role: "player", name, password: credentials.player },
        })
      ).ok(),
    ).toBe(true);
    players.push(
      await pageFor(
        browser,
        await playerApi.storageState(),
        false,
        index === 1,
      ),
    );
    await playerApi.dispose();
  }
  await wait(() => view.players.length === 2);
  const oldIds = view.players.map((p) => p.id);
  expect(
    (await api.post("/api/editor/packages/demo-v2-51/use", { data: {} })).ok(),
  ).toBe(true);
  await wait(() => view.selectedPackage?.id === "demo-v2-51");
  await send("start");
  await send("score", {
    playerId: oldIds[0],
    amount: 777,
    reason: "Перед завершением",
  });
  await send("pause");
  for (const page of players)
    await expect(
      page.getByRole("button", { name: "Завершить игру", exact: true }),
    ).toHaveCount(0);
  await finish.click();
  const dialog = h.getByRole("dialog", {
    name: "Завершить игру?",
    exact: true,
  });
  await expect(dialog).toContainText("Все игроки будут отключены");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(view.players.map((p) => p.id)).toEqual(oldIds);
  expect(view.players[0].score).toBe(777);
  expect(view.phase).toBe("intro");
  await players[1].context().setOffline(true);
  await wait(() => !view.players.find((p) => p.id === oldIds[1])?.connected);
  await finish.click();
  await dialog
    .getByRole("button", { name: "Завершить игру", exact: true })
    .click();
  await expect(h.locator("#main")).toHaveAttribute("data-phase", "lobby");
  expect(view.players).toEqual([]);
  expect(view.joinOpen).toBe(true);
  await expect(
    players[0].getByRole("form", { name: "Вход игрока" }),
  ).toBeVisible();
  await players[1].context().setOffline(false);
  await expect(
    players[1].getByRole("form", { name: "Вход игрока" }),
  ).toBeVisible({ timeout: 15000 });
  await h.reload();
  await expect(h.locator("#main")).toHaveAttribute("data-phase", "lobby");
  await expect(finish).toBeDisabled();
  await h.screenshot({
    path: "test-results/end-game-host-lobby.png",
    fullPage: true,
  });
  await players[1].screenshot({
    path: "test-results/end-game-player-login.png",
    fullPage: true,
  });
  for (const [index, page] of players.entries()) {
    await page.reload();
    await page.getByLabel("Имя", { exact: true }).fill(names[index]);
    await page.getByLabel("Пароль", { exact: true }).fill(credentials.player);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page.locator("#main")).toHaveAttribute("data-phase", "lobby");
  }
  await wait(() => view.players.length === 2);
  expect(view.players.map((p) => p.score)).toEqual([0, 0]);
  expect(view.players.every((p) => !oldIds.includes(p.id))).toBe(true);
  await h.getByRole("button", { name: "Начать игру", exact: true }).click();
  for (const page of [h, ...players])
    await expect(page.locator("#main")).toHaveAttribute("data-phase", "intro");
});

test("финал: пауза не мешает игрокам, ведущий заменяет остаток таймера", async ({
  browser,
}) => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  const h = await pageFor(browser, await api.storageState(), true);
  const players: Page[] = [];
  for (const [index, name] of ["Пауза компьютер", "Пауза телефон"].entries()) {
    const apiPlayer = await request.newContext({ baseURL: base });
    expect(
      (
        await apiPlayer.post("/api/login", {
          data: { role: "player", name, password: credentials.player },
        })
      ).ok(),
    ).toBe(true);
    players.push(
      await pageFor(
        browser,
        await apiPlayer.storageState(),
        false,
        index === 1,
      ),
    );
    await apiPlayer.dispose();
  }
  expect(
    (await api.post("/api/editor/packages/demo-v2-51/use", { data: {} })).ok(),
  ).toBe(true);
  await wait(() => view.selectedPackage?.id === "demo-v2-51");
  await send("selectFinal", "demo-v2-geography");
  await send("start");
  for (let round = 1; round < 6; round++)
    await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  await send("begin");
  await h.getByRole("button", { name: "Пауза", exact: true }).click();
  await wait(() => view.paused);
  for (const player of players) {
    await player.getByLabel("Ставка", { exact: true }).fill("0");
    await player
      .getByRole("button", { name: "Подтвердить ставку", exact: true })
      .click();
  }
  await wait(() => view.phase === "locating");
  expect(view.paused).toBe(true);
  expect(view.timer).toEqual({ deadline: null, remaining: 60000 });
  for (const page of [h, ...players])
    await expect(page.getByRole("timer")).toContainText("1:00");
  const [a, b] = players;
  const panorama = a.getByLabel("Панорама 360 градусов", { exact: true });
  await expect(panorama).toHaveAttribute("aria-busy", "false");
  const heading = await panorama.getAttribute("data-heading");
  await panorama.focus();
  await a.keyboard.press("ArrowRight");
  await expect(panorama).not.toHaveAttribute("data-heading", heading!);

  async function editTimer(seconds: string) {
    await h
      .getByRole("button", { name: "Изменить таймер", exact: true })
      .click();
    const dialog = h.getByRole("dialog", {
      name: "Изменить таймер",
      exact: true,
    });
    const input = dialog.getByRole("spinbutton", {
      name: "Оставшееся время, секунды",
    });
    await expect(input).not.toHaveAttribute("max");
    await input.fill(seconds);
    await dialog
      .getByRole("button", { name: "Установить время", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
  }
  await editTimer("20");
  await wait(() => view.timer.remaining === 20000);
  await h.getByRole("button", { name: "Изменить таймер", exact: true }).click();
  const dialog = h.getByRole("dialog", {
    name: "Изменить таймер",
    exact: true,
  });
  await expect(dialog.getByRole("spinbutton")).toHaveValue("20");
  await dialog.getByRole("spinbutton").fill("40");
  await dialog
    .getByRole("button", { name: "Установить время", exact: true })
    .click();
  await wait(() => view.timer.remaining === 40000);
  for (const page of [h, ...players])
    await expect(page.getByRole("timer")).toContainText("0:40");

  await a.getByRole("button", { name: "Выбрать страну", exact: true }).click();
  await clickCountry(a, "ZA", 25, -30);
  await expect(
    a.getByRole("button", { name: "Подтвердить страну", exact: true }),
  ).toBeEnabled();
  await a
    .getByRole("button", { name: "Подтвердить страну", exact: true })
    .click();
  await expect(a.locator(".answer-status")).toContainText(
    "Страна подтверждена",
  );
  expect(view.countries).toEqual({});
  expect(view.timer).toEqual({ deadline: null, remaining: 40000 });

  await b.getByRole("button", { name: "Выбрать страну", exact: true }).click();
  await b
    .getByRole("button", { name: "Открыть карту на весь экран", exact: true })
    .click();
  const full = b.getByRole("dialog", {
    name: "Карта на весь экран",
    exact: true,
  });
  await expect(
    full.getByText("Таймер на паузе. Можно выбирать и подтверждать страну."),
  ).toBeVisible();
  await full.locator('[data-country="RU"]').press("Enter");
  await expect(full.locator('[data-country="RU"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    full.getByRole("button", { name: "Подтвердить страну", exact: true }),
  ).toBeEnabled();
  await b.screenshot({ path: "test-results/final-paused-mobile-map.png" });
  const pauseBox = await full.locator(".map-pause-status").boundingBox();
  const mapBox = await full.locator(".map-viewport").boundingBox();
  const actionBox = await full.locator(".map-dialog-actions").boundingBox();
  expect(pauseBox!.y).toBeGreaterThanOrEqual(mapBox!.y + mapBox!.height);
  expect(actionBox!.y).toBeGreaterThanOrEqual(pauseBox!.y + pauseBox!.height);

  await h.getByRole("button", { name: "Продолжить", exact: true }).click();
  await wait(() => !view.paused && view.timer.deadline !== null);
  expect(view.timer.deadline! - view.serverNow).toBeLessThanOrEqual(40000);
  expect(view.timer.deadline! - view.serverNow).toBeGreaterThan(37000);
  await editTimer("125");
  await wait(() => view.timer.deadline! - view.serverNow > 120000);
  for (const page of [h, a]) {
    await expect
      .poll(async () =>
        (await page.getByRole("timer").innerText())
          .split(":")
          .reduce((seconds, part) => seconds * 60 + Number(part), 0),
      )
      .toBeGreaterThan(120);
  }
  await h.getByRole("button", { name: "Пауза", exact: true }).click();
  await wait(() => view.paused);
  await h.screenshot({
    path: "test-results/final-host-timer.png",
    fullPage: true,
  });
  await full
    .getByRole("button", { name: "Подтвердить страну", exact: true })
    .click();
  await wait(() => view.phase === "awaitingReveal");
  expect(view.question?.answer).toBeUndefined();
  expect(view.countries).toEqual({});
  expect(view.timer).toEqual({ deadline: null, remaining: null });
  await expect(h.locator(".final-results")).toHaveCount(0);
  await h.getByRole("button", { name: "Продолжить", exact: true }).click();
  await h.getByRole("button", { name: "Показать ответы", exact: true }).click();
  await wait(() => view.phase === "finished");
});

test("карта: весь экран, масштаб, жесты и ставка всем счётом", async ({
  browser,
}) => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  const h = await pageFor(browser, await api.storageState(), true);
  const pages: Page[] = [];
  for (const [index, name] of ["Карта компьютер", "Карта телефон"].entries()) {
    const p = await request.newContext({ baseURL: base });
    expect(
      (
        await p.post("/api/login", {
          data: { role: "player", name, password: credentials.player },
        })
      ).ok(),
    ).toBe(true);
    if (index === 0) pages.push(await pageFor(browser, await p.storageState()));
    else {
      const context = await browser.newContext({
        storageState: await p.storageState(),
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      });
      contexts.push(context);
      const page = await context.newPage();
      await page.goto("/play");
      pages.push(page);
    }
    await p.dispose();
  }
  const [a, b] = pages;
  await wait(() => view.players.length === 2);
  expect(
    (await api.post("/api/editor/packages/demo-v2-51/use", { data: {} })).ok(),
  ).toBe(true);
  await wait(() => view.selectedPackage?.id === "demo-v2-51");
  await send("selectFinal", "demo-v2-geography");
  await send("start");
  for (const p of view.players)
    await send("score", {
      playerId: p.id,
      amount: 1100,
      reason: "Проверка полной ставки",
    });
  for (let round = 1; round < 6; round++)
    await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  await send("begin");
  for (const p of pages) {
    const bet = p.getByRole("spinbutton", { name: "Ставка", exact: true });
    await expect(bet).toHaveAttribute("max", "1100");
    await bet.fill("1101");
    await expect(
      p.getByRole("button", { name: "Подтвердить ставку", exact: true }),
    ).toBeDisabled();
    await bet.fill("1100");
    await p
      .getByRole("button", { name: "Подтвердить ставку", exact: true })
      .click();
  }
  await wait(() => view.phase === "locating");
  await a.getByRole("button", { name: "Выбрать страну", exact: true }).click();
  const map = a.locator(".map-svg");
  await a.getByRole("button", { name: "Увеличить карту", exact: true }).click();
  await expect(map).toHaveAttribute("data-zoom", "1.5");
  const box = (await map.boundingBox())!;
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.mouse.wheel(0, -200);
  await expect
    .poll(async () => Number(await map.getAttribute("data-zoom")))
    .toBeGreaterThan(2);
  const beforeDrag = await map.locator(":scope > g").getAttribute("transform");
  await a.mouse.down();
  await a.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 - 20, {
    steps: 8,
  });
  await a.mouse.up();
  await expect(map.locator(":scope > g")).not.toHaveAttribute(
    "transform",
    beforeDrag!,
  );
  await expect(a.locator('[data-country][aria-pressed="true"]')).toHaveCount(0);
  await clickCountry(a, "ZA", 25, -30);
  const zoom = await map.getAttribute("data-zoom");
  await a
    .getByRole("button", { name: "Открыть карту на весь экран", exact: true })
    .click();
  const full = a.getByRole("dialog", {
    name: "Карта на весь экран",
    exact: true,
  });
  await expect(full).toBeVisible();
  await expect(full.locator(".map-svg")).toHaveAttribute("data-zoom", zoom!);
  expect(
    (await full.locator(".map-svg").boundingBox())!.height,
  ).toBeGreaterThan(650);
  await expect(full.locator('[data-country="ZA"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await a.screenshot({ path: "test-results/map-answer-fullscreen.png" });
  await a.keyboard.press("Escape");
  await expect(full).toHaveCount(0);
  await expect(
    a.getByRole("dialog", { name: "Выбор страны", exact: true }),
  ).toBeVisible();
  await expect(
    a.getByRole("button", { name: "Открыть карту на весь экран", exact: true }),
  ).toBeFocused();
  await expect(map).toHaveAttribute("data-zoom", zoom!);
  await a.getByRole("button", { name: "Уменьшить карту", exact: true }).click();
  await expect
    .poll(async () => Number(await map.getAttribute("data-zoom")))
    .toBeLessThan(Number(zoom));
  await a
    .getByRole("button", { name: "Сбросить масштаб", exact: true })
    .click();
  await expect(map).toHaveAttribute("data-zoom", "1");
  for (const [code, longitude, latitude] of [
    ["RU", 35.1396, 47.8388], // Zaporizhzhia
    ["RU", 37.8028, 48.0159], // Donetsk
    ["RU", 39.3078, 48.574], // Luhansk
    ["RU", 32.6169, 46.6558], // Kherson
    ["RU", 34.1024, 44.9521], // Crimea
    ["UA", 30.5234, 50.4501], // Kyiv remains selectable as UA
  ] as const) {
    await clickCountry(a, code, longitude, latitude);
    await expect(a.locator(`[data-country="${code}"]`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
  const focus = await clickCountry(a, "UA", 30.5234, 50.4501);
  await a.mouse.move(focus.x, focus.y);
  await a.mouse.wheel(0, -750);
  await expect
    .poll(async () => Number(await map.getAttribute("data-zoom")))
    .toBeGreaterThan(2);
  await a.mouse.wheel(0, -600);
  await expect
    .poll(async () => Number(await map.getAttribute("data-zoom")))
    .toBeGreaterThan(5);
  await a.screenshot({ path: "test-results/map-host-region-scheme.png" });
  await a
    .getByRole("button", { name: "Сбросить масштаб", exact: true })
    .click();
  await clickCountry(a, "ZA", 25, -30);
  await a
    .getByRole("button", { name: "Открыть карту на весь экран", exact: true })
    .click();
  await full
    .getByRole("button", { name: "Подтвердить страну", exact: true })
    .click();
  await expect(full).toHaveCount(0);
  await expect(a.locator(".panorama canvas")).toBeVisible();

  await b.getByRole("button", { name: "Выбрать страну", exact: true }).click();
  await b
    .getByRole("button", { name: "Открыть карту на весь экран", exact: true })
    .click();
  const mobileFull = b.getByRole("dialog", {
    name: "Карта на весь экран",
    exact: true,
  });
  const mobileMap = mobileFull.locator(".map-svg");
  await expect(
    mobileFull.locator("input, .country-search-results"),
  ).toHaveCount(0);
  await expect(mobileMap).toBeVisible();
  const mobileBox = (await mobileMap.boundingBox())!;
  const touch = await b.context().newCDPSession(b);
  const cy = mobileBox.y + mobileBox.height / 2;
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 135, y: cy, id: 1 },
      { x: 225, y: cy, id: 2 },
    ],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 85, y: cy, id: 1 },
      { x: 275, y: cy, id: 2 },
    ],
  });
  await touch.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => Number(await mobileMap.getAttribute("data-zoom")))
    .toBeGreaterThan(1.5);
  await expect(b.locator('[data-country][aria-pressed="true"]')).toHaveCount(0);
  await mobileFull
    .getByRole("button", { name: "Уменьшить карту", exact: true })
    .click();
  await mobileMap.press("+");
  await mobileMap.press("ArrowRight");
  await mobileFull.locator('[data-country="RU"]').press("Enter");
  await expect(mobileFull.locator('[data-country="RU"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await b.screenshot({ path: "test-results/map-answer-mobile.png" });
  expect(
    await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await mobileFull
    .getByRole("button", { name: "Подтвердить страну", exact: true })
    .click();
  await wait(() => view.phase === "awaitingReveal");
  expect(view.players.map((p) => p.score)).toEqual([1100, 1100]);
  await send("reveal");
  await wait(() => view.phase === "finished");
  expect(view.players.map((p) => p.score)).toEqual([2200, 0]);
  const resultHint =
    "Салатовый — правильная страна. Имена и цвета — ответы игроков.";
  await expect(h.getByText(resultHint, { exact: true })).toBeVisible();
  for (const player of [a, b]) {
    await expect(player.locator(".final-results")).toBeVisible();
    await expect(player.getByText(resultHint, { exact: true })).toHaveCount(0);
  }
  await b
    .getByRole("button", { name: "Открыть карту на весь экран", exact: true })
    .click();
  await expect(
    b.getByRole("dialog", { name: "Карта на весь экран", exact: true }),
  ).toBeVisible();
  await expect(b.getByText(resultHint, { exact: true })).toHaveCount(0);
  await b
    .getByRole("button", { name: "Закрыть полноэкранную карту", exact: true })
    .click();
  await expect(h.locator(".final-results .map-svg [role=button]")).toHaveCount(
    0,
  );
  await h
    .getByRole("button", { name: "Открыть карту на весь экран", exact: true })
    .click();
  const result = h.getByRole("dialog", {
    name: "Карта на весь экран",
    exact: true,
  });
  await expect(result).toBeVisible();
  expect(
    (await result.locator(".map-svg").boundingBox())!.height,
  ).toBeGreaterThan(800);
  await expect(
    result.locator("[data-country][tabindex],[data-country][role=button]"),
  ).toHaveCount(0);
  await result
    .getByRole("button", { name: "Увеличить карту", exact: true })
    .click();
  await expect(result.locator(".map-svg")).toHaveAttribute("data-zoom", "1.5");
  await clickCountry(h, "ZA", 25, -30, false);
  await expect(result.locator('[data-country="ZA"]')).not.toHaveAttribute(
    "aria-pressed",
  );
  await h.screenshot({ path: "test-results/map-result-fullscreen.png" });
  await result
    .getByRole("button", { name: "Свернуть карту", exact: true })
    .click();
  await expect(result).toHaveCount(0);
  await expect(h.locator(".podium")).toBeVisible();
  await expect(
    h.locator(".final-results [data-pin] text").first(),
  ).toBeVisible();
  const labelPixels = await h
    .locator(".final-results [data-pin] text")
    .first()
    .evaluate((text) => {
      const matrix = (text as SVGTextElement).getScreenCTM()!;
      return Number(text.getAttribute("font-size")) * Math.abs(matrix.a);
    });
  expect(labelPixels).toBeGreaterThanOrEqual(17.5);
  expect(labelPixels).toBeLessThanOrEqual(18.5);
  await h.screenshot({ path: "test-results/map-result-controls.png" });
});

test("две библиотечные панорамы: оригиналы, независимый выбор, 360 и тайный финал", async ({
  browser,
}) => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  const h = await pageFor(browser, await api.storageState(), true);
  const players: Page[] = [];
  for (const name of ["Панорама 1", "Панорама 2"]) {
    const p = await request.newContext({ baseURL: base });
    expect(
      (
        await p.post("/api/login", {
          data: { role: "player", name, password: credentials.player },
        })
      ).ok(),
    ).toBe(true);
    players.push(await pageFor(browser, await p.storageState()));
    await p.dispose();
  }
  await wait(() => view.players.length === 2);
  const pack = (await (
    await api.get("/api/editor/packages/demo-v2-51")
  ).json()) as GamePackage;
  const template = pack.questions.find((q) => q.round === 6)!;
  const items = [
    {
      id: "browser-venice",
      title: "Венеция — мост Сан-Джузеппе",
      answer: "IT",
      filename: "san_giuseppe_bridge венеция.jpg",
      location: { latitude: 45.4305, longitude: 12.357 },
      pin: [12.5, 42.5],
    },
    {
      id: "browser-rio",
      title: "Рио-де-Жанейро — вид с вершины статуи Христа",
      answer: "BR",
      filename: "51537360171_dbbe127d6e_b.jpg",
      location: { latitude: -22.9519, longitude: -43.2105 },
      pin: [-50, -15],
    },
  ];
  const panoramaFiles: string[] = [];
  for (const item of items) {
    const buffer = process.env.QUIZ_PANORAMA_INPUT_DIR
      ? readFileSync(join(process.env.QUIZ_PANORAMA_INPUT_DIR, item.filename))
      : await sharp({
          create: {
            width: 1024,
            height: 512,
            channels: 3,
            background: item.answer === "IT" ? "#598fc1" : "#69a165",
          },
        })
          .jpeg()
          .toBuffer();
    const upload = await api.post("/api/editor/panorama-upload", {
      multipart: {
        file: { name: item.filename, mimeType: "image/jpeg", buffer },
      },
    });
    expect(upload.ok()).toBe(true);
    const media = await upload.json();
    panoramaFiles.push(media.id);
    const response = await api.post("/api/editor/questions", {
      data: {
        ...template,
        id: item.id,
        category: "География",
        title: item.title,
        place: item.title,
        answer: item.answer,
        location: item.location,
        panoramaFileId: media.id,
        source: "Файл сценария проверки",
        license: "Метаданные теста",
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await h
    .getByRole("button", { name: "Финальные панорамы", exact: true })
    .click();
  for (const item of items) {
    const card = h.locator('[data-panorama-id="' + item.id + '"]');
    await expect(card).toContainText(item.title);
    await card
      .getByRole("button", { name: "Предпросмотр: " + item.title, exact: true })
      .click();
    const preview = h.getByRole("dialog", {
      name: "Предпросмотр панорамы 360°",
      exact: true,
    });
    await expect(preview.locator("canvas")).toBeVisible();
    const pano = preview.locator(".panorama");
    await expect(pano).toHaveAttribute("aria-busy", "false");
    const heading = await pano.getAttribute("data-heading");
    const box = (await pano.boundingBox())!;
    await h.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await h.mouse.down();
    await h.mouse.move(
      box.x + box.width / 2 + 120,
      box.y + box.height / 2 + 45,
      { steps: 8 },
    );
    await h.mouse.up();
    await expect(pano).not.toHaveAttribute("data-heading", heading!);
    await expect(pano).not.toHaveAttribute("data-pitch", "0");
    await h.screenshot({
      path: "test-results/" + item.id + "-preview.png",
      fullPage: true,
    });
    await preview.getByRole("button", { name: "Закрыть предпросмотр" }).click();
  }
  const card = (id: string) => h.locator('[data-panorama-id="' + id + '"]');
  await card(items[0].id)
    .getByRole("button", { name: "Использовать в финале", exact: true })
    .click();
  await wait(() => view.finalSelection?.id === items[0].id);
  expect(
    (await api.post("/api/editor/packages/demo-v2-51/use", { data: {} })).ok(),
  ).toBe(true);
  expect(view.finalSelection?.id).toBe(items[0].id);
  await h.getByRole("button", { name: "Игра", exact: true }).click();
  await send("start");
  await send("begin");
  await send("choose", view.board[0].id);
  await send("pause");
  const currentBoard = structuredClone(view.board),
    currentQuestion = view.question?.id;
  await h
    .getByRole("button", { name: "Финальные панорамы", exact: true })
    .click();
  await card(items[1].id)
    .getByRole("button", { name: "Использовать в финале", exact: true })
    .click();
  await wait(() => view.finalSelection?.id === items[1].id);
  expect(view.board).toEqual(currentBoard);
  expect(view.question?.id).toBe(currentQuestion);
  await h.reload();
  await expect(card(items[1].id)).toHaveClass(/selected/);
  await expect(card(items[0].id)).toBeVisible();
  await h.screenshot({
    path: "test-results/requested-panoramas-library.png",
    fullPage: true,
  });
  for (let round = 1; round < 6; round++)
    await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
  for (const item of items) {
    await card(item.id)
      .getByRole("button", { name: "Использовать в финале", exact: true })
      .click();
    await wait(() => view.finalSelection?.id === item.id);
    await h.getByRole("button", { name: "Игра", exact: true }).click();
    await send("begin");
    for (const page of players) {
      await expect(page.locator("#main")).toHaveAttribute(
        "data-phase",
        "betting",
      );
      await expect(page.locator("#main")).not.toContainText(item.title);
      for (const id of panoramaFiles)
        expect((await page.request.get("/media/" + id)).status()).toBe(403);
      await page
        .getByRole("button", { name: "Подтвердить ставку", exact: true })
        .click();
    }
    await wait(() => view.phase === "locating");
    expect(view.timer.deadline! - view.serverNow).toBeLessThanOrEqual(60000);
    expect(view.timer.deadline! - view.serverNow).toBeGreaterThan(55000);
    const a = players[0].locator(".panorama"),
      b = players[1].locator(".panorama");
    await expect(a.locator("canvas")).toBeVisible();
    await expect(b.locator("canvas")).toBeVisible();
    const initial = await b.getAttribute("data-heading");
    await a.press("ArrowRight");
    await a.press("ArrowUp");
    await expect(a).not.toHaveAttribute("data-heading", initial!);
    await expect(b).toHaveAttribute("data-heading", initial!);
    for (const page of players) {
      await expect(page.locator("#main")).not.toContainText(item.title);
      await page
        .getByRole("button", { name: "Выбрать страну", exact: true })
        .click();
      await clickCountry(page, item.answer, item.pin[0], item.pin[1]);
      await page
        .getByRole("button", { name: "Вернуться к панораме", exact: true })
        .last()
        .click();
      await page
        .getByRole("button", { name: "Выбрать страну", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Подтвердить страну", exact: true })
        .click();
    }
    await wait(() => view.phase === "awaitingReveal");
    await h
      .getByRole("button", { name: "Показать ответы", exact: true })
      .click();
    await expect(players[0].locator(".place-reveal")).toContainText(item.title);
    await wait(() => view.phase === "finished");
    expect(Object.values(view.finalCorrect!)).toEqual([true, true]);
    await send("cancelFinal", "ОТМЕНИТЬ ФИНАЛ");
    await expect(
      h.getByRole("link", { name: "Выбрать панораму", exact: true }),
    ).toBeVisible();
    await expect(
      h.getByRole("button", { name: "Начать раунд", exact: true }),
    ).toBeDisabled();
    await h
      .getByRole("link", { name: "Выбрать панораму", exact: true })
      .click();
    await expect(card(items[0].id)).toBeVisible();
    await expect(card(items[1].id)).toBeVisible();
  }
});
