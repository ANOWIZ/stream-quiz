import type { ImageCrop } from "../shared/content.js";
import type { MediaRow } from "../shared/editor-types.js";
import { api } from "./api.js";
import { useState } from "react";
import { publicError } from "../shared/errors.js";
export function CropEditor({
  sourceId,
  crop,
  media,
  preparedId,
  supplied,
  change,
  report,
}: {
  sourceId?: string;
  crop?: ImageCrop;
  media: MediaRow[];
  preparedId?: string;
  supplied?: boolean;
  change: (value: {
    fullImageFileId: string;
    crop: ImageCrop;
    fileId: string;
    mediaKind: "image";
    url: string;
  }) => void;
  report: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const c = crop ?? { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
  const update = (next: ImageCrop) =>
    change({
      fullImageFileId: sourceId ?? "",
      crop: next,
      fileId: "",
      mediaKind: "image",
      url: "",
    });
  return (
    <section className="fld crop-editor">
      <h2>Полное изображение и фрагмент</h2>
      {supplied && (
        <p className="muted">
          Готовый фрагмент и полное изображение импортированы отдельными
          файлами. Повторная подготовка заменит фрагмент.
        </p>
      )}
      <label>
        Исходное изображение
        <select
          value={sourceId ?? ""}
          onChange={(e) =>
            change({
              fullImageFileId: e.target.value,
              crop: c,
              fileId: "",
              mediaKind: "image",
              url: "",
            })
          }
        >
          <option value="">Выберите загруженный оригинал</option>
          {sourceId && !media.some((m) => m.id === sourceId) && (
            <option value={sourceId}>Загруженный оригинал</option>
          )}
          {media
            .filter((m) => m.mime.startsWith("image/"))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.originalName}
              </option>
            ))}
        </select>
      </label>
      <label>
        Загрузить оригинал
        <input
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.gif"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setBusy(true);
            try {
              const form = new FormData();
              form.append("file", file);
              const r = await fetch("/api/editor/media", {
                method: "POST",
                body: form,
              });
              const row = await r.json();
              if (!r.ok) throw Error(row.error);
              change({
                fullImageFileId: row.id,
                crop: c,
                fileId: "",
                mediaKind: "image",
                url: "",
              });
            } catch (err) {
              report(publicError(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {sourceId && (
        <div className="crop-source">
          <img
            src={"/media/" + sourceId}
            alt="Полное изображение для кадрирования"
          />
          {!supplied && (
            <div
              className="crop-box"
              style={{
                left: c.x * 100 + "%",
                top: c.y * 100 + "%",
                width: c.width * 100 + "%",
                height: c.height * 100 + "%",
              }}
            />
          )}
        </div>
      )}
      <div className="field-pair">
        {(
          [
            ["x", "Слева"],
            ["y", "Сверху"],
            ["width", "Ширина"],
            ["height", "Высота"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}, %
            <input
              type="range"
              min={key === "width" || key === "height" ? 1 : 0}
              max={
                key === "x"
                  ? (1 - c.width) * 100
                  : key === "y"
                    ? (1 - c.height) * 100
                    : key === "width"
                      ? (1 - c.x) * 100
                      : (1 - c.y) * 100
              }
              step="1"
              value={Math.round(c[key] * 100)}
              onChange={(e) =>
                update({ ...c, [key]: Number(e.target.value) / 100 })
              }
            />
            <output>{Math.round(c[key] * 100)}%</output>
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={busy || !sourceId}
        onClick={async () => {
          setBusy(true);
          try {
            const file = await api<MediaRow>("editor/crop", {
              sourceId,
              crop: c,
            });
            change({
              fullImageFileId: sourceId!,
              crop: c,
              fileId: file.id,
              mediaKind: "image",
              url: "",
            });
          } catch (e) {
            report(publicError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Готовим…" : "Подготовить фрагмент"}
      </button>
      {preparedId ? (
        <>
          <p className="success">Фрагмент сохранён отдельным файлом</p>
          <img
            className="crop-result"
            src={"/media/" + preparedId}
            alt="Фрагмент, который увидят игроки"
          />
        </>
      ) : (
        <p className="muted">
          После изменения кадрирования подготовьте фрагмент. Оригинал откроется
          игрокам только после ответа.
        </p>
      )}
    </section>
  );
}
