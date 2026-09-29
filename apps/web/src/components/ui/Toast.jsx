import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Info, XCircle, X } from 'lucide-react';
import { cn, FOCUS_RING } from './cn';

const ToastContext = createContext(null);
const ICONS = { success: CheckCircle2, error: XCircle, info: Info };
const TONES = {
  success: 'border-green-300 bg-green-50 text-green-900',
  error: 'border-red-300 bg-red-50 text-red-900',
  info: 'border-sky-300 bg-sky-50 text-sky-900',
};

/**
 * Toast provider. Wrap the app once; then in any component:
 *   const toast = useToast();  toast.success('Saved'); toast.error('Failed'); toast.info('...');
 *   toast.show({ message, tone, duration }) ; toast.dismiss(id)
 * The stack is an aria-live region (errors are announced assertively).
 * Outside a provider, useToast() returns no-op functions so components stay testable.
 */
export function ToastProvider({ children, defaultDuration = 5000 }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});
  const seq = useRef(0);

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id]);
    delete timers.current[id];
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    ({ message, tone = 'info', duration = defaultDuration }) => {
      const id = ++seq.current;
      setToasts((t) => [...t, { id, message, tone }]);
      if (duration > 0) timers.current[id] = setTimeout(() => dismiss(id), duration);
      return id;
    },
    [defaultDuration, dismiss],
  );

  useEffect(() => {
    const current = timers.current;
    return () => Object.values(current).forEach(clearTimeout);
  }, []);

  const api = useMemo(
    () => ({
      show,
      dismiss,
      success: (message, opts) => show({ ...opts, message, tone: 'success' }),
      error: (message, opts) => show({ ...opts, message, tone: 'error' }),
      info: (message, opts) => show({ ...opts, message, tone: 'info' }),
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none"
        data-testid="toast-region"
      >
        <div aria-live="polite" role="status" className="flex flex-col gap-2">
          {toasts
            .filter((t) => t.tone !== 'error')
            .map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
        </div>
        <div aria-live="assertive" role="alert" className="flex flex-col gap-2">
          {toasts
            .filter((t) => t.tone === 'error')
            .map((t) => (
              <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
            ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }) {
  const Icon = ICONS[toast.tone] || Info;
  return (
    <div
      className={cn('pointer-events-auto flex items-start gap-2 rounded border p-3 shadow-lg text-sm', TONES[toast.tone] || TONES.info)}
    >
      <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="flex-1">{toast.message}</div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(toast.id)}
        className={cn('rounded p-0.5 hover:bg-black/10', FOCUS_RING)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

const NOOP = () => 0;
const NOOP_API = { show: NOOP, dismiss: NOOP, success: NOOP, error: NOOP, info: NOOP };

export function useToast() {
  return useContext(ToastContext) || NOOP_API;
}
