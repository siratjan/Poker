'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Minimal toast context (docs/ARBEITSPAKETE.md WP4, step 7) for success/error
 * feedback after a server action. Toasts sit above the bottom tab bar and
 * dismiss themselves after a few seconds.
 */

type ToastTone = 'success' | 'error';

type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
};

type ToastContextValue = {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DISMISS_MS = 3800;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      // window.setTimeout keeps the return type a number under DOM typings.
      window.setTimeout(() => remove(id), DISMISS_MS);
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      showSuccess: (message) => push('success', message),
      showError: (message) => push('error', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4"
        style={{ paddingBottom: 'calc(84px + env(safe-area-inset-bottom))' }}
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => remove(toast.id)}
            className={
              'pointer-events-auto w-full max-w-sm rounded-xl px-4 py-3 text-left text-sm font-medium shadow-lg ' +
              (toast.tone === 'success'
                ? 'bg-emerald-600 text-white'
                : 'bg-red-600 text-white')
            }
          >
            {toast.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Access the toast helpers. Must be used under a `ToastProvider`. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === null) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
