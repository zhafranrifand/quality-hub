import { useEffect, useState } from "react";
import { Copy, Download, KeyRound, ShieldCheck } from "lucide-react";
import { api, bytes, date, percent } from "./api";
import {
  ErrorMessage,
  Field,
  Form,
  Loading,
  Panel,
  useTask,
} from "./components";

export function SettingsPage() {
  const [settings, setSettings] = useState<any>(null),
    [name, setName] = useState(""),
    [token, setToken] = useState("");
  const { task, error } = useTask();
  async function refresh() {
    setSettings(await api("/settings"));
  }
  useEffect(() => {
    void task(refresh);
  }, []);
  if (!settings)
    return (
      <>
        <ErrorMessage error={error} />
        <Loading />
      </>
    );
  const s = settings.storage;
  return (
    <>
      <ErrorMessage error={error} />
      <div className="overview-grid">
        <Panel title="Owner access" action={<ShieldCheck size={19} />}>
          <p>
            <strong>{settings.email}</strong>
          </p>
          <p className="muted">
            Private, single-owner workspace. Password changes are made through
            deployment configuration.
          </p>
          <p className="muted">
            Sessions expire after seven days. No public registration.
          </p>
        </Panel>
        <Panel title="Persistent storage">
          <div className="progress-heading">
            <strong>
              {bytes(s.used)} / {bytes(s.capacity)}
            </strong>
            <span>{percent((100 * s.used) / s.capacity)}</span>
          </div>
          <div className="progress-track">
            <div
              style={{
                width: `${Math.min(100, (100 * s.used) / s.capacity)}%`,
              }}
            />
          </div>
          <p className="muted">
            New imports and screenshots stop at 80% utilization.
          </p>
          <small>
            Screenshots: {bytes(s.screenshotBytes)} / {bytes(s.screenshotQuota)}
          </small>
          <button className="text-button" onClick={() => task(refresh)}>
            Refresh usage
          </button>
        </Panel>
      </div>
      <Panel
        title="Upload tokens"
        description="Tokens can only submit Playwright reports and screenshots. They cannot read your workspace."
        action={<KeyRound size={20} />}
      >
        <Form
          submit="Create upload token"
          onSubmit={async () => {
            const t = await api("/tokens", "POST", { name });
            setToken(t.token);
            setName("");
            await refresh();
          }}
        >
          <Field label="Token name">
            <input
              required
              value={name}
              placeholder="e.g. My local Playwright runner"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </Form>
        {token && (
          <div className="token-reveal">
            <strong>Copy this token now. It is shown only once.</strong>
            <code>{token}</code>
            <button
              onClick={() => task(() => navigator.clipboard.writeText(token))}
            >
              <Copy size={14} />
              Copy token
            </button>
            <button onClick={() => setToken("")}>Dismiss</button>
          </div>
        )}
        {settings.tokens.map((t: any) => (
          <div className="list-row" key={t.id}>
            <div className="grow">
              <strong>{t.name}</strong>
              <small>{date(t.createdAt)}</small>
            </div>
            <button
              onClick={() => {
                if (confirm("Revoke this upload token?"))
                  void task(async () => {
                    await api(`/tokens/${t.id}`, "DELETE");
                    await refresh();
                  });
              }}
            >
              Revoke
            </button>
          </div>
        ))}
      </Panel>
      <Panel
        title="Backup & recovery"
        description="Portable data, under your control"
      >
        <p>
          Download a consistent database snapshot and every stored screenshot.
          Sessions and upload tokens are excluded.
        </p>
        <a className="button primary" href="/api/v1/backup">
          <Download size={16} />
          Download backup
        </a>
        <details>
          <summary>Restore instructions</summary>
          <p>
            Stop the app, restore into a new directory, then update DATA_DIR and
            restart. Recreate upload tokens after restoring.
          </p>
          <pre>npm run restore -- --from backup.zip --to ./restored-data</pre>
        </details>
        <p className="muted">
          Evidence is retained until you explicitly remove it. Railway
          availability depends on remaining free credit.
        </p>
      </Panel>
    </>
  );
}
