import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync, spawn } from "node:child_process";
mkdirSync("data", { recursive: true });
if (!existsSync(".env")) {
  const host = randomBytes(9).toString("base64url");
  const player = randomBytes(9).toString("base64url");
  writeFileSync(
    ".env",
    `HOST_PASSWORD=${host}\nPLAYER_PASSWORD=${player}\nDATABASE_URL=file:../data/quiz.db\nSESSION_SECRET=${randomBytes(48).toString("hex")}\nPORT=3001\n`,
  );
  console.log(
    "Создан локальный .env со случайными паролями. Посмотрите HOST_PASSWORD и PLAYER_PASSWORD в этом файле.",
  );
}
for (const args of [
  ["prisma", "generate"],
  ["prisma", "db", "push"],
]) {
  const r = spawnSync(
    process.execPath,
    args[1] === "generate"
      ? ["node_modules/prisma/build/index.js", "generate"]
      : ["scripts/database.mjs"],
    { stdio: "inherit" },
  );
  if (r.status) process.exit(r.status);
}
const child = spawn(
  process.execPath,
  [
    "node_modules/concurrently/dist/bin/concurrently.js",
    "-k",
    "-n",
    "server,client",
    "tsx watch server/index.ts",
    "vite --host 0.0.0.0",
  ],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 0));
