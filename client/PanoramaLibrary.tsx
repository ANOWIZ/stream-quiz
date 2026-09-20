import { useDialogs } from "./Dialogs.js";
import { WorldMap } from "./WorldMap.js";
import {
  defaultPanoramaCamera,
  type PanoramaView,
} from "../shared/panorama.js";
import { useEffect, useState, useRef, type FormEvent } from "react";
import {
  Plus,
  Eye,
  Globe2,
  Upload,
  Pencil,
  Trash2,
  Check,
  X,
} from "lucide-react";
import { api, command } from "./api.js";
import { Panorama } from "./Panorama.js";
import { Modal } from "./Modal.js";
import { publicError } from "../shared/errors.js";
import { questionSchema, type FinalQuestion } from "../shared/content.js";
import type { EditorData, MediaRow } from "../shared/editor-types.js";
import type { GameView } from "../shared/types.js";
const countryNames = new Intl.DisplayNames(["ru"], { type: "region" });
const draftKey = "ston-panorama-draft";
function blank(): FinalQuestion {
  return {
    formatVersion: 2,
    id: crypto.randomUUID(),
    round: 6,
    category: "География",
    text: "Где это?",
    answer: "",
    place: "",
    title: "",
    author: "",
    license: "",
    source: "",
    explanation: "",
    active: true,
    position: 0,
    value: 0,
    difficulty: 1,
    alternatives: [],
    camera: { ...defaultPanoramaCamera },
  };
}
export function PanoramaLibrary({
  view,
  report,
}: {
  view: GameView;
  report: (s: string) => void;
}) {
  const { confirmAction } = useDialogs();
  const [data, setData] = useState<EditorData | null>(null);
  const [draft, setDraft] = useState<FinalQuestion | null>(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(draftKey) ?? "null",
      ) as FinalQuestion | null;
      return saved
        ? { ...saved, camera: saved.camera ?? { ...defaultPanoramaCamera } }
        : null;
    } catch {
      return null;
    }
  });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftPending = useRef<Promise<unknown>>(Promise.resolve());
  const [preview, setPreview] = useState<FinalQuestion | null>(null);
  const [countries, setCountries] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [previewView, setPreviewView] = useState<PanoramaView | null>(null);
  const refresh = async () => setData(await api<EditorData>("editor"));
  useEffect(() => {
    void refresh().catch((e) => report(publicError(e)));
  }, [view.phase, view.finalSelection?.id, view.finalAttemptId, report]);
  useEffect(() => {
    void fetch("/world.json")
      .then((r) => r.json())
      .then((world: { features: { id: string }[] }) =>
        setCountries(
          world.features
            .map((f) => f.id)
            .sort((a, b) =>
              (countryNames.of(a) ?? a).localeCompare(
                countryNames.of(b) ?? b,
                "ru",
              ),
            ),
        ),
      )
      .catch((e) => report(publicError(e)));
  }, [report]);
  useEffect(() => {
    if (draft) {
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
      const timer = setTimeout(() => {
        draftPending.current = draftPending.current
          .then(() => api("editor/drafts", draft))
          .catch((e) => report(publicError(e)));
      }, 700);
      draftTimer.current = timer;
      return () => clearTimeout(timer);
    } else sessionStorage.removeItem(draftKey);
  }, [draft]);
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice(message);
    } catch (e) {
      report(publicError(e));
    } finally {
      setBusy(false);
    }
  }
  function patch(values: Partial<FinalQuestion>) {
    setDraft((old) => (old ? { ...old, ...values } : old));
  }
  async function upload(file: File) {
    if (file.size > view.config.uploads.imageMB * 1024 * 1024)
      throw new Error(
        "Панорама превышает лимит " + view.config.uploads.imageMB + " МБ",
      );
    const form = new FormData();
    form.append("file", file);
    const response = await fetch("/api/editor/panorama-upload", {
      method: "POST",
      body: form,
    });
    const media = (await response.json()) as MediaRow & { error?: string };
    if (!response.ok) throw new Error(media.error);
    patch({
      panoramaFileId: media.id,
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    await run(async () => {
      await draftPending.current;
      const q = questionSchema.parse(draft);
      await api("editor/questions", q);
      setDraft(null);
    }, "Панорама сохранена");
  }
  const locked = (q: FinalQuestion) => !!data?.locked.includes(q.id);
  const rows = (
    data?.questions.filter((q): q is FinalQuestion => q.round === 6) ?? []
  ).filter((q) =>
    (q.title + " " + q.place + " " + (countryNames.of(q.answer) || ""))
      .toLocaleLowerCase("ru")
      .includes(search.toLocaleLowerCase("ru")),
  );
  const selected = view.finalSelection;
  return (
    <main className="panorama-library">
      <header className="library-heading">
        <div>
          <p className="eyebrow">БИБЛИОТЕКА ФИНАЛА</p>
          <h1>Финальные панорамы</h1>
          <p className="muted">
            Выберите место для этой партии. Игроки увидят его после ставок.
          </p>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setDraft(blank());

            setUrl("");
          }}
        >
          <Plus size={19} />
          Новая панорама
        </button>
      </header>
      <section
        className="panorama-selection-banner"
        aria-label="Выбор для текущей партии"
      >
        {selected?.panoramaFileId && (
          <img
            src={"/media/" + selected.panoramaFileId}
            alt="Выбранная панорама"
          />
        )}
        <div>
          <small>ТЕКУЩАЯ ПАРТИЯ</small>
          <strong>
            {selected?.title ||
              selected?.place ||
              (view.finalRandom
                ? "Случайный выбор включён"
                : "Панорама ещё не выбрана")}
          </strong>
          <p className="muted">
            {view.finalAttemptId
              ? "Попытка финала уже началась. Для замены сначала отмените её."
              : "До запуска финала выбор можно изменить. Остальные вопросы библиотеки сохранятся."}
          </p>
        </div>
        {selected && !view.finalAttemptId && view.phase !== "finished" && (
          <button
            onClick={() => document.getElementById("panorama-search")?.focus()}
          >
            Изменить выбор
          </button>
        )}
        {view.finalAttemptId ? (
          <button
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (
                await confirmAction(
                  "Отменить финал и выбрать другую панораму? Ставки и ответы сбросятся. Начисления этой попытки отменятся; очки раундов и ручные поправки сохранятся.",
                )
              )
                void run(
                  () =>
                    command({ type: "cancelFinal", value: "ОТМЕНИТЬ ФИНАЛ" }),
                  "Финал отменён. Выберите другую панораму.",
                );
            }}
          >
            Отменить финал и выбрать другую панораму
          </button>
        ) : view.config.rulesVersion !== 2 ? (
          <label className="random-final">
            <input
              type="checkbox"
              checked={!!view.finalRandom}
              disabled={busy}
              onChange={(e) =>
                void run(
                  () =>
                    command({ type: "randomFinal", value: e.target.checked }),
                  "Режим выбора обновлён",
                )
              }
            />
            Случайный выбор
          </label>
        ) : null}
      </section>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <label className="panorama-search">
        Поиск панорамы
        <input
          id="panorama-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Название, место или страна"
        />
      </label>
      <details className="draft-list">
        <summary>Черновики панорам</summary>
        {data?.drafts
          .filter((d) => d.round === 6)
          .map((d) => (
            <button
              key={d.id}
              onClick={() =>
                setDraft({
                  ...blank(),
                  ...d,
                  answer: String(d.answer ?? ""),
                  alternatives: Array.isArray(d.alternatives)
                    ? d.alternatives
                    : [],
                } as FinalQuestion)
              }
            >
              {d.title || "Без названия"}
            </button>
          ))}
      </details>
      <div className="panorama-cards">
        {rows.map((q) => (
          <article
            key={q.id}
            className={
              "panorama-card " + (selected?.id === q.id ? "selected" : "")
            }
            data-panorama-id={q.id}
          >
            <button
              className="panorama-thumbnail"
              aria-label={"Предпросмотр: " + (q.title || q.place)}
              onClick={() => setPreview(q)}
            >
              {q.panoramaFileId ? (
                <img
                  src={"/media/" + q.panoramaFileId}
                  alt={"Превью: " + (q.title || q.place)}
                  loading="lazy"
                />
              ) : (
                <span className="missing-panorama">
                  <Globe2 size={44} />
                  Нужно загрузить файл
                </span>
              )}
              <span className="preview-label">
                <Eye size={17} /> Смотреть 360°
              </span>
            </button>
            <div className="panorama-card-content">
              <div className="panorama-card-status">
                <span>{q.active ? "Активна" : "Отключена"}</span>
                {data?.panoramaUsage[q.id] && <span>Использована ранее</span>}
              </div>
              <h2>{q.title || q.place}</h2>
              <p>
                {countryNames.of(q.answer)} · {q.place}
              </p>
              <small className="muted">
                Добавлена:{" "}
                {q.addedAt
                  ? new Date(q.addedAt).toLocaleDateString("ru-RU")
                  : "до обновления библиотеки"}
              </small>
              {!q.license?.trim() && (
                <p className="error">Заполните лицензию перед выбором.</p>
              )}
              <button
                className={
                  selected?.id === q.id ? "selected-action" : "primary"
                }
                disabled={
                  busy ||
                  !q.active ||
                  !!view.finalAttemptId ||
                  view.phase === "finished" ||
                  !q.license?.trim() ||
                  !q.panoramaFileId
                }
                onClick={() =>
                  void run(
                    () => command({ type: "selectFinal", value: q.id }),
                    "Панорама выбрана для финала",
                  )
                }
              >
                {selected?.id === q.id ? (
                  <>
                    <Check size={17} />
                    Выбрана для финала
                  </>
                ) : (
                  "Использовать в финале"
                )}
              </button>
              <div className="panorama-card-actions">
                <button
                  disabled={busy || locked(q)}
                  onClick={() => {
                    setDraft(structuredClone(q));

                    setUrl("");
                  }}
                >
                  <Pencil size={15} />
                  Изменить
                </button>
                <button
                  disabled={busy || locked(q)}
                  onClick={() =>
                    void run(
                      () =>
                        api("editor/questions", { ...q, active: !q.active }),
                      "Статус панорамы изменён",
                    )
                  }
                >
                  {q.active ? "Отключить" : "Включить"}
                </button>
                <button
                  aria-label={"Удалить панораму " + (q.title || q.place)}
                  disabled={busy || locked(q)}
                  onClick={async () => {
                    if (
                      await confirmAction(
                        "Удалить панораму «" +
                          (q.title || q.place) +
                          "» из библиотеки?",
                      )
                    )
                      void run(
                        () =>
                          api("editor/questions/" + q.id, undefined, "DELETE"),
                        "Панорама удалена",
                      );
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {locked(q) && (
                <small className="muted">
                  Используется в текущем финале. Редактирование и удаление
                  заблокированы.
                </small>
              )}
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <p className="muted">
          Панорам пока нет. Добавьте изображение 360° с пропорциями 2:1.
        </p>
      )}
      {draft && (
        <Modal
          label="Редактор панорамы"
          onClose={() => {
            if (!busy) setDraft(null);
          }}
        >
          <form className="panorama-form" onSubmit={save}>
            <header>
              <h2>
                {data?.questions.some((q) => q.id === draft.id)
                  ? "Изменить панораму"
                  : "Новая панорама"}
              </h2>
              <button
                type="button"
                aria-label="Закрыть редактор панорамы"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                <X />
              </button>
            </header>
            <p className="muted">
              Черновик сохраняется на сервере. Публикация — кнопкой «Сохранить
              панораму».
            </p>
            <fieldset disabled={busy}>
              <label>
                Внутреннее название
                <input
                  required
                  maxLength={150}
                  value={draft.title ?? ""}
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </label>
              <div className="panorama-file-fields">
                <label>
                  <Upload size={16} />
                  Загрузить панораму
                  <input
                    aria-label="Файл панорамы"
                    type="file"
                    accept=".jpg,.jpeg,.png,.webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        void run(() => upload(file), "Файл панорамы загружен");
                    }}
                  />
                </label>
                <p className="muted">
                  JPG, PNG или WebP · пропорции 2:1 · 512–8192 px · до{" "}
                  {view.config.uploads.imageMB} МБ.
                </p>
                <label>
                  Прямая ссылка на файл
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/panorama.jpg"
                  />
                </label>
                <button
                  type="button"
                  disabled={!url || busy}
                  onClick={() =>
                    void run(async () => {
                      const media = await api<MediaRow>(
                        "editor/panorama-import",
                        { url },
                      );
                      patch({
                        panoramaFileId: media.id,
                        source: draft.source || url,
                      });
                    }, "Панорама импортирована")
                  }
                >
                  Импортировать по ссылке
                </button>
              </div>
              {draft.panoramaFileId && (
                <button
                  type="button"
                  onClick={() => {
                    setPreviewView(null);
                    setPreview(draft);
                  }}
                >
                  <Eye size={18} />
                  Интерактивный предпросмотр
                </button>
              )}
              <section className="camera-fields">
                <h3>Начальный ракурс и приближение</h3>
                <p className="muted">
                  1× — стандартный обзор. Выберите ракурс в предпросмотре или
                  задайте его здесь.
                </p>
                <div className="form-grid">
                  {(
                    [
                      ["heading", "Поворот камеры, °", -180, 180],
                      ["pitch", "Наклон камеры, °", -85, 85],
                      ["zoom", "Начальное приближение, ×", 0.6, 6],
                      ["minZoom", "Минимальное приближение, ×", 0.6, 6],
                      ["maxZoom", "Максимальное приближение, ×", 0.6, 6],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <label key={key}>
                      {label}
                      <input
                        aria-label={label}
                        type="number"
                        min={min}
                        max={max}
                        step="any"
                        required
                        value={draft.camera[key]}
                        onChange={(e) =>
                          patch({
                            camera: {
                              ...draft.camera,
                              [key]: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </section>
              <div className="form-grid">
                <label>
                  Правильная страна
                  <select
                    required
                    aria-label="Правильная страна"
                    value={draft.answer}
                    onChange={(e) => patch({ answer: e.target.value })}
                  >
                    <option value="">Выберите страну</option>
                    {countries.map((code) => (
                      <option key={code} value={code}>
                        {countryNames.of(code)} ({code})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Название места
                  <input
                    required
                    value={draft.place}
                    onChange={(e) => patch({ place: e.target.value })}
                  />
                </label>
              </div>
              <section className="camera-fields">
                <h3>Фактическая точка съёмки</h3>
                <div className="field-pair">
                  {(
                    [
                      ["latitude", "Широта", -90, 90],
                      ["longitude", "Долгота", -180, 180],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        step="any"
                        min={min}
                        max={max}
                        required
                        value={draft.location?.[key] ?? ""}
                        onChange={(e) =>
                          patch({
                            location: {
                              latitude: draft.location?.latitude ?? 0,
                              longitude: draft.location?.longitude ?? 0,
                              [key]: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
                <WorldMap
                  selected={draft.answer}
                  selectedPoint={draft.location}
                  onSelect={(code, point) =>
                    patch({ answer: code, location: point })
                  }
                />
                <p className="muted">
                  Укажите место съёмки по данным автора. Страна и координаты
                  проверяются по локальной карте.
                </p>
              </section>
              <label>
                Пояснение после раскрытия
                <textarea
                  required
                  aria-label="Пояснение после раскрытия"
                  value={draft.explanation}
                  onChange={(e) => patch({ explanation: e.target.value })}
                />
              </label>
              <label>
                Источник
                <input
                  required
                  value={draft.source}
                  onChange={(e) => patch({ source: e.target.value })}
                />
              </label>
              <label>
                Автор
                <input
                  value={draft.author ?? ""}
                  onChange={(e) => patch({ author: e.target.value })}
                />
              </label>
              <label>
                Тип лицензии
                <input
                  required
                  value={draft.license ?? ""}
                  onChange={(e) => patch({ license: e.target.value })}
                  aria-label="Тип лицензии"
                  list="panorama-licenses"
                  placeholder="Например: CC BY 4.0"
                />
              </label>
              <datalist id="panorama-licenses">
                {[
                  "CC0 1.0",
                  "CC BY 4.0",
                  "CC BY-SA 4.0",
                  "Собственная лицензия",
                ].map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <label>
                Ссылка на лицензию
                <input
                  aria-label="Ссылка на лицензию"
                  type="url"
                  value={draft.licenseUrl ?? ""}
                  onChange={(e) =>
                    patch({ licenseUrl: e.target.value || undefined })
                  }
                  placeholder="https://creativecommons.org/licenses/by/4.0/"
                />
              </label>
              <label className="random-final">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => patch({ active: e.target.checked })}
                />
                Панорама активна
              </label>
            </fieldset>
            <button
              className="primary"
              disabled={busy || locked(draft)}
              type="submit"
            >
              {busy ? "Сохраняем…" : "Сохранить панораму"}
            </button>
            {locked(draft) && (
              <p className="error">
                Панорама используется в финале. Сначала отмените текущую
                попытку.
              </p>
            )}
          </form>
        </Modal>
      )}
      {preview && (
        <Modal
          label="Предпросмотр панорамы 360°"
          onClose={() => setPreview(null)}
        >
          <section className="panorama-preview-dialog">
            <header>
              <h2>
                {preview.title || preview.place || "Предпросмотр панорамы"}
              </h2>
              <button
                aria-label="Закрыть предпросмотр"
                onClick={() => setPreview(null)}
              >
                <X />
              </button>
            </header>
            {preview.panoramaFileId ? (
              <Panorama
                key={preview.panoramaFileId}
                location={{
                  provider: "local",
                  fileId: preview.panoramaFileId,
                  camera: preview.camera,
                }}
                onViewChange={setPreviewView}
              />
            ) : (
              <p className="error">Загрузите файл этой панорамы в редакторе.</p>
            )}
            {draft?.id === preview.id && (
              <button
                type="button"
                className="primary"
                disabled={!previewView}
                onClick={() => {
                  if (previewView)
                    patch({ camera: { ...draft.camera, ...previewView } });
                  setPreview(null);
                }}
              >
                Использовать текущий ракурс
              </button>
            )}
          </section>
        </Modal>
      )}
    </main>
  );
}
