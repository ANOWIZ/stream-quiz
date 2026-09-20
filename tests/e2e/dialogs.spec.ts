import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

test("подтверждение удаления остаётся внутри игры: отмена, Escape, фокус и телефон", async ({
  page,
}) => {
  const credentials = JSON.parse(
    readFileSync(".local/e2e/credentials.json", "utf8"),
  );
  const native: string[] = [];
  page.on("dialog", (dialog) => {
    native.push(dialog.message());
    void dialog.dismiss();
  });
  expect(
    (
      await page.request.post("/api/login", {
        data: {
          role: "host",
          name: "Проверка диалогов",
          password: credentials.host,
        },
      })
    ).ok(),
  ).toBe(true);
  const id = "dialog-test-" + randomUUID();
  const question = {
    id,
    round: 1,
    category: "Проверка окна",
    text: "Удаляемый вопрос для проверки подтверждения внутри игры — длинный текст должен переноситься и на телефоне.",
    answer: 5,
    min: 0,
    max: 10,
    unit: "",
    explanation: "Тест",
    source: "Тест интерфейса",
  };
  try {
    expect(
      (
        await page.request.post("/api/editor/questions", { data: question })
      ).ok(),
    ).toBe(true);
    await page.goto("/host?mode=questions");
    await page.getByLabel("Поиск вопросов").fill(id);
    const trigger = page.getByRole("button", {
      name: "Удалить " + id,
      exact: true,
    });
    const dialog = page.getByRole("dialog", {
      name: "Удалить вопрос?",
      exact: true,
    });
    const deleted: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "DELETE" && request.url().endsWith(id))
        deleted.push(request.url());
    });
    for (const width of [1920, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1080 });
      await trigger.click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(question.text);
      await expect(
        dialog.getByRole("button", { name: "Отмена", exact: true }),
      ).toBeFocused();
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Tab");
        expect(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
        ).toBe(true);
      }
      expect(
        await dialog
          .locator(".game-dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: `test-results/game-dialog-${width}.png`,
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(trigger).toBeVisible();
      expect(deleted).toEqual([]);
    }
    await trigger.click();
    const other = await page.context().newPage();
    await other.goto("/host?mode=categories");
    await expect(
      other.getByRole("heading", { name: "Категории", exact: true }),
    ).toBeVisible();
    await expect(other.locator(".game-dialog-overlay")).toHaveCount(0);
    await other.close();
    await dialog.getByRole("button", { name: "Удалить", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toHaveCount(0);
    expect(deleted).toHaveLength(1);
    const data = await (await page.request.get("/api/editor")).json();
    expect(data.questions.some((q: { id: string }) => q.id === id)).toBe(false);
    expect(native).toEqual([]);
  } finally {
    await page.request.delete("/api/editor/questions/" + id);
    await page.request.post("/api/logout", { data: { role: "host" } });
  }
});
