import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { createServer, loadConfigFromFile } from "vite";

test("dev: предпросмотр панорамы восстанавливается после ошибки загрузки модуля", async ({
  page,
}) => {
  const loaded = await loadConfigFromFile({
    command: "serve",
    mode: "development",
  });
  if (!loaded) throw new Error("Нет конфигурации Vite");
  const config = loaded.config;
  const target = "http://127.0.0.1:4173";
  const proxy = Object.fromEntries(
    Object.entries(config.server?.proxy ?? {}).map(([path, options]) => [
      path,
      typeof options === "string" ? target : { ...options, target },
    ]),
  );
  const dev = await createServer({
    ...config,
    configFile: false,
    cacheDir: resolve("node_modules/.vite-panorama-e2e"),
    logLevel: "silent",
    server: {
      ...config.server,
      host: "127.0.0.1",
      port: 0,
      watch: null,
      proxy,
    },
  });
  let origin = "";
  try {
    await dev.listen();
    origin =
      "http://127.0.0.1:" + (dev.httpServer!.address() as AddressInfo).port;
    const credentials = JSON.parse(
      readFileSync(".local/e2e/credentials.json", "utf8"),
    ) as { host: string };
    await page.goto(origin + "/host");
    await page.getByLabel("Имя", { exact: true }).fill("Проверка панорамы");
    await page.getByLabel("Пароль", { exact: true }).fill(credentials.host);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(page.locator(".stage")).toBeVisible();
    await page
      .getByRole("button", { name: "Финальные панорамы", exact: true })
      .click();
    const preview = () =>
      page
        .getByRole("button", { name: /^Предпросмотр: Kiara 1 Dawn/ })
        .first()
        .click();
    const module = "**/client/LocalPanoramaProvider.ts*";
    await page.route(module, (route) => route.abort("failed"));
    await preview();
    await expect(page.getByRole("alert")).toContainText(
      "Не удалось загрузить просмотр панорамы",
    );
    await expect(page.getByRole("alert")).not.toContainText("Failed to fetch");
    await page.unroute(module);
    await page
      .getByRole("button", { name: "Обновить страницу", exact: true })
      .click();
    await preview();
    await expect(page.locator(".panorama canvas")).toBeVisible();
    await expect(page.locator(".panorama-note")).toContainText(
      "Перемещение отключено",
    );
    const camera = page.getByLabel("Панорама 360 градусов", { exact: true });
    const heading = Number(await camera.getAttribute("data-heading"));
    await camera.press("ArrowRight");
    await expect(camera).toHaveAttribute(
      "data-heading",
      String((heading + 8) % 360),
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.screenshot({
      path: "test-results/dev-panorama-preview.png",
      fullPage: true,
    });
  } finally {
    if (origin)
      await page.request.post(origin + "/api/logout", {
        data: { role: "host" },
      });
    await page.goto("about:blank");
    await dev.close();
  }
});
