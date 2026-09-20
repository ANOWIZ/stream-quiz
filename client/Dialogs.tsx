import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { Modal } from "./Modal.js";

type Options = {
  title?: string;
  confirmLabel?: string;
  inputLabel?: string;
  requiredValue?: string;
};
type Request = Options & {
  id: number;
  kind: "confirm" | "prompt" | "message";
  message: string;
  initialValue: string;
  resolve: (value: string | null) => void;
};
type Dialogs = {
  confirmAction: (message: string, options?: Options) => Promise<boolean>;
  requestValue: (
    message: string,
    initialValue?: string,
    options?: Options,
  ) => Promise<string | null>;
  showMessage: (message: string, options?: Options) => Promise<void>;
};
const Context = createContext<Dialogs | null>(null);
export function useDialogs() {
  const dialogs = useContext(Context);
  if (!dialogs) throw Error("Диалоги доступны внутри DialogProvider");
  return dialogs;
}
export function DialogProvider({ children }: { children: ReactNode }) {
  const queue = useRef<Request[]>([]);
  const sequence = useRef(0);
  const [current, setCurrent] = useState<Request | null>(null);
  const ask = useCallback(
    (
      kind: Request["kind"],
      message: string,
      initialValue = "",
      options: Options = {},
    ) =>
      new Promise<string | null>((resolve) => {
        const request = {
          ...options,
          id: ++sequence.current,
          kind,
          message,
          initialValue,
          resolve,
        };
        queue.current.push(request);
        if (queue.current.length === 1) setCurrent(request);
      }),
    [],
  );
  const finish = useCallback((id: number, value: string | null) => {
    if (queue.current[0]?.id !== id) return;
    const request = queue.current.shift()!;
    setCurrent(queue.current[0] ?? null);
    request.resolve(value);
  }, []);
  useEffect(
    () => () => {
      for (const request of queue.current.splice(0)) request.resolve(null);
    },
    [],
  );
  const dialogs = useMemo<Dialogs>(
    () => ({
      confirmAction: async (message, options) =>
        (await ask("confirm", message, "", options)) !== null,
      requestValue: (message, initialValue, options) =>
        ask("prompt", message, initialValue, options),
      showMessage: async (message, options) => {
        await ask("message", message, "", options);
      },
    }),
    [ask],
  );
  return (
    <Context.Provider value={dialogs}>
      {children}
      {current && (
        <GameDialog key={current.id} request={current} finish={finish} />
      )}
    </Context.Provider>
  );
}
function GameDialog({
  request,
  finish,
}: {
  request: Request;
  finish: (id: number, value: string | null) => void;
}) {
  const [value, setValue] = useState(request.initialValue);
  const description = useId();
  const cancel = () => finish(request.id, null);
  const title =
    request.title ??
    (request.kind === "message" ? "Сообщение" : "Подтверждение");
  const allowed = !request.requiredValue || value === request.requiredValue;
  return (
    <Modal
      label={title}
      descriptionId={description}
      onClose={cancel}
      className="game-dialog-overlay"
      initialFocus="[data-dialog-focus]"
    >
      <form
        className="game-dialog"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled)",
            ),
          );
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (allowed)
            finish(request.id, request.kind === "prompt" ? value : "confirmed");
        }}
      >
        <header className="theme-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="game-dialog-close"
            aria-label="Закрыть окно"
            onClick={cancel}
          >
            <X size={20} />
          </button>
        </header>
        <p id={description} className="game-dialog-message">
          {request.message}
        </p>
        {request.kind === "prompt" && (
          <label>
            {request.inputLabel ?? "Введите значение"}
            <input
              data-dialog-focus
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.target.select()}
              autoComplete="off"
            />
          </label>
        )}
        <div className="game-dialog-actions">
          {request.kind !== "message" && (
            <button
              type="button"
              data-dialog-focus={request.kind === "confirm" ? true : undefined}
              onClick={cancel}
            >
              Отмена
            </button>
          )}
          <button
            type="submit"
            className="primary"
            disabled={!allowed}
            data-dialog-focus={request.kind === "message" ? true : undefined}
          >
            {request.confirmLabel ??
              (request.kind === "message" ? "Понятно" : "Подтвердить")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
