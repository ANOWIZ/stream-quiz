import { useEffect, useRef } from "react";
import type { GameView } from "../shared/types.js";
let context: AudioContext | null = null;
export function unlockSound() {
  context ??= new AudioContext();
  void context.resume();
}
function beep(notes: number[], duration = 0.09) {
  if (!context) return;
  let at = context.currentTime;
  for (const frequency of notes) {
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.06, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(context.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
    at += duration;
  }
}
export function useSounds(
  enabled: boolean,
  v: GameView,
  remaining: number | null,
) {
  useEffect(() => {
    if (!enabled) return;
    const unlock = () => unlockSound();
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, [enabled]);
  const last = useRef<{
    question?: string;
    phase: string;
    winner: string | null;
    delta: string;
  }>({ phase: v.phase, winner: v.buzzWinner, delta: JSON.stringify(v.deltas) });
  useEffect(() => {
    const old = last.current;
    if (enabled) {
      if (v.phase === "finished" && old.phase !== "finished")
        beep([523, 659, 784, 1047], 0.15);
      else if (v.phase === "reveal" && old.phase !== "reveal")
        beep(
          [
            ...(Object.values(v.deltas).some((n) => n > 0)
              ? [659, 880]
              : Object.values(v.deltas).some((n) => n < 0)
                ? [220, 164]
                : []),
            440,
            660,
            880,
          ],
          0.1,
        );
      else if (v.buzzWinner && v.buzzWinner !== old.winner)
        beep([880, 660], 0.06);
      else if (
        JSON.stringify(v.deltas) !== old.delta &&
        Object.values(v.deltas).length
      )
        beep(
          Object.values(v.deltas).some((n) => n < 0) ? [220, 164] : [659, 880],
          0.12,
        );
      else if (v.question?.id && v.question.id !== old.question)
        beep([392, 523], 0.1);
    }
    last.current = {
      question: v.question?.id,
      phase: v.phase,
      winner: v.buzzWinner,
      delta: JSON.stringify(v.deltas),
    };
  }, [v, enabled]);
  useEffect(() => {
    if (
      enabled &&
      !v.paused &&
      remaining !== null &&
      remaining > 0 &&
      remaining <= 5
    )
      beep([880], 0.06);
  }, [remaining, enabled, v.paused]);
}
