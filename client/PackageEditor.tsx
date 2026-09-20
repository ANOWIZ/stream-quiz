import { useDialogs } from "./Dialogs.js";
import { useState } from "react";
import type { EditorData } from "../shared/editor-types.js";
import type { GamePackage, PackageSummary } from "../shared/packages.js";
import { questionIssues } from "../shared/packages.js";
import { api, command } from "./api.js";
import { publicError } from "../shared/errors.js";
export function PackageEditor({
  data,
  refresh,
  report,
}: {
  data: EditorData;
  refresh: () => Promise<void>;
  report: (s: string) => void;
}) {
  const { confirmAction } = useDialogs();
  const [draft, setDraft] = useState<{
    id?: string;
    name: string;
    description: string;
    questionIds: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<PackageSummary | null>(null);
  const [round, setRound] = useState(1);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      report(publicError(e));
    } finally {
      setBusy(false);
    }
  };
  const edit = (p: PackageSummary) => {
    setDraft({
      id: p.id,
      name: p.name,
      description: p.description,
      questionIds: p.questionIds,
    });
    setCheck(p);
  };
  return (
    <section className="package-editor">
      <p className="notice">
        Количество заданий в каждом раунде выбираете вы. Начатая партия хранит
        свою версию пакета. Изменения банка попадут в пакет после его
        сохранения.
      </p>
      {notice && (
        <p role="status" className="success">
          {notice}
        </p>
      )}
      {!draft ? (
        <>
          <button
            className="primary"
            onClick={() => {
              setDraft({ name: "", description: "", questionIds: [] });
              setCheck(null);
            }}
          >
            Создать пакет
          </button>
          {data.packages.map((p) => (
            <article className="theme" key={p.id}>
              <div className="theme-head">
                <h2>{p.name}</h2>
                <span>
                  Версия {p.revision} · {p.questionIds.length} заданий
                </span>
              </div>
              <p>{p.description}</p>
              <p>
                {[1, 2, 3, 4, 5, 6]
                  .map((r) => data.config.roundNames[r] + ": " + p.counts[r])
                  .join(" · ")}
              </p>
              <div className="editor-actions">
                <button onClick={() => edit(p)}>Редактировать пакет</button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setCheck(
                        await api<PackageSummary>(
                          "editor/packages/" + p.id + "/check",
                        ),
                      );
                    })
                  }
                >
                  Проверить пакет
                </button>
                <button
                  className="primary"
                  disabled={busy || !!p.issues.length}
                  onClick={() =>
                    void run(async () => {
                      await api("editor/packages/" + p.id + "/use", {});
                      setNotice(
                        "Пакет выбран. Вручную выберите его панораму для финала.",
                      );
                    })
                  }
                >
                  Выбрать для партии
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const pack = await api<GamePackage>(
                        "editor/packages/" + p.id,
                      );
                      const final = pack.questions.find((q) => q.round === 6);
                      if (!final) throw Error("Добавьте панораму в пакет");
                      await command({ type: "selectFinal", value: final.id });
                      setNotice("Панорама пакета выбрана для финала");
                    })
                  }
                >
                  Использовать панораму пакета в финале
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirmAction(
                        "Удалить пакет? Вопросы и начатая партия сохранятся.",
                      )
                    )
                      void run(() =>
                        api("editor/packages/" + p.id, undefined, "DELETE"),
                      );
                  }}
                >
                  Удалить пакет
                </button>
              </div>
            </article>
          ))}
        </>
      ) : (
        <form
          className="question-form theme"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const result = await api<PackageSummary>(
                "editor/packages",
                draft,
              );
              setCheck(result);
              setDraft({ ...draft, id: result.id });
              setNotice(
                result.issues.length
                  ? "Пакет сохранён как незавершённый. Исправьте замечания перед стартом."
                  : "Пакет готов",
              );
            });
          }}
        >
          <div className="form-toolbar theme-head">
            <button type="button" onClick={() => setDraft(null)}>
              К списку пакетов
            </button>
            <strong>Заданий: {draft.questionIds.length}</strong>
            <button className="primary" disabled={busy}>
              Сохранить пакет
            </button>
          </div>
          <label>
            Название пакета
            <input
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            Описание
            <textarea
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <div className="rtabs">
            {[1, 2, 3, 4, 5, 6].map((r) => (
              <button
                type="button"
                className={"rtab" + (round === r ? " active" : "")}
                key={r}
                onClick={() => setRound(r)}
              >
                {data.config.roundNames[r]} ·{" "}
                {
                  draft.questionIds.filter(
                    (id) =>
                      data.questions.find((q) => q.id === id)?.round === r,
                  ).length
                }
              </button>
            ))}
          </div>
          <label>
            Найти вопрос
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          {data.questions
            .filter(
              (q) =>
                q.round === round &&
                (q.category + " " + q.text)
                  .toLocaleLowerCase("ru")
                  .includes(search.toLocaleLowerCase("ru")),
            )
            .map((q) => {
              const issues = questionIssues(q);
              const checked = draft.questionIds.includes(q.id);
              return (
                <label className="package-question" key={q.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!checked && issues.length > 0}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        questionIds: e.target.checked
                          ? [...draft.questionIds, q.id]
                          : draft.questionIds.filter((id) => id !== q.id),
                      })
                    }
                  />
                  <span>
                    <b>{q.category}</b> · {q.round === 6 ? q.title : q.text}
                    {issues.length > 0 && (
                      <small className="error">{issues.join("; ")}</small>
                    )}
                  </span>
                </label>
              );
            })}
        </form>
      )}
      {check && (
        <section className="validation-warnings" role="status">
          <h3>
            {check.name}: {check.issues.length ? "нужны исправления" : "готово"}
          </h3>
          {check.issues.map((issue, i) => (
            <p key={i}>{issue}</p>
          ))}
        </section>
      )}
    </section>
  );
}
