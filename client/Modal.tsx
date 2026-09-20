import { useEffect, useRef, type ReactNode } from "react";
export function Modal({
  children,
  onClose,
  label,
  className = "",
  descriptionId,
  initialFocus,
}: {
  children: ReactNode;
  onClose: () => void;
  label: string;
  className?: string;
  descriptionId?: string;
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    if (initialFocus) dialog?.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"map-overlay " + className}
      aria-label={label}
      aria-describedby={descriptionId}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
