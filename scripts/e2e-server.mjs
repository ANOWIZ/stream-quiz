import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
mkdirSync(".local/e2e", { recursive: true });
const folder = mkdtempSync(resolve(".local/e2e", "run-"));
const file = join(folder, "quiz.db");
writeFileSync(file, "");
const credentials = {
  host: randomBytes(20).toString("hex"),
  player: randomBytes(20).toString("hex"),
};
writeFileSync(".local/e2e/credentials.json", JSON.stringify(credentials));
const testSecret = randomBytes(48).toString("hex");
writeFileSync(".local/e2e/clock-secret.txt", testSecret);
const env = {
  ...process.env,
  HOST_PASSWORD: credentials.host,
  PLAYER_PASSWORD: credentials.player,
  SESSION_SECRET: testSecret,
  DATABASE_URL: "file:" + file.replaceAll("\\", "/"),
  PORT: "4173",
  NODE_ENV: "test",
};
const db = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env, stdio: "inherit" },
);
if (db.status) process.exit(db.status);
const child = spawn(process.execPath, ["scripts/e2e-entry.mjs"], {
  env,
  stdio: "inherit",
});
process.on("SIGTERM", () => child.kill());
process.on("SIGINT", () => child.kill());
child.on("exit", (c) => process.exit(c ?? 0));
