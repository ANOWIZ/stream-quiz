import type { Question } from "./content.js";
import type { Config } from "./config.js";
import type { QuestionDraft, PackageSummary } from "./packages.js";
export interface CategoryRow {
  id: string;
  name: string;
  round: number;
}
export interface MediaRow {
  id: string;
  filename: string;
  mime: string;
  size: number;
  originalName: string;
}
export interface EditorData {
  drafts: QuestionDraft[];
  packages: PackageSummary[];
  questions: Question[];
  categories: CategoryRow[];
  media: MediaRow[];
  config: Config;
  used: string[];
  locked: string[];
  warnings: string[];
  panoramaUsage: Record<string, string>;
}
