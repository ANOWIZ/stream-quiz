import { useEffect, useRef, useState } from "react";
import type { LocalPanoramaSource, PanoramaView } from "../shared/panorama.js";
import { publicError } from "../shared/errors.js";
export function Panorama({
  location,
  onViewChange,
  onReady,
  onError,
  onLoading,
}: {
  location: LocalPanoramaSource;
  onViewChange?: (view: PanoramaView) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  onLoading?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onViewChange);
  callback.current = onViewChange;
  const events = useRef({ onReady, onError, onLoading });
  events.current = { onReady, onError, onLoading };
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const { heading, pitch, zoom, minZoom, maxZoom } = location.camera;
  useEffect(() => {
    const controller = new AbortController();
    let cleanup = () => {};
    setError("");
    setLoading(true);
    events.current.onLoading?.();
    void import("./LocalPanoramaProvider.js")
      .then(async ({ LocalPanoramaProvider }) => {
        if (controller.signal.aborted || !ref.current) return;
        const provider = new LocalPanoramaProvider();
        const instance = await provider.mount(
          ref.current,
          {
            provider: "local",
            fileId: location.fileId,
            camera: { heading, pitch, zoom, minZoom, maxZoom },
          },
          {
            signal: controller.signal,
            onViewChange: (view) => callback.current?.(view),
            onError: (message) => {
              setError(message);
              events.current.onError?.(message);
            },
          },
        );
        if (controller.signal.aborted) instance.destroy();
        else {
          cleanup = () => instance.destroy();
          setLoading(false);
          events.current.onReady?.();
        }
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) {
          setError(
            /dynamically imported module|Importing a module script failed|Loading chunk/i.test(
              e.message,
            )
              ? "Не удалось загрузить просмотр панорамы. Проверьте, что приложение запущено, и обновите страницу."
              : publicError(e),
          );
          setLoading(false);
          events.current.onError?.(publicError(e));
        }
      });
    return () => {
      controller.abort();
      cleanup();
    };
  }, [location.fileId, heading, pitch, zoom, minZoom, maxZoom, retry]);
  return (
    <div className="panorama-wrap">
      <div
        className="panorama"
        ref={ref}
        aria-label="Панорама 360 градусов"
        aria-busy={loading}
        tabIndex={0}
      />
      <p
        className={error ? "error" : "panorama-note"}
        role={error ? "alert" : undefined}
      >
        {error ||
          (loading
            ? "Загружаем панораму…"
            : "Поворачивайте камеру мышью, касанием или стрелками. Масштаб: + / −. Перемещение отключено.")}
      </p>
      {error && (
        <>
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Повторить загрузку
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        </>
      )}
    </div>
  );
}
