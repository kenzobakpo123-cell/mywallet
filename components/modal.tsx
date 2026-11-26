"use client";

import { useEffect, type ReactNode } from "react";
import Icon from "@/components/icons";

type Props = {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
};

export default function Modal({ title, description, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div>
            <span className="sheet-kicker">Buku kas</span>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="btn-icon" type="button" aria-label="Tutup" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
