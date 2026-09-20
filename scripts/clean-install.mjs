import {
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
mkdirSync(".local", { recursive: true });
const dir = mkdtempSync(resolve(".local", "clean-install-"));
function copyTree(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name),
      to = join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}
for (const folder of [
  "client",
  "server",
  "shared",
  "scripts",
  "tests",
  "prisma",
  "public",
  "assets",
])
  copyTree(folder, join(dir, folder));
for (const file of readdirSync(".", { withFileTypes: true }).filter(
  (d) =>
    d.isFile() &&
    (!d.name.startsWith(".env") || d.name === ".env.example") &&
    !d.name.endsWith(".log"),
))
  copyFileSync(file.name, join(dir, file.name));
const cli = process.env.npm_execpath;
if (!cli) throw Error("Запускайте через npm run verify:clean");
const cache = resolve(".local/npm-cache");
for (const args of [
  ["ci", "--cache", cache, "--prefer-offline"],
  ["run", "db:generate"],
  ["run", "check"],
]) {
  console.log("Чистая установка: npm " + args[0] + " " + (args[1] ?? ""));
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: "file:../data/quiz.db" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync(
  ".local/clean-install-result.json",
  JSON.stringify(
    {
      ok: true,
      directory: dir,
      at: new Date().toISOString(),
      lockfileBytes: readFileSync(join(dir, "package-lock.json")).length,
    },
    null,
    2,
  ),
);
console.log("Чистая установка, сборка, тесты и HTTP smoke: OK. " + dir);
