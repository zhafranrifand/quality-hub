import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  X,
  Plus,
  Inbox,
  LoaderCircle,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " + value.toLowerCase().replaceAll(" ", "-").replaceAll("_", "-")
      }
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} /> Loading workspace…
    </div>
  );
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <div className="error" role="alert">
      <AlertCircle size={18} />
      <span>{error}</span>
    </div>
  ) : null;
}
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel " + className}>
      <div className="panel-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function AddButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="primary" onClick={onClick}>
      <Plus size={16} />
      {children}
    </button>
  );
}
export function Metric({
  title,
  value,
  note,
  onClick,
  accent = false,
}: {
  title: string;
  value: ReactNode;
  note: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      className={"metric " + (accent ? "metric-accent" : "")}
      onClick={onClick}
    >
      <span className="metric-label">
        {title}
        <ArrowUpRight size={17} />
      </span>
      <strong>{value}</strong>
      <span className="metric-note">{note}</span>
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function CheckList({
  items,
  selected,
  onChange,
  label = "Select test cases",
}: {
  items: { id: string; title: string; detail?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}) {
  return (
    <fieldset className="check-list">
      <legend>{label}</legend>
      {items.length ? (
        items.map((i) => (
          <label key={i.id}>
            <input
              type="checkbox"
              checked={selected.includes(i.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, i.id]
                    : selected.filter((id) => id !== i.id),
                )
              }
            />
            <span>
              {i.title}
              {i.detail && <small>{i.detail}</small>}
            </span>
          </label>
        ))
      ) : (
        <p className="muted">No eligible items yet.</p>
      )}
    </fieldset>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  function key(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    if (e.key === "Tab") {
      const nodes = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ) || [],
      );
      const first = nodes[0],
        last = nodes.at(-1);
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (
        !e.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === ref.current)
      ) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={"modal " + (wide ? "modal-wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onKeyDown={key}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Form({
  onSubmit,
  children,
  submit = "Save",
  onCancel,
}: {
  onSubmit: () => Promise<unknown>;
  children: ReactNode;
  submit?: string;
  onCancel?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await onSubmit();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Something went wrong. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save}>
      <fieldset disabled={busy} className="form-fields">
        {children}
      </fieldset>
      <ErrorMessage error={error} />
      <div className="form-actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy && <LoaderCircle size={16} className="spin" />}
          {busy ? "Saving…" : submit}
        </button>
      </div>
    </form>
  );
}
export function useTask() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const task = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, task };
}
