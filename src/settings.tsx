import { useEffect, useState } from "react";
import {
  Copy,
  Download,
  GitBranch,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { api, bytes, date, percent } from "./api";
import {
  ErrorMessage,
  Field,
  Form,
  Loading,
  Panel,
  useTask,
} from "./components";
import type {
  AutomationPlanOption,
  AutomationTokenScope,
  StoredAutomationToken,
} from "./types";

export function SettingsPage({
  projectId,
  projectName,
  refreshProject,
}: {
  projectId: string;
  projectName: string;
  refreshProject: () => Promise<void>;
}) {
  const [settings, setSettings] = useState<any>(null),
    [plans, setPlans] = useState<AutomationPlanOption[]>([]),
    [name, setName] = useState(""),
    [scope, setScope] = useState<AutomationTokenScope>("edit"),
    [planId, setPlanId] = useState(""),
    [syncResult, setSyncResult] = useState<any>(null),
    [token, setToken] = useState("");
  const { task, error, busy } = useTask();
  async function refresh() {
    const [currentSettings, availablePlans] = await Promise.all([
      api("/settings"),
      api("/plans"),
    ]);
    setSettings(currentSettings);
    setPlans(availablePlans);
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
        title="Automation tokens"
        description="Create one of two plan-bound API tokens. Read-only tokens can view the selected plan's project data. Edit tokens can sync automation drafts into that project's case library, create automated runs, and submit results and evidence for their plan. Neither can approve cases, change frozen plan scope, access settings, or download backups."
        action={<KeyRound size={20} />}
      >
        <Form
          submit="Create token"
          onSubmit={async () => {
            if (!planId)
              throw new Error("Select a plan for this token scope");
            const t = await api("/tokens", "POST", {
              name,
              scope,
              planId,
            });
            setToken(t.token);
            setName("");
            setScope("edit");
            setPlanId("");
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
          <Field label="Token scope">
            <select
              value={scope}
              onChange={(e) => {
                const nextScope = e.target.value as AutomationTokenScope;
                setScope(nextScope);
              }}
            >
              <option value="read_only">Read-only · view plan project data</option>
              <option value="edit">Edit · sync, run, and submit results</option>
            </select>
          </Field>
          <Field label="Plan access">
            <select
              required
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
            >
              <option value="">Select a plan</option>
              {plans.map((plan) => (
                <option value={plan.id} key={plan.id}>
                  {plan.projectName} / {plan.releaseName} / {plan.name}
                </option>
              ))}
            </select>
          </Field>
        </Form>
        <p className="muted">
          Read-only access is limited to the project associated with the
          selected plan. Edit tokens can sync scenarios as drafts into that
          project's case library; automated runs, reports, and screenshots are
          scoped to the selected plan. A changed scenario creates a revision
          and does not rewrite frozen plan versions. Tokens cannot approve
          cases, alter frozen plan scope, read settings, or download backups.
          The secret is shown once and is never displayed again.
        </p>
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
        {settings.tokens.map((t: StoredAutomationToken) => (
          <div className="list-row" key={t.id}>
            <div className="grow">
              <strong>{t.name}</strong>
              <small>
                {t.planName
                  ? `${tokenScopeLabel(t)} · ${t.planName}`
                  : "Legacy unscoped token · revoke and replace"}{" "}
                · {date(t.createdAt)}
              </small>
            </div>
            <button
              onClick={() => {
                if (
                  confirm(`Revoke the ${tokenScopeName(t)} token "${t.name}"?`)
                )
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
        title="Sync from GitHub"
        description={
          settings.githubSync?.configured
            ? `${settings.githubSync.repository} · ${settings.githubSync.branch} · ${settings.githubSync.featureRoot}`
            : "Connect the repository in the Railway service variables to enable one-click sync."
        }
        action={<GitBranch size={19} />}
      >
        {settings.githubSync?.configured ? (
          <>
            <p>
              Read-only source connection. This fetches the latest tagged Gherkin
              scenarios and syncs them into the selected project; it does
              not run Playwright tests.
            </p>
            <p className="muted">
              Destination project: <strong>{projectName || "None selected"}</strong>
            </p>
            <button
              className="primary"
              disabled={busy || !projectId}
              onClick={() =>
                void task(async () => {
                  setSyncResult(null);
                  const manifest = await api("/integrations/github/manifest");
                  const result = await api(
                    `/projects/${projectId}/automation/sync`,
                    "POST",
                    {
                      browser: manifest.browser,
                      scenarios: manifest.scenarios,
                    },
                  );
                  setSyncResult({ manifest, result });
                  await refreshProject();
                })
              }
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <RefreshCw size={16} />
              )}{" "}
              {busy ? "Syncing…" : "Sync from repo"}
            </button>
            {syncResult && (
              <div className="token-reveal" role="status">
                <strong>
                  Synced {syncResult.result.scenarios.length} scenarios from
                  commit {syncResult.manifest.commitSha.slice(0, 7)}.
                </strong>
                <p>
                  {syncResult.result.scenarios.some(
                    (scenario: { status: string }) => scenario.status === "draft",
                  )
                    ? "New or changed scenarios are drafts. Review and approve them before adding them to a plan."
                    : "All scenarios are already up to date; no drafts need review."}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="muted">
            Configure GITHUB_REPOSITORY, GITHUB_BRANCH, and
            GITHUB_FEATURE_ROOT in Railway Variables. Public repositories need
            no token. For a private repository, configure an optional
            repository-limited GITHUB_READ_TOKEN with Contents read access.
          </p>
        )}
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

function tokenScopeLabel(token: StoredAutomationToken) {
  const scope = token.scope || (token.planId ? "runner" : "upload");
  if (scope === "read_only") return "Read-only";
  if (scope === "edit") return "Edit";
  if (scope === "automation_sync") return "Edit · legacy sync only";
  if (scope === "runner") return "Edit · legacy runner only";
  return "Edit · legacy upload only";
}

function tokenScopeName(token: StoredAutomationToken) {
  const scope = token.scope || (token.planId ? "runner" : "upload");
  if (scope === "read_only") return "read-only";
  if (scope === "edit") return "edit";
  if (scope === "automation_sync") return "legacy automation-sync";
  if (scope === "runner") return "legacy runner";
  return "legacy upload-only";
}
