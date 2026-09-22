import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import type { Ack, GameView } from "../../shared/types.js";
import { defaultConfig } from "../../shared/config.js";

test("игроки открывают картинку независимо на весь экран, кадр исчезает по таймеру", async ({
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
          name: "Просмотр кадра",
          password: credentials.host,
        },
      })
    ).ok(),
  ).toBe(true);
  let v: GameView;
  const socket = io("http://127.0.0.1:4173", {
    auth: { role: "host" },
    transports: ["websocket"],
    extraHeaders: {
      Cookie: (await h.context().cookies())
        .map((c) => c.name + "=" + c.value)
        .join("; "),
    },
  });
  socket.on("state", (state) => {
    v = state;
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
  const players: Page[] = [];
  const layout = async (page: Page) => {
    const geometry = await page.locator(".question-image").evaluate((el) => {
      const img = el.querySelector("img")!;
      const image = img.getBoundingClientRect();
      const title = document.querySelector(".qtext")!.getBoundingClientRect();
      const next = el.nextElementSibling!.getBoundingClientRect();
      const container = el.getBoundingClientRect();
      const stage = document.querySelector("#main")!.getBoundingClientRect();
      return {
        belowTitle: image.top >= title.bottom,
        aboveNext: container.bottom <= next.top,
        fullyInsideStage: image.bottom <= stage.bottom,
        fits:
          image.left >= container.left - 1 &&
          image.right <= container.right + 1,
        ratio: img.clientWidth / img.clientHeight,
        naturalRatio: img.naturalWidth / img.naturalHeight,
        transform: getComputedStyle(img).transform,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry).toMatchObject({
      belowTitle: true,
      aboveNext: true,
      fullyInsideStage: true,
      fits: true,
      transform: "none",
      overflow: false,
    });
    expect(Math.abs(geometry.ratio - geometry.naturalRatio)).toBeLessThan(0.02);
  };
  try {
    await send("reset", "СБРОС");
    for (const p of [...v!.players]) await send("remove", p.id);
    expect(
      (
        await h.request.post("/api/editor/settings", { data: defaultConfig })
      ).ok(),
    ).toBe(true);
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({
        viewport: i
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      });
      contexts.push(context);
      expect(
        (
          await context.request.post("http://127.0.0.1:4173/api/login", {
            data: {
              role: "player",
              name: "Кадр " + (i + 1),
              password: credentials.player,
            },
          })
        ).ok(),
      ).toBe(true);
      const p = await context.newPage();
      await p.goto("/play");
      players.push(p);
    }
    await send("start");
    for (let round = 1; round < 5; round++)
      await send("nextRound", "СЛЕДУЮЩИЙ РАУНД");
    await send("begin");
    await send("choose", v!.board[0].id);
    await send("pause");
    await h.goto("/host");
    const openName = "Открыть картинку на весь экран";
    const modal = (p: Page) =>
      p.getByRole("dialog", { name: "Картинка на весь экран" });
    for (const p of [h, ...players]) {
      await expect(p.locator(".question-image img").first()).toBeVisible();
      await expect(
        p.getByRole("slider", { name: "Размер картинки" }),
      ).toHaveCount(0);
      await expect(
        p.getByRole("button", { name: "Исходный размер" }),
      ).toHaveCount(0);
      await expect(
        p.getByRole("button", { name: "Растянуть картинку" }),
      ).toHaveCount(0);
      await layout(p);
    }
    const [a, b] = players;
    const otherBox = await b
      .locator(".question-image-frame > img")
      .boundingBox();
    const source = await a
      .locator(".question-image-frame > img")
      .getAttribute("src");
    const revision = v!.revision;
    const timer = structuredClone(v!.timer);
    await a.getByRole("button", { name: openName }).click();
    await expect(modal(a)).toBeVisible();
    await expect(modal(a).locator("img")).toHaveAttribute("src", source!);
    await expect(modal(h)).toHaveCount(0);
    await expect(modal(b)).toHaveCount(0);
    expect(
      await b.locator(".question-image-frame > img").boundingBox(),
    ).toEqual(otherBox);
    expect(v!.revision).toBe(revision);
    expect(v!.timer).toEqual(timer);
    await a.keyboard.press("Escape");
    await expect(modal(a)).toHaveCount(0);
    await expect(a.getByRole("button", { name: openName })).toBeFocused();
    await a.getByRole("button", { name: openName }).click();
    await b.getByRole("button", { name: openName }).click();
    for (const [i, p] of players.entries()) {
      const full = modal(p);
      await expect(full).toBeVisible();
      await expect(full.locator("img")).toHaveCSS("object-fit", "contain");
      const bounds = await full.boundingBox();
      const viewport = p.viewportSize()!;
      expect(bounds).toMatchObject({
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.height,
      });
      const header = (await full.locator("header").boundingBox())!;
      const image = (await full.locator("img").boundingBox())!;
      expect(image.y).toBeGreaterThanOrEqual(header.y + header.height);
      expect(image.y + image.height).toBeLessThanOrEqual(viewport.height);
      expect(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await p.screenshot({
        path: `test-results/image-fullscreen-${i ? "mobile" : "desktop"}.png`,
      });
    }
    await modal(b).getByRole("button", { name: "Свернуть картинку" }).click();
    await expect(modal(b)).toHaveCount(0);
    await expect(modal(a)).toBeVisible();
    await b.getByRole("button", { name: openName }).click();
    const shownTime = await modal(a).getByRole("timer").innerText();
    await send("resume");
    await expect
      .poll(() => modal(a).getByRole("timer").innerText())
      .not.toBe(shownTime);
    expect(
      (
        await h.request.post("/api-test/expire", {
          headers: {
            "x-test-secret": readFileSync(
              ".local/e2e/clock-secret.txt",
              "utf8",
            ),
          },
        })
      ).ok(),
    ).toBe(true);
    for (const p of [h, ...players]) {
      await expect(modal(p)).toHaveCount(0);
      await expect(p.locator(".question-image")).toHaveCount(0);
      await expect(p.getByRole("button", { name: openName })).toHaveCount(0);
    }
    expect((await a.request.get(new URL(source!, a.url()).href)).status()).toBe(
      403,
    );
    await send("reveal", "ЗАВЕРШИТЬ ОЖИДАНИЕ");
    for (const p of [h, ...players]) {
      await expect(modal(p)).toHaveCount(0);
      await layout(p);
    }
    await b.getByRole("button", { name: openName }).click();
    await send("next");
    await expect(modal(b)).toHaveCount(0);
    await send("choose", v!.board.find((q) => !q.used)!.id);
    await expect(modal(b)).toHaveCount(0);

    // The same viewer uses only the currently permitted fragment image.
    await send("previousRound", "ПРЕДЫДУЩИЙ РАУНД");
    await send("begin");
    await send("choose", v!.board[0].id);
    const fragment = await a
      .locator(".question-image-frame > img")
      .getAttribute("src");
    await a.getByRole("button", { name: openName }).click();
    await expect(modal(a).locator("img")).toHaveAttribute("src", fragment!);
    await send("reveal", "ЗАВЕРШИТЬ ОЖИДАНИЕ");
    await expect(modal(a)).toHaveCount(0);
    await a.getByRole("button", { name: openName }).click();
    await expect(modal(a)).toBeVisible();
  } finally {
    await send("reset", "СБРОС");
    for (const p of [...v!.players]) await send("remove", p.id);
    socket.disconnect();
    for (const c of contexts) await c.close();
    await h.request.post("/api/logout", { data: { role: "host" } });
  }
});
