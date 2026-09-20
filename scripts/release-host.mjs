import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
try {
  const r = await db.session.deleteMany({ where: { role: "host" } });
  console.log("Удалено сессий ведущего: " + r.count + ". Партия сохранена.");
} finally {
  await db.$disconnect();
}
