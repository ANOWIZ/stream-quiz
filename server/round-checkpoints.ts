import type { GameState, RoundCheckpoint } from "../shared/types.js";

export function previousRoundCheckpoint(s: GameState) {
  if (
    s.phase === "lobby" ||
    s.roundIndex < 1 ||
    s.roundCheckpoint?.round !== s.round
  )
    return null;
  const round = s.config.roundOrder[s.roundIndex - 1];
  const checkpoint = s.roundCheckpoints[round];
  return checkpoint?.round === round ? checkpoint : null;
}

// Old saves keep only a limited phase history. Recover known checkpoints, never
// infer awards from score differences (which also contain manual corrections).
export function recoverRoundCheckpoints(
  state: GameState,
  history: GameState[],
) {
  const seen = new Map<number, RoundCheckpoint>();
  let changed = false;
  for (const s of [...history, state]) {
    s.roundCheckpoints ??= {};
    if (s.phase === "lobby") {
      seen.clear();
      continue;
    }
    for (const round of s.config.roundOrder.slice(0, s.roundIndex)) {
      const checkpoint = seen.get(round);
      if (!s.roundCheckpoints[round] && checkpoint) {
        s.roundCheckpoints[round] = structuredClone(checkpoint);
        changed = true;
      }
    }
    if (s.roundCheckpoint)
      seen.set(s.round, structuredClone(s.roundCheckpoint));
  }
  return changed;
}
