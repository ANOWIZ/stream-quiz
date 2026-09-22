import { useState } from "react";
import { Maximize, Minimize } from "lucide-react";
import type { MediaRef } from "../shared/content.js";
import { Media } from "./Media.js";
import { Modal } from "./Modal.js";

export function QuestionImage({
  media,
  expandable,
  remaining,
}: {
  media: MediaRef;
  expandable: boolean;
  remaining: number | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="question-image">
      <div className="question-image-frame">
        <Media media={media} />
        {expandable && (
          <div className="question-image-tools">
            <button
              className="btn"
              aria-label="Открыть картинку на весь экран"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Maximize size={18} /> На весь экран
            </button>
          </div>
        )}
      </div>
      {open && expandable && (
        <Modal
          label="Картинка на весь экран"
          className="image-fullscreen-overlay"
          initialFocus="button"
          onClose={() => setOpen(false)}
        >
          <div className="image-fullscreen-content">
            <header className="image-fullscreen-header">
              <span>Картинка</span>
              {remaining !== null && (
                <span role="timer" aria-label="Осталось времени">
                  {Math.floor(remaining / 60)}:
                  {String(remaining % 60).padStart(2, "0")}
                </span>
              )}
              <button className="btn" onClick={() => setOpen(false)}>
                <Minimize size={18} /> Свернуть картинку
              </button>
            </header>
            <div className="image-fullscreen-media">
              <Media media={media} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
