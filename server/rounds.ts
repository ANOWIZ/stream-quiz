import { finalCommand, scoreFinal } from "./final.js";
import { buzzerCommand } from "./buzzer.js";
import { choiceCommand, scoreChoice } from "./choice.js";
import type { GameState, Identity, Command } from "../shared/types.js";
import { numericCommand, scoreNumeric } from "./round1.js";
import { scoreV2 } from "./rules-v2.js";
export function roundCommand(
  s: GameState,
  who: Identity,
  c: Command,
  now: number,
  receivedAt = now,
): string | null {
  return (
    numericCommand(s, who, c, now) ??
    choiceCommand(s, who, c, now) ??
    buzzerCommand(s, who, c, now, receivedAt) ??
    finalCommand(s, who, c, now)
  );
}
export function scoreQuestion(s: GameState): void {
  if (s.config.rulesVersion === 2) return scoreV2(s);
  scoreNumeric(s);
  scoreChoice(s);
  scoreFinal(s);
}
