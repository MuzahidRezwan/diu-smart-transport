import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api';

export function BusChip({ code, capacity }: { code: string; capacity?: number }) {
  return <span className={`bus op-${code[0]}`}>{code}{capacity ? <span className="opacity-70 font-medium">{capacity}</span> : null}</span>;
}

export type Tone = 'ok' | 'warn' | 'crit' | 'info' | 'none';
export const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => <span className={`pill pill-${tone}`}>{children}</span>;

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center gap-2.5">
          {title && <h2 className="text-lg">{title}</h2>}
          <span className="flex-1" />
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>)}
    </div>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <p className="muted py-6">{what}…</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong';
  return <p role="alert" className="rounded-lg px-3 py-2 font-semibold" style={{ background: 'var(--crit-soft)', color: 'var(--crit)' }}>{msg}</p>;
}

export function Modal({ title, onClose, children, width }: { title: string; onClose(): void; children: ReactNode; width?: number }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width: `min(${width}px, calc(100% - 32px))` } : undefined}>
        <div className="grid gap-3 p-5">
          <div className="flex items-center gap-2"><h2 className="flex-1 text-lg">{title}</h2><button className="btn btn-sm" onClick={onClose} aria-label="Close">✕</button></div>
          {children}
        </div>
      </div>
    </>
  );
}

/** Asks for a written reason before an access change. The reason goes to the audit log. */
export function ReasonDialog({ title, subject, onCancel, onConfirm }: { title: string; subject: ReactNode; onCancel(): void; onConfirm(reason: string): Promise<void> }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onCancel} width={560}>
      <p className="muted">{subject}</p>
      <label className="field" htmlFor="reason">Reason (saved in the audit log)
        <textarea id="reason" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Sports quota approved by the Proctor's office, memo 41/2026" />
      </label>
      {error ? <ErrorNote error={error} /> : null}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={busy || reason.trim().length < 5} onClick={async () => {
          setBusy(true);
          try { await onConfirm(reason.trim()); } catch (e) { setError(e); } finally { setBusy(false); }
        }}>Confirm</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </Modal>
  );
}

const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed bottom-4 left-1/2 z-[70] grid w-[min(460px,calc(100%-32px))] -translate-x-1/2 gap-2">
        {items.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
