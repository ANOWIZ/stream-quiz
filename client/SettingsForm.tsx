import { useState } from "react";
import type { Config } from "../shared/config.js";
const labels: Record<string, string> = {
  comparison: "Больше-меньше",
  points: "Очки за верный ответ",
  percentTolerance: "Допуск, процентных пунктов",
  relativeTolerance: "Допуск, доля правильного числа",
  buzzerPoints: "Устные ответы",
  fragmentCorrect: "Фрагмент: верно",
  fragmentWrong: "Фрагмент: штраф",
  memoryCorrect: "Запомни: верно",
  memoryWrong: "Запомни: штраф",
  maxPlayers: "Максимум игроков",
  roundOrder: "Порядок раундов",
  questionCounts: "Число вопросов по числу игроков",
  numeric: "Больше-меньше",
  narrow: "Ширина узкого (доля шкалы)",
  wide: "Ширина широкого (доля шкалы)",
  thresholds: "Пороги отклонения",
  activePoints: "Очки активному игроку",
  narrowPoints: "Очки за узкий диапазон",
  widePoints: "Очки за широкий диапазон",
  choicePoints: "Очки за выбор",
  beforeAfter: "До или после",
  twoWorlds: "Два мира",
  boardValues: "Стоимости поля",
  timers: "Таймеры (секунды)",
  point: "Точная отметка",
  ranges: "Диапазоны",
  answer: "Секретный ответ",
  buzz: "Ожидание кнопки",
  judge: "Голосовой ответ",
  bet: "Ставка",
  study: "Просмотр изображения по стоимости",
  final: "Финал",
  seconds: "Время выбора страны (максимум 120)",
  uploads: "Загрузка файлов",
  imageMB: "Максимум изображения, МБ",
  videoMB: "Максимум видео, МБ",
};
export function SettingsForm({
  config,
  save,
  saveNames,
}: {
  config: Config;
  save: (c: Config) => Promise<boolean>;
  saveNames: (names: Config["roundNames"]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(config);
  const [busy, setBusy] = useState(false);
  function update(path: string[], value: number) {
    setDraft((old) => {
      const next = structuredClone(old);
      let obj = next as unknown as Record<string, unknown>;
      for (const key of path.slice(0, -1))
        obj = obj[key] as Record<string, unknown>;
      obj[path[path.length - 1]] = value;
      return next;
    });
  }
  function fields(value: unknown, path: string[] = []): React.ReactNode {
    if (typeof value === "number")
      return (
        <label key={path.join(".")}>
          {labels[path.at(-1)!] ??
            (path.length === 2 && path[0] === "questionCounts"
              ? path[1] + " игрока"
              : String(Number(path.at(-1)) + 1))}
          <input
            type="number"
            step="any"
            value={value}
            onChange={(e) => update(path, Number(e.target.value))}
          />
        </label>
      );
    return (
      <section
        key={path.join(".")}
        className={path.length ? "settings-section" : "settings-grid"}
      >
        {path.length > 0 && <h3>{labels[path.at(-1)!] ?? path.at(-1)}</h3>}
        {Object.entries(value as object)
          .filter(
            ([key]) =>
              ![
                "roundNames",
                "rulesVersion",
                "betLimit",
                "questionCounts",
              ].includes(key) &&
              !(
                config.rulesVersion === 2 &&
                [
                  "numeric",
                  "boardValues",
                  "timers",
                  "roundOrder",
                  "seconds",
                ].includes(key)
              ),
          )
          .map(([key, val]) => fields(val, [...path, key]))}
      </section>
    );
  }
  return (
    <>
      <RoundNamesForm
        key={JSON.stringify(config.roundNames)}
        names={config.roundNames}
        save={saveNames}
      />
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void save({ ...draft, roundNames: config.roundNames }).finally(() =>
            setBusy(false),
          );
        }}
      >
        <p className="notice">
          Изменения правил сохраняются в лобби. Все значения проверяются
          сервером. Количество вопросов свободное. В новых правилах просмотр
          кадра — 30 секунд, финал — 60 секунд.
        </p>
        {fields(draft)}
        <button className="primary" disabled={busy}>
          Сохранить настройки
        </button>
      </form>
    </>
  );
}
function RoundNamesForm({
  names,
  save,
}: {
  names: Config["roundNames"];
  save: (names: Config["roundNames"]) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(names);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="settings-form round-names-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void save(draft).finally(() => setBusy(false));
      }}
    >
      <h2>Названия раундов</h2>
      <p className="notice">
        Можно менять во время игры. Правила раундов сохраняются.
      </p>
      <div className="settings-grid">
        {Object.entries(draft).map(([round, name]) => (
          <div className="settings-section" key={round}>
            <label>
              {Number(round) === 6 ? "Финал" : "Раунд " + round}
              <input
                type="text"
                value={name}
                required
                maxLength={100}
                onChange={(event) =>
                  setDraft({ ...draft, [round]: event.target.value })
                }
              />
            </label>
          </div>
        ))}
      </div>
      <button className="primary" disabled={busy}>
        Сохранить названия раундов
      </button>
    </form>
  );
}
