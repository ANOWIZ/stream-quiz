import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";
const runtime = await createApp(new PrismaClient());
runtime.http.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
  console.log("Викторина: /host и /play • порт " + (process.env.PORT || 3001)),
);
process.on("SIGTERM", () => {
  void runtime.close();
});
