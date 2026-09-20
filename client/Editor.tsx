import { useDialogs } from "./Dialogs.js";
import { CropEditor } from "./CropEditor.js";
import { formatEventDate, type EventDate } from "../shared/dates.js";
import { Comparison } from "./Comparison.js";
import { PackageEditor } from "./PackageEditor.js";
import type { ImageCrop, GeoPoint } from "../shared/content.js";
import {
  defaultPanoramaCamera,
  type PanoramaCamera,
} from "../shared/panorama.js";
import type { FinalQuestion } from "../shared/content.js";
import { publicError } from "../shared/errors.js";
import { useEffect, useState, useRef, type FormEvent } from "react";
import {
  Plus,
  Search,
  Copy,
  Trash2,
  Download,
  Upload,
  Eye,
  Save,
  ArrowLeft,
  ExternalLink,
} from "lucide-react";
import { api, socket } from "./api.js";
import type {
  EditorData,
  MediaRow,
  CategoryRow,
} from "../shared/editor-types.js";
import {
  questionSchema,
  type Question,
  type MediaRef,
} from "../shared/content.js";
import { Media } from "./Media.js";
import { SettingsForm } from "./SettingsForm.js";
export type HostMode =
  "game" | "questions" | "categories" | "media" | "settings" | "packages";
