import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { exportContentLibrary } from "../server/content-library.ts";

const db = new PrismaClient();
try {
  console.log(await exportContentLibrary(db));
} finally {
  await db.$disconnect();
}
