import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
const dir = mkdtempSync(join(tmpdir(), "ston-smoke-"));
writeFileSync(join(dir, "test.db"), "");
const probe = createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const env = {
  ...process.env,
  DATABASE_URL: `file:${join(dir, "test.db").replaceAll("\\", "/")}`,
  HOST_PASSWORD: randomBytes(16).toString("hex"),
  PLAYER_PASSWORD: randomBytes(16).toString("hex"),
  SESSION_SECRET: randomBytes(48).toString("hex"),
  PORT: String(port),
  NODE_ENV: "test",
};
const db = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env, encoding: "utf8" },
);
if (db.status) throw new Error(db.stderr + db.stdout);
const child = spawn(process.execPath, ["dist/server/server/index.js"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (b) => {
  output += b;
});
child.stderr.on("data", (b) => {
  output += b;
});
try {
  let ok = false;
  for (let n = 0; n < 60; n++) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`);
      if (r.ok) {
        ok = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ok) throw new Error(output);
  for (const path of ["/host", "/play"]) {
    const r = await fetch(`http://localhost:${port}${path}`);
    const html = await r.text();
    if (!r.ok || !html.includes("root"))
      throw new Error(`Не открывается ${path}`);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(
      (m) => m[1],
    );
    if (!assets.length)
      throw new Error("Ссылки на production assets не найдены");
    for (const asset of [...assets, "/world.json"]) {
      const response = await fetch(`http://localhost:${port}${asset}`);
      if (!response.ok) throw new Error(`Не загружается ${asset}`);
    }
  }
  console.log("Smoke: сервер, SQLite, /host и /play доступны.");
} finally {
  child.kill();
  await new Promise((r) => child.once("exit", r));
  rmSync(dir, { recursive: true, force: true });
}
