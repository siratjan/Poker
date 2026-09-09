'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Bottom sheet for mobile dialogs (docs/ARBEITSPAKETE.md WP4, step 7).
 *
 * Slides up from the bottom, closes on backdrop click and Escape. Focus moves
 * into the panel on open and the background is inert to the pointer. Kept small
 * on purpose; WP5 builds the richer entry sheets on top of it.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    // Lock background scroll while the sheet is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the panel — unless a field inside already claimed it via
    // `autoFocus` (WP5 sheets), which would otherwise be taken away again and
    // the mobile keyboard would not open.
    if (!panel.current?.contains(document.activeElement)) {
      panel.current?.focus();
    }

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Schließen"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative mx-auto w-full max-w-2xl rounded-t-3xl border-t border-black/10 bg-[var(--background)] px-4 pt-3 outline-none dark:border-white/10"
        style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-black/15 dark:bg-white/20" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="flex size-9 items-center justify-center rounded-full text-lg opacity-60 transition hover:bg-black/5 dark:hover:bg-white/10"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
