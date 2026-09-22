import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { Role, Identity } from "../shared/types.js";
import type { Store } from "./store.js";
import { joinPlayer, requireRule } from "./game.js";
export const cookieName = (role: Role) => "ston_" + role;
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const same = (a: string, b: string) =>
  timingSafeEqual(
    createHash("sha256").update(a).digest(),
    createHash("sha256").update(b).digest(),
  );
export async function identity(
  store: Store,
  token: unknown,
  role: Role,
): Promise<Identity | null> {
  if (typeof token !== "string") return null;
  const s = await store.db.session.findUnique({
    where: { id: tokenHash(token) },
  });
  if (!s || s.role !== role || s.expiresAt.getTime() < Date.now()) return null;
  if (
    role === "player" &&
    !store.state.players.some((p) => p.id === s.playerId)
  )
    return null;
  return {
    id: s.id,
    role,
    name: store.state.players.find((p) => p.id === s.playerId)?.name ?? s.name,
    playerId: s.playerId,
  };
}
export async function login(store: Store, req: Request, res: Response) {
  const { role, name, password } = req.body as {
    role: Role;
    name: string;
    password: string;
  };
  requireRule(role === "host" || role === "player", "Неизвестная роль");
  requireRule(
    typeof name === "string" &&
      name.trim().length > 0 &&
      name.trim().length <= 30,
    "Введите имя до 30 символов",
  );
  requireRule(
    typeof password === "string" && password.length <= 200,
    "Введите пароль",
  );
  const expected =
    role === "host" ? process.env.HOST_PASSWORD : process.env.PLAYER_PASSWORD;
  requireRule(expected && same(password, expected), "Неверный пароль");
  const existing = await identity(
    store,
    req.signedCookies[cookieName(role)],
    role,
  );
  if (existing) return res.json({ self: existing });
  const token = randomBytes(32).toString("base64url");
  const id = tokenHash(token);
  await store.serial(() =>
    store.mutate(async () => {
      if (role === "host") {
        const host = await store.db.session.findFirst({
          where: { role: "host", expiresAt: { gt: new Date() } },
        });
        requireRule(
          !host,
          "Ведущий уже вошёл. Используйте его вкладку или завершите его сессию.",
        );
      }
      const player = role === "player" ? joinPlayer(store.state, name) : null;
      await store.db.session.create({
        data: {
          id,
          role,
          name: name.trim(),
          playerId: player?.id,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
      return role === "host" ? "Ведущий вошёл" : name.trim() + " вошёл в лобби";
    }, false),
  );
  res.cookie(cookieName(role), token, {
    httpOnly: true,
    signed: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 86400000,
    path: "/",
  });
  res.json({ self: await identity(store, token, role) });
}
