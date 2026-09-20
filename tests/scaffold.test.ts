import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
describe("каркас", () => {
  it("содержит две точки входа и безопасный env-шаблон", () => {
    const env = readFileSync(".env.example", "utf8");
    expect(env).toContain("HOST_PASSWORD=\n");
    expect(env).toContain("PLAYER_PASSWORD=\n");
    expect(readFileSync("index.html", "utf8")).toContain('lang="ru"');
  });
});
