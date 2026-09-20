import "dotenv/config";
import { mkdirSync, existsSync, closeSync, openSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
const url = process.env.DATABASE_URL || "file:../data/quiz.db";
if (!url.startsWith("file:"))
  throw Error("DATABASE_URL должен указывать SQLite file:");
const path = resolve("prisma", url.slice(5));
mkdirSync(dirname(path), { recursive: true });
if (!existsSync(path)) closeSync(openSync(path, "wx"));
const result = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push"],
  { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } },
);
process.exit(result.status ?? 1);
