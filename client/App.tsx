import { useDialogs } from "./Dialogs.js";
import { isEditor, isObs } from "./surface.js";
import { PanoramaLibrary } from "./PanoramaLibrary.js";
import { publicError } from "../shared/errors.js";
import { Editor, type HostMode } from "./Editor.js";
import { Game } from "./Game.js";
import { useEffect, useState, type FormEvent } from "react";
import { WifiOff } from "lucide-react";
import { api, socket, command, role, type Session } from "./api.js";
import type { GameView } from "../shared/types.js";
export function App() {
  const { confirmAction } = useDialogs();
  const [mode, setMode] = useState<HostMode | "panoramas">(() => {
    const m = new URLSearchParams(location.search).get("mode");
    return [
      "packages",
      "questions",
      "categories",
      "media",
      "settings",
      "panoramas",
    ].includes(m ?? "")
      ? (m as HostMode | "panoramas")
      : isEditor
        ? "questions"
        : "game";
  });
  useEffect(() => {
    document.body.className = isObs
      ? "role-obs"
      : role === "host"
        ? "role-host"
        : "role-player";
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<GameView | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void api<Session>("session?role=" + role)
      .then(setSession)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!session) return;
    socket.connect();
    const state = (s: GameView) => setView(s);
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on("state", state);
    socket.on("connect", on);
    socket.on("disconnect", off);
    socket.on("session-ended", () => {
      setSession(null);
      setView(null);
    });
    socket.on("connect_error", (e) => setError(publicError(e)));
    return () => {
      socket.off("session-ended");
      socket.off("connect_error");
      socket.off("state", state);
      socket.off("connect", on);
      socket.off("disconnect", off);
      socket.disconnect();
    };
  }, [session]);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      setSession(
        await api<Session>("login", {
          role,
          name: f.get("name"),
          password: f.get("password"),
        }),
      );
    } catch (e) {
      setError(publicError(e));
    } finally {
      setSubmitting(false);
    }
  }
  const act = (type: string, value?: unknown) => {
    void command({ type, value }).catch((e) => setError(publicError(e)));
  };
  if (loading)
    return (
      <main
        className="login-screen"
        aria-label="Подключение"
        aria-busy="true"
      />
    );
  if (!session)
    return (
      <main id="login" className="login-screen">
        <form
          className="login-form login-card"
          aria-label={role === "host" ? "Вход ведущего" : "Вход игрока"}
          onSubmit={login}
        >
          <label>
            Имя
            <input
              name="name"
              autoComplete="nickname"
              maxLength={30}
              required
            />
          </label>
          <label>
            Пароль
            <input
              name="password"
              autoComplete="current-password"
              type="password"
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary" type="submit" disabled={submitting}>
            {submitting ? "Вход…" : "Войти"}
          </button>
        </form>
      </main>
    );
  const navigation =
    role === "host" && !isObs ? (
      <nav className="host-nav" aria-label="Режим ведущего">
        {(
          [
            ["game", "Игра"],
            ["questions", "Вопросы"],
            ["packages", "Пакеты"],
            ["categories", "Категории"],
            ["media", "Медиафайлы"],
            ["panoramas", "Финальные панорамы"],
            ["settings", "Настройки"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={mode === id ? "current" : ""}
            onClick={() => {
              setMode(id);
              history.replaceState(
                null,
                "",
                (isEditor ? "/editor?mode=" : "/host?mode=") + id,
              );
            }}
          >
            {label}
          </button>
        ))}
        <button
          className="logout"
          onClick={async () => {
            if (
              await confirmAction(
                "Завершить сессию ведущего? Партия сохранится.",
              )
            )
              void api("logout", { role }).then(() => {
                setSession(null);
                setView(null);
              });
          }}
        >
          Выйти
        </button>
      </nav>
    ) : null;
  return (
    <div className="app-shell">
      {!connected && (
        <div className="connection" role="status">
          <WifiOff size={18} /> Связь потеряна. Восстанавливаем соединение…
        </div>
      )}
      {error && (
        <button className="error toast" onClick={() => setError("")}>
          {error} ×
        </button>
      )}
      {mode !== "game" && !isObs && navigation}
      {!isObs && role === "host" && mode === "panoramas" && view ? (
        <PanoramaLibrary view={view} report={setError} />
      ) : !isObs &&
        role === "host" &&
        mode !== "game" &&
        mode !== "panoramas" ? (
        <Editor
          mode={mode}
          report={setError}
          openPanorama={(q) => {
            sessionStorage.setItem("ston-panorama-draft", JSON.stringify(q));
            setMode("panoramas");
            history.replaceState(null, "", "/host?mode=panoramas");
          }}
        />
      ) : view ? (
        <Game view={view} act={act} navigation={navigation} />
      ) : (
        <main>Получаем состояние…</main>
      )}
    </div>
  );
}
