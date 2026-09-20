import {
  test,
  expect,
  request as apiRequest,
  type Browser,
  type BrowserContext,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { defaultConfig } from "../../shared/config.js";
type State = Awaited<ReturnType<APIRequestContext["storageState"]>>;
let hostState: State,
  aliceState: State,
  bobState: State,
  hostRequest: APIRequestContext;
const contexts: BrowserContext[] = [];
let newerQuestions: string[] = [];
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  ) as { host: string; player: string };
  const create = async (role: string, name: string, password: string) => {
    const r = await apiRequest.newContext({ baseURL: "http://127.0.0.1:4173" });
    const result = await r.post("/api/login", {
      data: { role, name, password },
    });
    expect(result.ok()).toBe(true);
    return r;
  };
  hostRequest = await create("host", "Ведущий", credentials.host);
  hostState = await hostRequest.storageState();
  const editor = await (await hostRequest.get("/api/editor")).json();
  newerQuestions = editor.questions
    .filter(
      (q: {
        id: string;
        active: boolean;
        formatVersion?: number;
        round: number;
      }) => q.active && q.formatVersion === 2 && q.round < 6,
    )
    .map((q: { id: string }) => q.id);
  // This suite exercises the legacy demo; the v2 suite exercises its own package.
  expect(
    (
      await hostRequest.post("/api/editor/bulk", {
        data: { ids: newerQuestions, active: false },
      })
    ).ok(),
  ).toBe(true);
  const a = await create("player", "Алиса", credentials.player);
  aliceState = await a.storageState();
  await a.dispose();
  const b = await create("player", "Борис", credentials.player);
  bobState = await b.storageState();
  await b.dispose();
  const config = structuredClone(defaultConfig);
  config.timers.study = [0.3, 0.3, 0.3];
  expect(
    (await hostRequest.post("/api/editor/settings", { data: config })).ok(),
  ).toBe(true);
});
test.afterEach(async () => {
  for (const context of contexts) await context.close();
  contexts.length = 0;
});
test.afterAll(async () => {
  await hostRequest.post("/api/editor/bulk", {
    data: { ids: newerQuestions, active: true },
  });
  await hostRequest.post("/api/logout", { data: { role: "host" } });
  await hostRequest.dispose();
});
async function newPage(
  browser: Browser,
  state: State,
  host = false,
  mobile = false,
) {
  const c = await browser.newContext({
    storageState: state,
    reducedMotion: "reduce",
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1920, height: 1080 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  contexts.push(c);
  const p = await c.newPage();
  await p.goto(host ? "/host" : "/play");
  await expect(p.locator(".stage")).toBeVisible();
  return p;
}
test("авторизация, мобильное лобби, восстановление после обновления и чистый экран", async ({
  browser,
  page,
}) => {
  await page.goto("/play");
  await expect(page.locator("form input")).toHaveCount(2);
  await expect(page.locator("h1,h2,header,footer,.text-link")).toHaveCount(0);
  await page.getByLabel("Имя", { exact: true }).fill("Тест");
  await page.getByLabel("Пароль", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Неверный пароль");
  await page.screenshot({
    path: "test-results/login.png",
    fullPage: true,
    animations: "disabled",
  });
  const h = await newPage(browser, hostState, true);
  const a = await newPage(browser, aliceState, false, true);
  await newPage(browser, bobState);
  await a.getByRole("button", { name: "Готов к игре", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "Я пока не готов" }),
  ).toBeVisible();
  await a.reload();
  await expect(
    a.getByRole("button", { name: "Я пока не готов" }),
  ).toBeVisible();
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await a.screenshot({
    path: "test-results/mobile-lobby.png",
    fullPage: true,
    animations: "disabled",
  });
  await h.screenshot({
    path: "test-results/host-lobby.png",
    fullPage: true,
    animations: "disabled",
  });
  await h.getByRole("button", { name: "Чистый экран", exact: true }).click();
  await expect(h.locator(".host-nav")).toBeHidden();
  await h.keyboard.press("Tab");
  await h.locator(".game-toolbar").hover();
  await h.getByRole("button", { name: "Вернуть панель" }).click();
  await expect(h.locator(".host-nav")).toBeVisible();
});
test("основная целочисленная шкала и управление раундами", async ({
  browser,
}) => {
  const h = await newPage(browser, hostState, true);
  const a = await newPage(browser, aliceState);
  const b = await newPage(browser, bobState);
  await expect(h.getByRole("link", { name: "Экран OBS ↗" })).toHaveCount(0);
  await expect(
    h.getByRole("button", { name: "Восстановить фазу" }),
  ).toHaveCount(0);
  await h.getByRole("button", { name: "Начать игру", exact: true }).click();
  await expect(
    h.getByText("Точная отметка. Два коридора. Найдите верный масштаб."),
  ).toHaveCount(0);
  await h.getByRole("button", { name: "Начать раунд", exact: true }).click();
  await expect(h.locator(".scene-title")).toHaveText("Выберите категорию");
  await expect(h.locator(".category-list,.categories-board")).toHaveCount(0);
  await expect(h.locator("#app")).not.toContainText("СТОН");
  await expect(h).toHaveTitle("Викторина в эфире");
  await expect(h.locator(".v2-board button").first()).toHaveText("Считаем");
  await h.screenshot({ path: "test-results/corridor-tiles-host.png" });
  await a.setViewportSize({ width: 390, height: 844 });
  await expect(a.locator(".v2-board button").first()).toHaveText("Считаем");
  expect(
    await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await a.screenshot({
    path: "test-results/corridor-tiles-mobile.png",
    fullPage: true,
  });
  await a.setViewportSize({ width: 1920, height: 1080 });
  await h.locator(".v2-board button:not(:disabled)").first().click();
  const name = await h.locator(".frame.active .nm").textContent();
  const active = name === "Алиса" ? a : b;
  const scale = active.locator(".scale-track input[type=range]");
  await expect(scale).toHaveAttribute("step", "1");
  await expect(active.locator(".answer-area input[type=range]")).toHaveCount(0);
  await active.getByLabel("Числовой ответ", { exact: true }).fill("176.8");
  await expect(
    active.getByLabel("Числовой ответ", { exact: true }),
  ).toHaveValue("177");
  await scale.focus();
  await active.keyboard.press("ArrowRight");
  await expect(
    active.getByLabel("Числовой ответ", { exact: true }),
  ).toHaveValue("178");
  await expect(h.locator(".primary-point-marker b")).toContainText("178");
  const rect = await scale.boundingBox();
  if (!rect) throw Error("scale");
  await active.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height / 2);
  await active.mouse.down();
  await active.mouse.move(rect.x + rect.width * 0.6, rect.y + rect.height / 2, {
    steps: 8,
  });
  await active.mouse.up();
  const value = Number(
    await active.getByLabel("Числовой ответ", { exact: true }).inputValue(),
  );
  expect(Number.isInteger(value)).toBe(true);
  // Wait for the last debounced preview before testing a revision-checked restart.
  await expect(h.locator(".primary-point-marker b")).toContainText(
    String(value),
  );
  await active.screenshot({
    path: "test-results/main-scale.png",
    fullPage: true,
  });
  await h.reload();
  await expect(h.locator(".stage")).toHaveAttribute("data-phase", "point");

  await h
    .getByRole("button", { name: "Начать раунд заново", exact: true })
    .click();
  await h
    .locator(".game-dialog-overlay")
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await expect(h.locator(".stage")).toHaveAttribute("data-phase", "intro");
  await expect(h.locator(".stage")).toHaveAttribute("data-round", "1");

  await h.getByRole("button", { name: "Следующий раунд", exact: true }).click();
  await h
    .locator(".game-dialog-overlay")
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await expect(h.locator(".stage")).toHaveAttribute("data-round", "2");
  await h.screenshot({
    path: "test-results/round-controls.png",
    fullPage: true,
  });
});
test("полная партия: 5 раундов, весь банк, ставки, карта стран и финал для двух игроков", async ({
  browser,
}) => {
  const h = await newPage(browser, hostState, true);
  const a = await newPage(browser, aliceState, false, true);
  const b = await newPage(browser, bobState);
  const players: Record<string, Page> = { Алиса: a, Борис: b };
  await h.getByRole("button", { name: "Панель ведущего", exact: true }).click();

  await h.getByRole("button", { name: "Сбросить партию" }).click();
  await h.locator(".game-dialog-overlay input").fill("СБРОС");
  await h
    .locator(".game-dialog-overlay")
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await h
    .getByRole("button", { name: "Закрыть панель ×", exact: true })
    .click();
  await expect(a.getByRole("button", { name: "Готов к игре" })).toBeVisible();
  await a.getByRole("button", { name: "Готов к игре" }).click();
  await b.getByRole("button", { name: "Готов к игре" }).click();
  await h.getByRole("button", { name: "Начать игру", exact: true }).click();
  const bank = (await (await hostRequest.get("/api/editor")).json()) as {
    questions: {
      id: string;
      round: number;
      active: boolean;
      answer: string | number;
      min?: number;
      max?: number;
    }[];
  };
  const obs = await h.context().newPage();
  await obs.goto("/obs");
  await expect(obs.locator("#controls,.host-nav,.answer-panel")).toHaveCount(0);
  const stage = h.locator(".stage");
  let count = 0;
  for (let round = 1; round <= 5; round++) {
    await expect(stage).toHaveAttribute("data-phase", "intro");
    await expect(stage).toHaveAttribute("data-round", String(round));
    await h.getByRole("button", { name: "Начать раунд", exact: true }).click();
    const total = bank.questions.filter(
      (q) => q.active && q.round === round,
    ).length;
    for (let n = 0; n < total; n++) {
      await expect(stage).toHaveAttribute("data-phase", "choosing");
      if (n === 0 && round === 4) {
        await expect(h.locator(".board .cell")).toHaveCount(15);
        await expect(a.locator(".board .theme-name").first()).toHaveCSS(
          "grid-column-start",
          "auto",
        );
        await h.screenshot({ path: "test-results/host-board.png" });
        await obs.screenshot({ path: "test-results/obs-board.png" });
      }
      await h
        .locator(
          round === 1
            ? ".v2-board button:not(:disabled)"
            : round <= 3
              ? ".category-list button:not(:disabled)"
              : ".question-board button:not(:disabled)",
        )
        .first()
        .click();
      count++;
      await expect(stage).not.toHaveAttribute("data-phase", "choosing");
      const qid = await stage.getAttribute("data-question-id");
      const q = bank.questions.find((q) => q.id === qid)!;
      if (round === 1) {
        const activeName = await h.locator(".frame.active .nm").textContent();
        const active = players[activeName!];
        const other = active === a ? b : a;
        await active
          .getByLabel("Числовой ответ", { exact: true })
          .fill(String(q.answer));
        await active
          .getByRole("button", { name: "Зафиксировать отметку" })
          .click();
        const start = Math.max(
          q.min!,
          Math.min(
            q.max! - (q.max! - q.min!) * 0.1,
            Number(q.answer) - (q.max! - q.min!) * 0.05,
          ),
        );
        await other.getByLabel("Положение диапазона").evaluate((el, value) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!;
          setter.call(el, String(value));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, start);
        await other
          .getByRole("button", { name: "Зафиксировать диапазон" })
          .click();
      } else if (round === 2 || round === 3) {
        const label =
          round === 2 ? (q.answer === "before" ? "До" : "После") : null;
        for (const p of [a, b]) {
          const buttons = p.locator(".choice-buttons button");
          if (label)
            await p.getByRole("button", { name: label, exact: true }).click();
          else await buttons.nth(q.answer === "a" ? 0 : 1).click();
        }
        if (round === 2) {
          await expect(stage).toHaveAttribute("data-phase", "awaitingReveal");
          await h
            .getByRole("button", { name: "Показать ответ", exact: true })
            .click();
        }
      } else {
        if (round === 4 && n === 0) {
          await a.screenshot({
            path: "test-results/mobile-buzzer.png",
            fullPage: true,
          });
          await h.screenshot({ path: "test-results/host-question.png" });
          await expect(obs.locator(".answer-panel")).toHaveCount(0);
        }
        if (round === 5) {
          await expect(a.locator(".stage")).toHaveAttribute(
            "data-phase",
            "buzzing",
          );
          await expect(a.locator(".question-media")).toHaveCount(0);
        }
        if (round === 4 && n === 1) {
          await a.locator(".question-title").click();
          await a.keyboard.press("Space");
        } else
          await a
            .getByRole("button", { name: "ОТВЕТИТЬ", exact: true })
            .click();
        if (round === 4 && n === 0) {
          await h.setViewportSize({ width: 760, height: 900 });
          await h
            .getByRole("button", { name: "Панель ведущего", exact: true })
            .click();
          await expect(h.locator(".drawer-answer")).toContainText(
            String(q.answer),
          );
          await h.screenshot({
            path: "test-results/host-narrow-judging.png",
            animations: "disabled",
          });
          await h
            .getByRole("button", { name: "Закрыть панель ×", exact: true })
            .click();
          await h.setViewportSize({ width: 1920, height: 1080 });
        }
        await h.getByRole("button", { name: "Верно", exact: true }).click();
      }
      await expect(stage).toHaveAttribute("data-phase", "reveal");
      if (n === 0 && [1, 4, 5].includes(round))
        await h.screenshot({
          path: "test-results/round-" + round + ".png",
          fullPage: true,
          animations: "disabled",
        });
      if (n === 0) {
        expect(
          await a.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await a.screenshot({
          path: "test-results/mobile-round-" + round + ".png",
          fullPage: true,
          animations: "disabled",
        });
      }
      await h
        .getByRole("button", { name: "Следующий вопрос", exact: true })
        .click();
    }
  }
  expect(count).toBe(
    bank.questions.filter((q) => q.active && q.round < 6).length,
  );
  await expect(stage).toHaveAttribute("data-round", "6");
  await expect(
    h.getByRole("button", { name: "Начать раунд", exact: true }),
  ).toBeDisabled();
  await h
    .getByRole("button", { name: "Финальные панорамы", exact: true })
    .click();
  await h
    .locator('[data-panorama-id="demo-local-360"]')
    .getByRole("button", { name: "Использовать в финале" })
    .click();
  await expect(h.locator('[data-panorama-id="demo-local-360"]')).toContainText(
    "Выбрана для финала",
  );
  await h.getByRole("button", { name: "Игра", exact: true }).click();
  await h.getByRole("button", { name: "Начать раунд", exact: true }).click();
  for (const p of [a, b]) {
    await p.getByLabel("Ставка", { exact: true }).fill("100");
    await p.getByRole("button", { name: "Подтвердить ставку" }).click();
  }
  await expect(a.locator(".panorama canvas")).toBeVisible();
  await expect(obs.locator(".panorama canvas")).toBeVisible();
  await expect(obs.locator("#controls,.map-toggle,.answer-panel")).toHaveCount(
    0,
  );
  await obs.screenshot({ path: "test-results/obs-panorama.png" });
  await a.getByRole("button", { name: "Выбрать страну", exact: true }).click();
  const france = a.locator('[data-country="FR"]');
  await france.focus();
  await france.press("Enter");
  await expect(france).toHaveAttribute("aria-pressed", "true");
  await a
    .getByRole("button", { name: "Вернуться к панораме", exact: true })
    .last()
    .click();
  await expect(a.locator(".panorama canvas")).toBeVisible();
  await a.getByRole("button", { name: "Выбрать страну", exact: true }).click();
  await expect(a.locator('[data-country="FR"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await a.getByRole("button", { name: "Подтвердить страну" }).click();
  await expect(h.locator(".final-table")).toHaveCount(0);
  const external: string[] = [];
  b.on("request", (request) => {
    if (/maps\.google|maps\.gstatic/.test(request.url()))
      external.push(request.url());
  });
  await b.reload();
  await expect(b.locator(".panorama canvas")).toBeVisible();
  await expect(b.locator(".panorama-note")).toContainText(
    "Перемещение отключено",
  );
  const camera = b.getByLabel("Панорама 360 градусов", { exact: true });
  const heading = Number(await camera.getAttribute("data-heading"));
  await camera.press("ArrowRight");
  await expect(camera).toHaveAttribute("data-heading", String(heading + 8));
  expect(await camera.locator("a,iframe").count()).toBe(0);
  expect(external).toEqual([]);
  await b.getByRole("button", { name: "Выбрать страну", exact: true }).click();
  await b.locator('[data-country="DE"]').click();
  await expect(b.locator('[data-country="DE"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await b.getByRole("button", { name: "Подтвердить страну" }).click();
  await expect(stage).toHaveAttribute("data-phase", "awaitingReveal");
  await h.getByRole("button", { name: "Показать ответы", exact: true }).click();
  await expect(stage).toHaveAttribute("data-phase", "finished");
  await expect(h.locator(".winner-announcement")).toContainText("Алиса");
  await expect(h.locator(".final-table")).toContainText("Франция");
  await expect(h.locator(".final-table")).toContainText("Германия");
  const mapBox = await h.locator(".final-results .world-map").boundingBox();
  const tableBox = await h.locator(".final-table").boundingBox();
  const mainBox = await stage.boundingBox();
  expect(tableBox!.y).toBeGreaterThanOrEqual(mapBox!.y + mapBox!.height);
  expect(tableBox!.y + tableBox!.height).toBeLessThanOrEqual(
    mainBox!.y + mainBox!.height,
  );
  await h.screenshot({
    path: "test-results/final.png",
    fullPage: true,
    animations: "disabled",
  });
});
test("редактор: публикация дробного ответа, черновик, дублирование, категории и переход в редактор локальной панорамы", async ({
  browser,
}) => {
  const h = await newPage(browser, hostState, true);
  await h.getByRole("button", { name: "Вопросы", exact: true }).click();
  await h.goto("/editor");
  await expect(
    h.getByRole("heading", { name: "Редактор вопросов", exact: true }),
  ).toBeVisible();
  await h
    .getByRole("button", { name: "1. Больше-меньше", exact: true })
    .click();
  await expect(h.getByLabel("Фильтр по раунду")).toHaveValue("1");
  await h.screenshot({ path: "test-results/editor-bank.png", fullPage: true });
  await h.getByRole("button", { name: "Новый вопрос" }).click();
  await h.getByLabel("Категория", { exact: true }).fill("E2E категория");
  await h
    .getByLabel("Текст вопроса", { exact: true })
    .fill("Дробный учебный вопрос");
  await h.getByLabel("Правильное числовое значение").fill("12.5");
  await h
    .getByLabel("Пояснение после раскрытия")
    .fill("Проверка дробного ответа");
  for (const label of ["Стоимость", "Сложность (1–5)", "Порядок в категории"])
    await expect(h.getByLabel(label, { exact: true })).toHaveCount(0);
  await h
    .getByLabel("Источник информации", { exact: true })
    .fill("Авторский учебный пример");
  await h.screenshot({ path: "test-results/editor-form.png", fullPage: true });
  await h.getByRole("button", { name: "Игра", exact: true }).click();
  await h.getByRole("button", { name: "Вопросы", exact: true }).click();
  await h
    .getByRole("button", { name: "Восстановить черновик", exact: true })
    .click();
  await expect(h.getByLabel("Правильное числовое значение")).toHaveValue(
    "12.5",
  );
  await h.getByRole("button", { name: "Предпросмотр", exact: true }).click();
  await expect(h.locator(".content-preview")).toContainText(
    "Дробный учебный вопрос",
  );
  await h
    .getByRole("button", { name: "Сохранить вопрос", exact: true })
    .click();
  await expect(h.locator(".success")).toContainText("Вопрос опубликован");
  await h.getByLabel("Поиск вопросов").fill("Дробный учебный вопрос");
  const row = h.locator("article.q[data-question-id]").first();
  await row.getByRole("button", { name: /Дублировать/ }).click();
  await h.getByLabel("Текст вопроса", { exact: true }).fill("Копия вопроса");
  await h
    .getByRole("button", { name: "Сохранить вопрос", exact: true })
    .click();
  await h.getByRole("button", { name: "Категории", exact: true }).click();
  await h.getByLabel("Название", { exact: true }).fill("Новая категория");
  await h
    .getByRole("button", { name: "Сохранить категорию", exact: true })
    .click();
  await expect(
    h.locator(".category-row").filter({ hasText: "Новая категория" }),
  ).toBeVisible();
  await h.getByRole("button", { name: "Вопросы", exact: true }).click();
  await h.getByRole("button", { name: "Новый вопрос", exact: true }).click();
  await h.getByLabel("Раунд", { exact: true }).selectOption("6");
  await expect(
    h.getByRole("dialog", { name: "Редактор панорамы", exact: true }),
  ).toBeVisible();
  await expect(h.getByLabel("Файл панорамы", { exact: true })).toBeVisible();
  await expect(h.getByLabel("Поворот камеры, °", { exact: true })).toHaveValue(
    "0",
  );
  await h
    .getByLabel("Внутреннее название", { exact: true })
    .fill("Черновик локальной панорамы");
  await h
    .getByRole("button", { name: "Закрыть редактор панорамы", exact: true })
    .click();
  await h.screenshot({
    path: "test-results/editor.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("библиотека панорам: загрузка, 360° предпросмотр, ручной выбор, отмена и повтор", async ({
  browser,
}) => {
  const sharp = (await import("sharp")).default;
  const h = await newPage(browser, hostState, true);
  const a = await newPage(browser, aliceState, false, true);
  const b = await newPage(browser, bobState);
  await h.getByRole("button", { name: "Панель ведущего", exact: true }).click();
  const cancel = h.getByRole("button", {
    name: "Отменить финал и выбрать другую панораму",
    exact: true,
  });
  if (await cancel.count()) {
    await cancel.click();
    await h
      .locator(".game-dialog-overlay")
      .getByRole("button", { name: "Подтвердить", exact: true })
      .click();
  }
  await h
    .getByRole("button", { name: "Закрыть панель ×", exact: true })
    .click();
  await h
    .getByRole("button", { name: "Финальные панорамы", exact: true })
    .click();
  await h.getByRole("button", { name: "Новая панорама", exact: true }).click();
  await h
    .getByLabel("Внутреннее название", { exact: true })
    .fill("Тестовая круговая панорама");
  const buffer = await sharp({
    create: { width: 1024, height: 512, channels: 3, background: "#557d92" },
  })
    .jpeg()
    .toBuffer();
  await h.getByLabel("Файл панорамы", { exact: true }).setInputFiles({
    name: "private-country.jpg",
    mimeType: "image/jpeg",
    buffer,
  });
  await expect(
    h.getByRole("button", { name: "Интерактивный предпросмотр", exact: true }),
  ).toBeVisible();
  await h.getByLabel("Правильная страна", { exact: true }).selectOption("FR");
  await h.getByLabel("Название места", { exact: true }).fill("Тестовый парк");
  await h
    .getByLabel("Пояснение после раскрытия", { exact: true })
    .fill("Учебная панорама для проверки.");
  await h
    .getByLabel("Источник", { exact: true })
    .fill("Собственный тестовый рисунок");
  await h.getByLabel("Автор", { exact: true }).fill("Тест");
  await h.getByLabel("Широта", { exact: true }).fill("48.85");
  await h.getByLabel("Долгота", { exact: true }).fill("2.35");
  await h.getByLabel("Тип лицензии", { exact: true }).fill("CC0");
  await h
    .getByLabel("Ссылка на лицензию", { exact: true })
    .fill("https://creativecommons.org/publicdomain/zero/1.0/");
  await h.getByLabel("Поворот камеры, °", { exact: true }).fill("20");
  await h.getByLabel("Минимальное приближение, ×", { exact: true }).fill("0.8");
  await h.getByLabel("Максимальное приближение, ×", { exact: true }).fill("2");
  await h
    .getByRole("button", { name: "Интерактивный предпросмотр", exact: true })
    .click();
  const preview = h.getByRole("dialog", {
    name: "Предпросмотр панорамы 360°",
    exact: true,
  });
  await expect(preview.locator("canvas")).toBeVisible();
  await h.screenshot({
    path: "test-results/panorama-preview.png",
    fullPage: true,
  });
  await preview
    .getByLabel("Панорама 360 градусов", { exact: true })
    .press("ArrowRight");
  await preview
    .getByRole("button", { name: "Приблизить панораму", exact: true })
    .click();
  await preview
    .getByRole("button", { name: "Использовать текущий ракурс", exact: true })
    .click();
  await h.screenshot({
    path: "test-results/panorama-camera-form.png",
    fullPage: true,
  });
  await h
    .getByRole("button", { name: "Сохранить панораму", exact: true })
    .click();
  const card = h
    .locator(".panorama-card")
    .filter({ hasText: "Тестовая круговая панорама" });
  await expect(card).toBeVisible();
  await h.screenshot({
    path: "test-results/panorama-library.png",
    fullPage: true,
  });
  const bank = (await (await hostRequest.get("/api/editor")).json()) as {
    questions: { id: string; title?: string; panoramaFileId?: string }[];
  };
  const q = bank.questions.find(
    (q) => q.title === "Тестовая круговая панорама",
  )!;
  expect((await a.request.get("/media/" + q.panoramaFileId)).status()).toBe(
    403,
  );
  await card
    .getByRole("button", { name: "Использовать в финале", exact: true })
    .click();
  await expect(card).toContainText("Выбрана для финала");
  await h.reload();
  await expect(
    h.getByRole("region", { name: "Выбор для текущей партии" }),
  ).toContainText("Тестовая круговая панорама");
  await h.getByRole("button", { name: "Игра", exact: true }).click();
  await h.getByRole("button", { name: "Начать раунд", exact: true }).click();
  await a.getByLabel("Ставка", { exact: true }).fill("100");
  await b.getByLabel("Ставка", { exact: true }).fill("100");
  await a
    .getByRole("button", { name: "Подтвердить ставку", exact: true })
    .click();
  await b
    .getByRole("button", { name: "Подтвердить ставку", exact: true })
    .click();
  await expect(a.locator(".stage")).toHaveAttribute("data-phase", "locating");
  await expect(a.locator(".panorama canvas")).toBeVisible();
  expect((await a.request.get("/media/" + q.panoramaFileId)).ok()).toBe(true);
  const playerCamera = a.getByLabel("Панорама 360 градусов", { exact: true });
  await expect(playerCamera).toHaveAttribute("data-heading", "28");
  await expect(playerCamera).toHaveAttribute("data-zoom", "1.2");
  for (let i = 0; i < 12; i++) await playerCamera.press("+");
  await expect(playerCamera).toHaveAttribute("data-zoom", "2");
  for (let i = 0; i < 12; i++) await playerCamera.press("-");
  await expect(playerCamera).toHaveAttribute("data-zoom", "0.8");
  await playerCamera.press("ArrowLeft");
  await expect(playerCamera).toHaveAttribute("data-heading", "20");
  await a.getByRole("button", { name: "Выбрать страну", exact: true }).click();
  await a
    .getByRole("button", { name: "Вернуться к панораме", exact: true })
    .last()
    .click();
  await expect(a.locator(".panorama canvas")).toBeVisible();
  await expect(playerCamera).toHaveAttribute("data-heading", "20");
  await expect(playerCamera).toHaveAttribute("data-zoom", "0.8");
  await h.getByRole("button", { name: "Панель ведущего", exact: true }).click();

  await h
    .getByRole("button", {
      name: "Отменить финал и выбрать другую панораму",
      exact: true,
    })
    .click();
  await h
    .locator(".game-dialog-overlay")
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await h
    .getByRole("button", { name: "Закрыть панель ×", exact: true })
    .click();
  await expect(a.locator(".stage")).toHaveAttribute("data-phase", "intro");
  expect((await a.request.get("/media/" + q.panoramaFileId)).status()).toBe(
    403,
  );
  await expect(
    h.getByRole("button", { name: "Начать раунд", exact: true }),
  ).toBeDisabled();
  await h
    .getByRole("button", { name: "Финальные панорамы", exact: true })
    .click();
  await expect(card).toContainText("Использована ранее");
  await card.getByRole("button", { name: "Отключить", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Использовать в финале", exact: true }),
  ).toBeDisabled();
  await card.getByRole("button", { name: "Включить", exact: true }).click();
  await card
    .getByRole("button", { name: "Использовать в финале", exact: true })
    .click();
  await expect(card).toContainText("Выбрана для финала");
  await h.getByRole("button", { name: "Игра", exact: true }).click();
  await h.getByRole("button", { name: "Начать раунд", exact: true }).click();
  await expect(
    a.getByRole("button", { name: "Подтвердить ставку", exact: true }),
  ).toBeEnabled();
  await expect(a.getByLabel("Ставка", { exact: true })).toHaveValue("");
  await expect(a.getByLabel("Ставка", { exact: true })).toHaveAttribute(
    "placeholder",
    "0",
  );
});

test("переименование раундов, старт без готовности с одним и без игроков", async ({
  browser,
}) => {
  const h = await newPage(browser, hostState, true);
  const reset = async () => {
    await h
      .getByRole("button", { name: "Панель ведущего", exact: true })
      .click();

    await h.getByRole("button", { name: "Сбросить партию" }).click();
    await h.locator(".game-dialog-overlay input").fill("СБРОС");
    await h
      .locator(".game-dialog-overlay")
      .getByRole("button", { name: "Подтвердить", exact: true })
      .click();
    await expect(h.locator(".stage")).toHaveAttribute("data-phase", "lobby");
  };
  const closePanel = () =>
    h.getByRole("button", { name: "Закрыть панель ×", exact: true }).click();
  await reset();
  await h.getByRole("button", { name: "Удалить Борис", exact: true }).click();
  await expect(
    h.getByRole("button", { name: "Удалить Борис", exact: true }),
  ).toHaveCount(0);
  await closePanel();
  const a = await newPage(browser, aliceState, false, true);
  await expect(
    a.getByRole("button", { name: "Готов к игре", exact: true }),
  ).toBeVisible();
  await expect(
    h.getByRole("button", { name: "Начать игру", exact: true }),
  ).toBeEnabled();
  await h.getByRole("button", { name: "Настройки", exact: true }).click();
  await h.getByLabel("Раунд 1", { exact: true }).fill("Числа в эфире");
  await h.getByLabel("Финал", { exact: true }).fill("Найди страну");
  await h
    .getByRole("button", { name: "Сохранить названия раундов", exact: true })
    .click();
  await expect(h.locator(".success")).toContainText(
    "Названия раундов сохранены",
  );
  await expect(a.locator(".theme-chips")).toContainText("Числа в эфире");
  await h.screenshot({
    path: "test-results/round-name-settings.png",
    fullPage: true,
  });
  await h.reload();
  await expect(h.getByLabel("Раунд 1", { exact: true })).toHaveValue(
    "Числа в эфире",
  );
  await h.getByRole("button", { name: "Вопросы", exact: true }).click();
  await expect(
    h.getByRole("button", { name: "1. Числа в эфире", exact: true }),
  ).toBeVisible();
  await h.getByRole("button", { name: "Игра", exact: true }).click();
  await h.getByRole("button", { name: "Начать игру", exact: true }).click();
  await expect(h.locator(".stage")).toHaveAttribute("data-phase", "intro");
  await expect(a.locator(".scene-title")).toHaveText("Числа в эфире");
  await h.getByRole("button", { name: "Начать раунд", exact: true }).click();
  await h.locator(".v2-board button:not(:disabled)").first().click();
  await expect(a.locator(".stage")).toHaveAttribute("data-phase", "point");
  await a
    .getByRole("button", { name: "Зафиксировать отметку", exact: true })
    .click();
  await expect(h.locator(".stage")).toHaveAttribute("data-phase", "reveal");
  await reset();
  await h.getByRole("button", { name: "Удалить Алиса", exact: true }).click();
  await expect(
    h.getByRole("button", { name: "Удалить Алиса", exact: true }),
  ).toHaveCount(0);
  await closePanel();
  await expect(h.locator(".lobby-sub")).toContainText("0 / 6");
  await h.getByRole("button", { name: "Начать игру", exact: true }).click();
  await expect(h.locator(".stage")).toHaveAttribute("data-phase", "intro");
  await h.screenshot({
    path: "test-results/zero-player-start.png",
    fullPage: true,
  });
  await h.getByRole("button", { name: "Начать раунд", exact: true }).click();
  await h.locator(".v2-board button:not(:disabled)").first().click();
  await h.getByRole("button", { name: "Показать ответ", exact: true }).click();
  await expect(h.locator(".stage")).toHaveAttribute("data-phase", "reveal");
  await h
    .getByRole("button", { name: "Следующий вопрос", exact: true })
    .click();
  await expect(h.locator(".stage")).toHaveAttribute("data-phase", "choosing");
});
