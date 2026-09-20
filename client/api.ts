import { isObs, isEditor } from "./surface.js";
import { io } from "socket.io-client";
import type {
  Ack,
  Command,
  GameView,
  Identity,
  Role,
} from "../shared/types.js";
export const role: Role =
  location.pathname.startsWith("/host") || isEditor || isObs
    ? "host"
    : "player";
export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const res = await fetch("/api/" + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Ошибка запроса");
  return data as T;
}
export const socket = io({
  autoConnect: false,
  auth: { role, ...(isObs ? { surface: "obs" } : {}) },
});
let current: GameView | null = null;
socket.on("state", (s: GameView) => {
  s.clientReceivedAt = Date.now();
  current = s;
});
const pending = new Set<string>();
export async function command(c: Command): Promise<void> {
  if (!socket.connected) throw new Error("Нет связи с сервером");
  const key = (current?.question?.id ?? "lobby") + ":" + c.type;
  if (c.type !== "range" && pending.has(key)) return;
  pending.add(key);
  try {
    const ack: Ack = await socket.timeout(7000).emitWithAck("command", {
      id: crypto.randomUUID(),
      revision: current?.revision ?? 0,
      phase: current?.phase,
      finalAttemptId: current?.finalAttemptId,
      buzzWinner: current?.buzzWinner,
      decisionToken: current?.decisionToken,
      undoDecisionToken: current?.undoDecisionToken,
      roundEpoch: current?.roundEpoch,
      command: { ...c, questionId: current?.question?.id },
    });
    if (!ack.ok) throw new Error(ack.error);
  } finally {
    pending.delete(key);
  }
}
export type Session = { self: Identity };
