import { PrismaClient } from "@prisma/client";
import { createApp } from "../dist/server/server/app.js";
import { expire } from "../dist/server/server/game.js";
const runtime = await createApp(new PrismaClient(), { legacyForTests: true });
// Only this isolated test launcher exposes clock advancement; production never imports it.
runtime.app.post("/api-test/expire", async (req, res) => {
  const supplied = req.get("x-test-secret");
  if (supplied !== process.env.SESSION_SECRET) return res.sendStatus(403);
  await runtime.store.serial(() =>
    runtime.store.mutate(() => {
      const s = runtime.store.state;
      if (s.timer.deadline === null) throw Error("Нет таймера");
      expire(s, s.timer.deadline);
      return "Тест: истечение серверного таймера";
    }),
  );
  res.json({ ok: true });
});
runtime.http.listen(Number(process.env.PORT), "127.0.0.1");
process.on("SIGTERM", () => {
  void runtime.close();
});
