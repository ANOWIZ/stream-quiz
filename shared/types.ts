import type { LocalPanoramaSource } from "./panorama.js";
import type { Config } from "./config.js";
import type { MediaRef, Question, FinalQuestion, GeoPoint } from "./content.js";
import type { GamePackage, PackageSummary } from "./packages.js";
export type Role = "host" | "player";
export type Phase =
  | "lobby"
  | "intro"
  | "choosing"
  | "point"
  | "ranges"
  | "comparison"
  | "answering"
  | "awaitingReveal"
  | "studying"
  | "buzzing"
  | "judging"
  | "reveal"
  | "betting"
  | "loadingPanorama"
  | "locating"
  | "finished";
export interface Player {
  id: string;
  name: string;
  color: string;
  score: number;
  ready: boolean;
}
export interface Identity {
  role: Role;
  id: string;
  name: string;
  playerId?: string | null;
}
export interface Answer {
  value?: number;
  start?: number;
  width?: "narrow" | "wide";
  choice?: string;
  locked: boolean;
}
export interface Buzz {
  playerId: string;
  at: number;
  sequence: number;
  accepted: boolean;
}
export interface Timer {
  deadline: number | null;
  remaining: number | null;
}
export interface VideoState {
  status: "playing" | "paused" | "stopped";
  offset: number;
  changedAt: number;
}
export interface GameState {
  roundEpoch: string | null;
  roundCheckpoint: {
    round: number;
    used: string[];
    boardIds: string[];
    order: string[];
    roster: string[];
    turn: number;
    awards: Record<string, number>;
  } | null;
  selectedPackageId: string | null;
  packageSnapshot: GamePackage | null;
  publicIds: Record<string, string>;
  mediaTokens: Record<string, string>;
  questionPublicId: string | null;
  panoramaReady: Record<string, boolean>;
  panoramaErrors: Record<string, string>;
  panoramaExcluded: string[];
  decisionToken: string | null;
  lastDecision: {
    questionId: string;
    playerId: string;
    delta: number;
    blocked: string[];
    used: string[];
    token: string;
    buzzes: Buzz[];
  } | null;
  acceptedCommands: Record<string, true>;
  finalSelection: FinalQuestion | null;
  finalRandom: boolean;
  finalAttemptId: string | null;
  revision: number;
  boardIds: string[];
  phase: Phase;
  players: Player[];
  joinOpen: boolean;
  round: number;
  roundIndex: number;
  order: string[];
  roster: string[];
  turn: number;
  completed: number;
  total: number;
  used: string[];
  question: Question | null;
  answers: Record<string, Answer>;
  bets: Record<string, number>;
  countries: Record<string, CountryAnswer>;
  buzzes: Buzz[];
  blocked: string[];
  buzzWinner: string | null;
  timer: Timer;
  paused: boolean;
  resumeVideo?: boolean;
  video: VideoState;
  deltas: Record<string, number>;
  scoreBefore: Record<string, number>;
  config: Config;
}
export interface PublicQuestion {
  id: string;
  category: string;
  round: number;
  value: number;
  text?: string;
  media?: MediaRef;
  min?: number;
  max?: number;
  unit?: string;
  numericKind?: "number" | "percent";
  speaker?: string;
  work?: string;
  translated?: boolean;
  translationNote?: string;
  location?: GeoPoint;
  anchorText?: string;
  anchorDate?: import("./dates.js").EventDate;
  targetDate?: import("./dates.js").EventDate;
  options?: [string, string];
  answer?: number | string;
  explanation?: string;
  source?: string;
  alternatives?: string[];
  place?: string;
  panorama?: LocalPanoramaSource;
  author?: string;
  license?: string;
  licenseUrl?: string;
  studySeconds?: number;
}
export interface GameView {
  finalCorrect?: Record<string, boolean>;
  roundEpoch: string | null;
  undoDecisionToken?: string | null;
  selectedPackage?: PackageSummary | null;
  packages?: PackageSummary[];
  packageName?: string;
  panoramaReady: Record<string, boolean>;
  panoramaErrors: Record<string, string>;
  decisionToken: string | null;
  canUndoDecision?: boolean;
  finalSelection?: FinalQuestion | null;
  finalRandom?: boolean;
  finalAttemptId: string | null;
  revision: number;
  serverNow: number;
  clientReceivedAt?: number;
  phase: Phase;
  round: number;
  roundIndex: number;
  players: (Player & {
    connected: boolean;
    answered: boolean;
    betDone: boolean;
    countryDone: boolean;
  })[];
  self: Identity;
  joinOpen: boolean;
  activePlayerId: string | null;
  order: string[];
  roster: string[];
  completed: number;
  total: number;
  question: PublicQuestion | null;
  board: { id: string; category: string; value: number; used: boolean }[];
  answers: Record<string, Answer>;
  bets: Record<string, number>;
  countries: Record<string, CountryAnswer>;
  timer: Timer;
  paused: boolean;
  buzzWinner: string | null;
  blocked: string[];
  buzzes: Buzz[];
  video: VideoState;
  config: Config;
  deltas: Record<string, number>;
  events: { id: number; message: string; at: string }[];
  warnings: string[];
  judgingGuide?: { answer: string; alternatives: string[] };
}
export interface Command {
  type: string;
  value?: unknown;
  questionId?: string;
}
export interface Envelope {
  roundEpoch?: string | null;
  undoDecisionToken?: string | null;
  decisionToken?: string | null;
  finalAttemptId?: string | null;
  id: string;
  revision: number;
  phase?: Phase;
  buzzWinner?: string | null;
  command: Command;
}
export interface CountryAnswer {
  code: string | null;
  point?: GeoPoint;
  locked: boolean;
}
export interface Ack {
  ok: boolean;
  error?: string;
}