type Draft = {
  formatVersion?: 2;
  numericKind?: "number" | "percent";
  speaker?: string;
  work?: string;
  translated?: boolean;
  translationNote?: string;
  verified?: boolean;
  fullImageFileId?: string;
  suppliedFragment?: boolean;
  crop?: ImageCrop;
  location?: GeoPoint;
  id: string;
  round: number;
  category: string;
  text: string;
  answer: string;
  explanation: string;
  source: string;
  active: boolean;
  position: number;
  value: number;
  difficulty: number;
  alternatives: string;
  min: number;
  max: number;
  unit: string;
  anchorText: string;
  anchorDate: EventDate;
  targetDate: EventDate;
  optionA: string;
  optionB: string;
  studySeconds: string;
  place: string;
  camera?: PanoramaCamera;
  panoramaFileId?: string;
  title?: string;
  author?: string;
  license?: string;
  licenseUrl?: string;
  mediaKind: "image" | "video" | "youtube";
  fileId: string;
  url: string;
  alt: string;
  start: number;
  end: string;
  muted: boolean;
  autoplay: boolean;
};
function blank(): Draft {
  return {
    formatVersion: 2,
    id: crypto.randomUUID(),
    round: 1,
    category: "",
    text: "",
    answer: "",
    explanation: "",
    source: "",
    active: true,
    position: 0,
    value: 100,
    difficulty: 1,
    alternatives: "",
    min: 0,
    max: 100,
    unit: "",
    anchorText: "",
    anchorDate: 2000,
    targetDate: 2001,
    optionA: "",
    optionB: "",
    studySeconds: "",
    place: "",
    mediaKind: "image",
    fileId: "",
    url: "",
    alt: "",
    start: 0,
    end: "",
    muted: true,
    autoplay: false,
  };
}
function fromQuestion(q: Question): Draft {
  const d = {
    ...blank(),
    ...q,
    answer: String(q.answer),
    alternatives: q.alternatives.join("\n"),
  } as Draft;
  if (q.round === 3) {
    d.optionA = q.options[0];
    d.optionB = q.options[1];
  }
  if (q.round === 5) d.studySeconds = q.studySeconds?.toString() ?? "";
  if (q.media) {
    d.mediaKind = q.media.kind;
    d.fileId = q.media.fileId ?? "";
    d.url = q.media.url ?? "";
    d.alt = q.media.alt;
    d.start = q.media.start;
    d.end = q.media.end?.toString() ?? "";
    d.muted = q.media.muted;
    d.autoplay = q.media.autoplay;
  }
  return d;
}
function mediaFromDraft(d: Draft): MediaRef | undefined {
  return !d.fileId && !d.url
    ? undefined
    : {
        kind: d.mediaKind,
        ...(d.fileId ? { fileId: d.fileId } : { url: d.url }),
        alt: d.alt,
        start: d.start,
        end: d.end ? Number(d.end) : undefined,
        muted: d.muted,
        autoplay: d.autoplay,
      };
}
function questionFromDraft(d: Draft): Question {
  if (d.round === 1 && !String(d.answer).trim())
    throw Error("Введите правильный числовой ответ");
  return questionSchema.parse({
    ...d,
    answer: d.round === 1 ? Number(d.answer) : d.answer,
    anchorDate: /^-?\d+$/.test(String(d.anchorDate))
      ? Number(d.anchorDate)
      : d.anchorDate,
    targetDate: /^-?\d+$/.test(String(d.targetDate))
      ? Number(d.targetDate)
      : d.targetDate,
    ...(d.numericKind === "percent" && d.round === 1
      ? { min: 0, max: 100, unit: "%" }
      : {}),
    alternatives: d.alternatives
      .split("\n")
      .map((v) => v.trim())
      .filter(Boolean),
    media: mediaFromDraft(d),
    options: [d.optionA, d.optionB],
    studySeconds: d.studySeconds ? Number(d.studySeconds) : undefined,
  });
}
async function upload(file: File): Promise<MediaRow> {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api/editor/media", { method: "POST", body: form });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
export function Editor({
  mode,
  report,
  openPanorama,
}: {
  mode: Exclude<HostMode, "game">;
  report: (s: string) => void;
  openPanorama: (q: FinalQuestion) => void;
}) {
  const { showMessage, confirmAction } = useDialogs();
  const [data, setData] = useState<EditorData | null>(null);
  const [filter, setFilter] = useState("");
  const [round, setRound] = useState("");
  const [category, setCategory] = useState("");
  const [value, setValue] = useState("");
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (draft?.round === 6) {
      openPanorama({
        ...draft,
        round: 6,
        title: draft.title || draft.text,
        alternatives: [],
        media: undefined,
        camera: draft.camera ?? { ...defaultPanoramaCamera },
      });
      sessionStorage.removeItem("ston-host-draft");
    }
  }, [draft, openPanorama]);
  const [preview, setPreview] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftPending = useRef<Promise<unknown>>(Promise.resolve());
  const refresh = async () => {
    try {
      setData(await api<EditorData>("editor"));
    } catch (e) {
      report(publicError(e));
    }
  };
  useEffect(() => {
    void refresh();
    let last = "";
    const state = (v: {
      phase: string;
      question?: { id: string } | null;
      config: EditorData["config"];
    }) => {
      const key =
        v.phase +
        "|" +
        v.question?.id +
        "|" +
        JSON.stringify(v.config.roundNames);
      if (key !== last) {
        last = key;
        void refresh();
      }
    };
    socket.on("state", state);
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      socket.off("state", state);
      window.removeEventListener("focus", focus);
    };
  }, [mode]);
  useEffect(() => {
    if (!draft) return;
    if (draft.round === 6) return;
    sessionStorage.setItem("ston-host-draft", JSON.stringify(draft));
    sessionStorage.setItem(
      "ston-host-draft:" + draft.id,
      JSON.stringify(draft),
    );
    setDraftSaved(false);
    const timer = setTimeout(() => {
      draftPending.current = draftPending.current
        .then(() => api("editor/drafts", draft))
        .then(() => setDraftSaved(true))
        .catch((e) => report(publicError(e)));
    }, 700);
    draftTimer.current = timer;
    return () => clearTimeout(timer);
  }, [draft]);
  const run = async (fn: () => Promise<unknown>, message = "Сохранено") => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      setNotice(message);
      return true;
    } catch (e) {
      report(publicError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const change = <K extends keyof Draft>(key: K, val: Draft[K]) => {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, [key]: val };
      sessionStorage.setItem("ston-host-draft", JSON.stringify(next));
      sessionStorage.setItem(
        "ston-host-draft:" + next.id,
        JSON.stringify(next),
      );
      return next;
    });
    setDraftSaved(false);
  };
  const input = (key: keyof Draft, label: string, type = "text") => (
    <label>
      {label}
      <input
        type={type}
        step={
          type === "number"
            ? [
                "position",
                "value",
                "difficulty",
                "anchorDate",
                "targetDate",
              ].includes(key)
              ? 1
              : "any"
            : undefined
        }
        value={String(draft?.[key] ?? "")}
        onChange={(e) =>
          change(
            key,
            type === "number" &&
              !["answer", "studySeconds", "end"].includes(key)
              ? Number(e.target.value)
              : e.target.value,
          )
        }
      />
    </label>
  );
  const area = (key: keyof Draft, label: string) => (
    <label>
      {label}
      <textarea
        aria-label={label}
        rows={3}
        value={String(draft?.[key] ?? "")}
        onChange={(e) => change(key, e.target.value)}
      />
    </label>
  );
  if (!data)
    return (
      <main id="ed" className="editor">
        <p>Загружаем редактор…</p>
      </main>
    );
  const rows = data.questions
    .filter(
      (q) =>
        (!round || q.round === Number(round)) &&
        (!category || q.category === category) &&
        (!value || q.value === Number(value)) &&
        (!status ||
          (status === "active"
            ? q.active
            : status === "inactive"
              ? !q.active
              : data.used.includes(q.id))) &&
        (!filter ||
          (q.text + " " + q.category + " " + q.id)
            .toLocaleLowerCase("ru")
            .includes(filter.toLocaleLowerCase("ru"))),
    )
    .sort((a, b) => a.round - b.round || a.position - b.position);
  const isLocked = !!draft && data.locked.includes(draft.id);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    let q: Question;
    try {
      q = questionFromDraft(draft);
    } catch (e) {
      report(publicError(e));
      return;
    }
    if (
      await run(async () => {
        await draftPending.current;
        return api("editor/questions", { ...q, autoPlacement: true });
      }, "Вопрос опубликован")
    ) {
      sessionStorage.removeItem("ston-host-draft");
      sessionStorage.removeItem("ston-host-draft:" + draft.id);
      setDraft(null);
    }
  }
  return (
    <main id="ed" className="editor">
      <div className="editor-heading ed-head">
        <div>
          <a className="ed-note" href="/host">
            ← к пульту
          </a>
          <h1>
            {
              (
                {
                  questions: "Редактор вопросов",
                  categories: "Категории",
                  media: "Медиафайлы",
                  settings: "Настройки",
                  packages: "Игровые пакеты",
                } as const
              )[mode]
            }
          </h1>
        </div>
        <a
          className="button-link"
          href={"/host?mode=" + mode}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={16} /> В новой вкладке
        </a>
      </div>
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      {mode === "questions" && !draft && (
        <>
          <div className="editor-actions">
            <button
              className="primary"
              onClick={() => {
                setDraft(blank());
                setPreview(false);
              }}
            >
              <Plus size={18} />
              Новый вопрос
            </button>
            <a className="button-link" href="/api/editor/export" download>
              <Download size={17} />
              Экспорт JSON
            </a>
            <label
              className="button-link upload-label"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.currentTarget.querySelector("input")?.click();
                }
              }}
            >
              <Upload size={17} />
              Импорт JSON
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void run(async () => {
                      if (file.size > 10 * 1024 * 1024)
                        throw Error("JSON больше 10 МБ");
                      await api("editor/import", JSON.parse(await file.text()));
                    }, "Импорт завершён");
                  e.target.value = "";
                }}
              />
            </label>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api<{ name: string }>(
                    "editor/backup",
                    {},
                  );
                  await showMessage(
                    "Резервная копия сохранена на сервере: backups/" +
                      result.name,
                  );
                }, "Резервная копия создана")
              }
            >
              Резервная копия
            </button>
            {sessionStorage.getItem("ston-host-draft") && (
              <button
                onClick={() => {
                  try {
                    setDraft(
                      JSON.parse(
                        sessionStorage.getItem("ston-host-draft")!,
                      ) as Draft,
                    );
                  } catch {
                    sessionStorage.removeItem("ston-host-draft");
                  }
                }}
              >
                Восстановить черновик
              </button>
            )}
          </div>
          <details className="draft-list">
            <summary>Сохранённые черновики</summary>
            {data.drafts
              .filter((d) => d.round !== 6)
              .map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setDraft({ ...blank(), ...d } as Draft);
                    setPreview(false);
                  }}
                >
                  {d.text || "Без названия"} · {data.config.roundNames[d.round]}
                </button>
              ))}
            {Object.keys(sessionStorage)
              .filter((k) => k.startsWith("ston-host-draft:"))
              .map((key) => {
                const d = JSON.parse(sessionStorage.getItem(key)!) as Draft;
                return (
                  <button
                    key={key}
                    onClick={() => {
                      setDraft(d);
                      setPreview(false);
                    }}
                  >
                    {d.text || "Без названия"} ·{" "}
                    {data.config.roundNames[d.round]}
                  </button>
                );
              })}
          </details>
          <p className="ed-legend">
            Черновик сохраняется автоматически на сервере. Для публикации
            нажмите «Сохранить вопрос».
          </p>
          <div id="rtabs" className="rtabs" aria-label="Раунды вопросов">
            {[
              ["", "Все раунды"],
              ...Object.entries(data.config.roundNames),
            ].map(([n, label]) => (
              <button
                key={n}
                className={"rtab" + (round === n ? " active" : "")}
                aria-pressed={round === n}
                onClick={() => {
                  setRound(n);
                  setCategory("");
                }}
              >
                {n ? n + ". " + label : label}
              </button>
            ))}
          </div>
          <div className="editor-filters">
            <label className="search-field">
              <Search size={18} />
              <input
                aria-label="Поиск вопросов"
                placeholder="Найти вопрос…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </label>
            <select
              aria-label="Фильтр по раунду"
              value={round}
              onChange={(e) => {
                setRound(e.target.value);
                setCategory("");
              }}
            >
              <option value="">Все раунды</option>
              {Object.entries(data.config.roundNames).map(([n, label]) => (
                <option key={n} value={n}>
                  {n}. {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Фильтр по категории"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Все категории</option>
              {[
                ...new Set(
                  data.questions
                    .filter((q) => !round || q.round === Number(round))
                    .map((q) => q.category),
                ),
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select
              aria-label="Фильтр по стоимости"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="">Все стоимости</option>
              {data.config.boardValues.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
            <select
              aria-label="Фильтр по статусу"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Все статусы</option>
              <option value="active">Активные</option>
              <option value="inactive">Отключённые</option>
              <option value="used">Использованные</option>
            </select>
          </div>
          {selected.length > 0 && (
            <div className="bulk-bar">
              <span>Выбрано: {selected.length}</span>
              <button
                onClick={() =>
                  void run(() =>
                    api("editor/bulk", { ids: selected, active: true }),
                  )
                }
              >
                Включить
              </button>
              <button
                onClick={() =>
                  void run(() =>
                    api("editor/bulk", { ids: selected, active: false }),
                  )
                }
              >
                Отключить
              </button>
              <button onClick={() => setSelected([])}>Снять выбор</button>
            </div>
          )}
          <label className="check-label select-all">
            {" "}
            <input
              type="checkbox"
              aria-label="Выбрать все вопросы"
              checked={
                rows.length > 0 && rows.every((q) => selected.includes(q.id))
              }
              onChange={(e) =>
                setSelected(e.target.checked ? rows.map((q) => q.id) : [])
              }
            />
            Выбрать все вопросы
          </label>
          <div id="rounds">
            {[
              ...new Set(
                rows.map((q) => JSON.stringify([q.round, q.category])),
              ),
            ].map((key) => {
              const [roundNumber, categoryName] = JSON.parse(key) as [
                number,
                string,
              ];
              return (
                <section
                  className="theme"
                  data-round={roundNumber}
                  data-category={categoryName}
                  key={key}
                >
                  <div className="theme-head">
                    <h2>{categoryName}</h2>
                    <span className="ed-note">
                      {data.config.roundNames[roundNumber]}
                    </span>
                    <button
                      className="mini"
                      onClick={() => {
                        setDraft({
                          ...blank(),
                          round: roundNumber,
                          category: categoryName,
                        });
                        setPreview(false);
                      }}
                    >
                      ＋ вопрос
                    </button>
                  </div>
                  {rows
                    .filter(
                      (q) =>
                        q.round === roundNumber && q.category === categoryName,
                    )
                    .map((q) => (
                      <article className="q" key={q.id} data-question-id={q.id}>
                        <div className="q-top">
                          <input
                            type="checkbox"
                            aria-label={"Выбрать " + q.id}
                            checked={selected.includes(q.id)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, q.id]
                                  : selected.filter((id) => id !== q.id),
                              )
                            }
                          />
                          <strong className="price">{q.value}</strong>
                          <span className="spacer" />
                          <div className="question-status">
                            <span
                              className={
                                q.active ? "status-dot" : "status-dot inactive"
                              }
                            >
                              {q.active ? "Активен" : "Отключён"}
                            </span>
                            {data.used.includes(q.id) && (
                              <small>Уже использован</small>
                            )}
                            {data.locked.includes(q.id) && (
                              <small>🔒 В игре</small>
                            )}
                          </div>
                          <div className="row-actions">
                            <button
                              aria-label={"Дублировать " + q.id}
                              onClick={() => {
                                setDraft({
                                  ...fromQuestion(q),
                                  id: crypto.randomUUID(),
                                  position: q.position + 1,
                                });
                                setPreview(false);
                              }}
                            >
                              <Copy size={16} />
                            </button>
                            <button
                              aria-label={"Удалить " + q.id}
                              disabled={data.locked.includes(q.id)}
                              onClick={async () => {
                                if (
                                  await confirmAction(
                                    "Удалить вопрос «" + q.text + "»?",
                                    {
                                      title: "Удалить вопрос?",
                                      confirmLabel: "Удалить",
                                    },
                                  )
                                )
                                  void run(() =>
                                    api(
                                      "editor/questions/" + q.id,
                                      undefined,
                                      "DELETE",
                                    ),
                                  );
                              }}
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>

                        <button
                          className="question-link"
                          onClick={() => {
                            setDraft(fromQuestion(q));
                            setPreview(false);
                          }}
                        >
                          {q.text}
                        </button>
                        <small>
                          #{q.position} · {q.id}
                        </small>
                      </article>
                    ))}
                </section>
              );
            })}
            {rows.length === 0 && (
              <p className="empty-message">По этим фильтрам вопросов нет.</p>
            )}
          </div>
          <p className="muted">
            {rows.length} из {data.questions.length} вопросов · Учебные примеры
            можно заменить своими.
          </p>
        </>
      )}
      {mode === "questions" && draft && (
        <form onSubmit={(e) => void save(e)} className="question-form theme">
          <div className="form-toolbar theme-head">
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setPreview(false);
              }}
            >
              <ArrowLeft size={17} />К списку
            </button>
            <span className="muted">
              {draftSaved
                ? "Черновик сохранён на сервере"
                : "Сохраняем черновик…"}
            </span>
            <button type="button" onClick={() => setPreview(!preview)}>
              <Eye size={17} />
              {preview ? "Вернуться к форме" : "Предпросмотр"}
            </button>
            <button
              className="primary"
              type="submit"
              disabled={busy || isLocked}
            >
              <Save size={17} />
              Сохранить вопрос
            </button>
          </div>
          {isLocked && (
            <p className="notice">
              Вопрос сейчас показывается игрокам или закреплён на поле текущего
              раунда. Редактирование заблокировано до завершения показа или
              раунда.
            </p>
          )}
          {preview ? (
            <div className="content-preview">
              <p className="eyebrow">
                {data.config.roundNames[draft.round]} ·{" "}
                {draft.round === 5 && data.config.rulesVersion === 2
                  ? "Задание на память"
                  : draft.category}
              </p>
              <h2>{draft.round === 5 ? "Запомните кадр" : draft.text}</h2>
              {mediaFromDraft(draft) && (
                <Media media={mediaFromDraft(draft)!} preview />
              )}
              {draft.round === 1 && data.config.rulesVersion === 2 && (
                <Comparison
                  act={() => {}}
                  v={{
                    question: {
                      id: draft.id,
                      round: 1,
                      category: draft.category,
                      value: 0,
                      min: draft.min,
                      max: draft.max,
                      unit: draft.unit,
                      numericKind: draft.numericKind,
                    },
                    self: { id: "preview", role: "host", name: "Предпросмотр" },
                    players: [],
                    answers: {},
                    activePlayerId: null,
                    roster: [],
                    paused: false,
                    phase: "point",
                    config: data.config,
                    deltas: {},
                  }}
                />
              )}
              {draft.round === 1 && data.config.rulesVersion !== 2 && (
                <div className="preview-scale">
                  {draft.min} {draft.unit}
                  <div />
                  {draft.max} {draft.unit}
                </div>
              )}
              {draft.round === 2 && (
                <div className="anchor-event">
                  <strong>{draft.anchorText}</strong>
                  {data.config.rulesVersion !== 2 && (
                    <b>{formatEventDate(draft.anchorDate)}</b>
                  )}
                </div>
              )}
              {draft.round === 3 && (
                <div className="choice-buttons">
                  <button type="button">{draft.optionA}</button>
                  <button type="button">{draft.optionB}</button>
                </div>
              )}
              <details>
                <summary>После раскрытия</summary>
                {draft.round === 5 && <h3>{draft.text}</h3>}
                {draft.round === 4 && draft.fullImageFileId && (
                  <Media
                    media={{
                      kind: "image",
                      fileId: draft.fullImageFileId,
                      alt: draft.alt || "Полное изображение",
                      start: 0,
                      muted: true,
                      autoplay: false,
                    }}
                    preview
                  />
                )}
                {draft.round === 2 && (
                  <p>
                    {formatEventDate(draft.anchorDate)} ·{" "}
                    {formatEventDate(draft.targetDate)}
                  </p>
                )}
                {draft.round === 3 && (
                  <p>
                    {draft.speaker} · {draft.work}
                    {draft.translated ? " · " + draft.translationNote : ""}
                  </p>
                )}
                <h3>{draft.answer}</h3>
                <p>{draft.explanation}</p>
                <p className="muted">{draft.source}</p>
              </details>
            </div>
          ) : (
            <fieldset disabled={isLocked || busy}>
              <div className="form-grid q-grid">
                <section className="fld">
                  <h2>Основное</h2>
                  <label>
                    Раунд
                    <select
                      aria-label="Раунд"
                      value={draft.round}
                      onChange={(e) => {
                        change("round", Number(e.target.value));
                        change("answer", "");
                      }}
                    >
                      {Object.entries(data.config.roundNames).map(
                        ([n, label]) => (
                          <option key={n} value={n}>
                            {n}. {label}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    Категория
                    <input
                      list="category-options"
                      value={draft.category}
                      onChange={(e) => change("category", e.target.value)}
                      required
                    />
                    <datalist id="category-options">
                      {data.categories
                        .filter((c) => c.round === draft.round)
                        .map((c) => (
                          <option key={c.id} value={c.name} />
                        ))}
                    </datalist>
                  </label>
                  {area(
                    "text",
                    draft.round === 5
                      ? "Вопрос после просмотра изображения"
                      : "Текст вопроса",
                  )}
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={draft.active}
                      onChange={(e) => change("active", e.target.checked)}
                    />
                    Вопрос активен
                  </label>
                </section>
                <section className="fld">
                  <h2>Ответ и пояснение</h2>
                  {draft.round === 1 && (
                    <>
                      <label>
                        Тип шкалы
                        <select
                          value={
                            draft.numericKind ??
                            (draft.unit === "%" ? "percent" : "number")
                          }
                          onChange={(e) => {
                            change(
                              "numericKind",
                              e.target.value as "number" | "percent",
                            );
                            if (e.target.value === "percent") {
                              change("min", 0);
                              change("max", 100);
                              change("unit", "%");
                            }
                          }}
                        >
                          <option value="number">Число</option>
                          <option value="percent">Проценты, 0–100 %</option>
                        </select>
                      </label>
                      <div className="field-pair">
                        {input("min", "Минимум шкалы", "number")}
                        {input("max", "Максимум шкалы", "number")}
                      </div>
                      {input("unit", "Единица измерения")}
                      {input(
                        "answer",
                        "Правильное числовое значение",
                        "number",
                      )}
                    </>
                  )}
                  {draft.round === 2 && (
                    <>
                      {area("anchorText", "Опорное событие")}
                      <div className="field-pair">
                        {input(
                          "anchorDate",
                          "Дата опорного события (год или ГГГГ-ММ-ДД)",
                        )}
                        {input(
                          "targetDate",
                          "Дата второго события (год или ГГГГ-ММ-ДД)",
                        )}
                      </div>
                      <label>
                        Правильный ответ
                        <select
                          value={draft.answer}
                          onChange={(e) => change("answer", e.target.value)}
                        >
                          <option value="">Выберите</option>
                          <option value="before">До</option>
                          <option value="after">После</option>
                        </select>
                      </label>
                    </>
                  )}
                  {draft.round === 3 && (
                    <>
                      {input("speaker", "Автор или персонаж")}
                      {input("work", "Произведение или выступление")}
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={!!draft.verified}
                          onChange={(e) => change("verified", e.target.checked)}
                        />
                        Цитата проверена по источнику
                      </label>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={!!draft.translated}
                          onChange={(e) =>
                            change("translated", e.target.checked)
                          }
                        />
                        Цитата в переводе
                      </label>
                      {draft.translated &&
                        input("translationNote", "Сведения о переводе")}
                      {input("optionA", "Вариант А")}
                      {input("optionB", "Вариант Б")}
                      <label>
                        Правильная сторона
                        <select
                          value={draft.answer}
                          onChange={(e) => change("answer", e.target.value)}
                        >
                          <option value="">Выберите</option>
                          <option value="a">А</option>
                          <option value="b">Б</option>
                        </select>
                      </label>
                    </>
                  )}
                  {[4, 5].includes(draft.round) && (
                    <>
                      {input("answer", "Правильный голосовой ответ")}
                      {area(
                        "alternatives",
                        "Допустимые ответы (по одному на строку)",
                      )}
                    </>
                  )}
                  {draft.round === 5 && (
                    <p className="muted">
                      Просмотр: 30 секунд. Вопрос откроется после исчезновения
                      изображения.
                    </p>
                  )}
                  {area("explanation", "Пояснение после раскрытия")}
                  {area("source", "Источник информации")}
                </section>
                {draft.round === 4 && (
                  <CropEditor
                    media={data.media}
                    sourceId={draft.fullImageFileId}
                    crop={draft.crop}
                    preparedId={draft.fileId}
                    supplied={draft.suppliedFragment}
                    report={report}
                    change={(values) =>
                      setDraft({ ...draft, ...values, suppliedFragment: false })
                    }
                  />
                )}
                <section className="media-form fld">
                  <h2>Изображение или видео</h2>
                  <label>
                    Тип медиа
                    <select
                      aria-label="Тип медиа"
                      value={draft.mediaKind}
                      onChange={(e) => {
                        change(
                          "mediaKind",
                          e.target.value as Draft["mediaKind"],
                        );
                        change("fileId", "");
                        change("url", "");
                      }}
                    >
                      <option value="image">Изображение</option>
                      <option value="video">Видео MP4 / WebM</option>
                      <option value="youtube">YouTube</option>
                    </select>
                  </label>
                  <label>
                    Загруженный файл
                    <select
                      aria-label="Загруженный файл"
                      value={draft.fileId}
                      onChange={(e) => {
                        change("fileId", e.target.value);
                        change("url", "");
                      }}
                    >
                      <option value="">Без файла</option>
                      {data.media
                        .filter((m) =>
                          draft.mediaKind === "image"
                            ? m.mime.startsWith("image/")
                            : m.mime.startsWith("video/"),
                        )
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.originalName}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label
                    className="button-link upload-label"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.currentTarget.querySelector("input")?.click();
                      }
                    }}
                  >
                    <Upload size={16} />
                    Загрузить с компьютера
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void run(async () => {
                            const m = await upload(file);
                            change("fileId", m.id);
                            change("url", "");
                            change(
                              "mediaKind",
                              m.mime.startsWith("image/") ? "image" : "video",
                            );
                          }, "Медиа загружено");
                      }}
                    />
                  </label>
                  <label>
                    Или HTTPS-ссылка
                    <input
                      type="url"
                      value={draft.url}
                      onChange={(e) => {
                        change("url", e.target.value);
                        change("fileId", "");
                      }}
                      placeholder={
                        draft.mediaKind === "youtube"
                          ? "https://www.youtube.com/watch?v=…"
                          : "https://example.com/file.mp4"
                      }
                    />
                  </label>
                  {input(
                    "alt",
                    "Альтернативный текст изображения / описание видео",
                  )}
                  {draft.mediaKind !== "image" && (
                    <>
                      <div className="field-pair">
                        {input("start", "Начало фрагмента, сек.", "number")}
                        {input("end", "Конец фрагмента, сек.", "number")}
                      </div>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={!draft.muted}
                          onChange={(e) => change("muted", !e.target.checked)}
                        />
                        Включить звук
                      </label>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={draft.autoplay}
                          onChange={(e) => change("autoplay", e.target.checked)}
                        />
                        Автозапуск
                      </label>
                    </>
                  )}
                  {mediaFromDraft(draft) && (
                    <>
                      <Media media={mediaFromDraft(draft)!} preview />
                      <button
                        type="button"
                        onClick={() => {
                          change("fileId", "");
                          change("url", "");
                        }}
                      >
                        Убрать медиа из вопроса
                      </button>
                    </>
                  )}
                  <p className="muted">
                    Изображения до {data.config.uploads.imageMB} МБ. Видео до{" "}
                    {data.config.uploads.videoMB} МБ.
                  </p>
                </section>
              </div>
            </fieldset>
          )}
        </form>
      )}
      {mode === "packages" && (
        <PackageEditor data={data} refresh={refresh} report={report} />
      )}
      {mode === "categories" && <Categories data={data} run={run} />}
      {mode === "media" && (
        <>
          <div className="editor-actions">
            <label
              className="button-link primary upload-label"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.currentTarget.querySelector("input")?.click();
                }
              }}
            >
              <Upload size={17} />
              Загрузить медиа
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.gif,.mp4,.webm"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void run(() => upload(f), "Файл загружен");
                  e.target.value = "";
                }}
              />
            </label>
            <p className="muted">
              Изображения ≤ {data.config.uploads.imageMB} МБ · видео ≤{" "}
              {data.config.uploads.videoMB} МБ
            </p>
          </div>
          <div className="media-grid">
            {data.media.map((m) => (
              <article key={m.id}>
                <Media
                  media={{
                    kind: m.mime.startsWith("image/") ? "image" : "video",
                    fileId: m.id,
                    alt: m.originalName,
                    start: 0,
                    muted: true,
                    autoplay: false,
                  }}
                  preview
                />
                <strong>{m.originalName}</strong>
                <span className="muted">
                  {(m.size / 1024 / 1024).toFixed(2)} МБ · {m.mime}
                </span>
                <button
                  onClick={async () => {
                    if (await confirmAction("Удалить файл?"))
                      void run(() =>
                        api("editor/media/" + m.id, undefined, "DELETE"),
                      );
                  }}
                >
                  <Trash2 size={16} />
                  Удалить
                </button>
              </article>
            ))}
          </div>
        </>
      )}
      {mode === "settings" && (
        <SettingsForm
          config={data.config}
          saveNames={(names) =>
            run(
              () => api("editor/round-names", names),
              "Названия раундов сохранены",
            )
          }
          save={(cfg) =>
            run(() => api("editor/settings", cfg), "Настройки сохранены")
          }
        />
      )}
    </main>
  );
}
function Categories({
  data,
  run,
}: {
  data: EditorData;
  run: (fn: () => Promise<unknown>, message?: string) => Promise<boolean>;
}) {
  const { confirmAction } = useDialogs();
  const [edit, setEdit] = useState<CategoryRow | null>(null);
  const [name, setName] = useState("");
  const [round, setRound] = useState(1);
  return (
    <div className="categories-layout">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            api("editor/categories", { id: edit?.id, name, round }),
          ).then((ok) => {
            if (ok) {
              setEdit(null);
              setName("");
            }
          });
        }}
      >
        <h2>{edit ? "Изменить категорию" : "Новая категория"}</h2>
        <label>
          Название
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
          />
        </label>
        <label>
          Раунд
          <select
            aria-label="Раунд категории"
            value={round}
            onChange={(e) => setRound(Number(e.target.value))}
          >
            {Object.entries(data.config.roundNames).map(([n, label]) => (
              <option key={n} value={n}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="primary">Сохранить категорию</button>
        {edit && (
          <button
            type="button"
            onClick={() => {
              setEdit(null);
              setName("");
            }}
          >
            Отменить
          </button>
        )}
      </form>
      <div>
        {data.categories.map((c) => (
          <div className="category-row" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <small>
                {data.config.roundNames[c.round]} ·{" "}
                {
                  data.questions.filter(
                    (q) => q.category === c.name && q.round === c.round,
                  ).length
                }{" "}
                вопросов
              </small>
            </div>
            <button
              onClick={() => {
                setEdit(c);
                setName(c.name);
                setRound(c.round);
              }}
            >
              Изменить
            </button>
            <button
              aria-label={"Удалить категорию " + c.name}
              onClick={async () => {
                if (await confirmAction("Удалить категорию «" + c.name + "»?"))
                  void run(() =>
                    api("editor/categories/" + c.id, undefined, "DELETE"),
                  );
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
