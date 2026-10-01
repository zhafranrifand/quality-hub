import { useEffect, useState } from "react";
import {
  Upload,
  ArrowLeft,
  Plus,
  ExternalLink,
  Trash2,
  Copy,
} from "lucide-react";
import { api, date, bytes } from "./api";
import {
  Panel,
  Empty,
  Badge,
  Loading,
  Form,
  Field,
  Modal,
  ErrorMessage,
  useTask,
} from "./components";
import type { PageProps, RunDetail, Execution, Gate, Plan } from "./types";
import { RunEditor } from "./run-editor";
import { Pagination, usePagination } from "./Pagination";

export function RunsPage(p: PageProps) {
  const [selected, setSelected] = useState(
      p.state.runs.some((r) => r.id === p.filter) ? p.filter : "",
    ),
    [detail, setDetail] = useState<RunDetail | null>(null),
    [gateResult, setGateResult] = useState<{
      scope: string;
      gate: Gate;
    } | null>(null),
    [creating, setCreating] = useState(false),
    [planId, setPlanId] = useState(p.state.plans[0]?.id || ""),
    [plan, setPlan] = useState<Plan | null>(null);
  const [runReleaseFilter, setRunReleaseFilter] = useState("all");
  const { error, task } = useTask();
  const gateScope = JSON.stringify([p.projectId, p.releaseId, p.build]);
  const gate = gateResult?.scope === gateScope ? gateResult.gate : null;
  const gatePagination = usePagination(
    gate?.rows ?? [],
    JSON.stringify([p.projectId, p.filter, p.releaseId, p.build, gate?.rows]),
  );
  const runReleaseId = (run: (typeof p.state.runs)[number]) =>
    run.releaseId ??
    p.state.plans.find((candidate) => candidate.id === run.planId)?.releaseId;
  const filteredRuns = p.state.runs.filter(
    (run) =>
      runReleaseFilter === "all" || runReleaseId(run) === runReleaseFilter,
  );
  const runsPagination = usePagination(
    filteredRuns,
    JSON.stringify([
      p.projectId,
      runReleaseFilter,
      filteredRuns.map((run) => run.id),
    ]),
  );
  async function reload() {
    if (selected) setDetail(await api(`/runs/${selected}`));
    await p.refresh();
  }
  useEffect(() => {
    if (selected)
      void task(async () => setDetail(await api(`/runs/${selected}`)));
  }, [selected]);
  useEffect(() => {
    let active = true;
    if (p.filter === "gate" && p.releaseId && p.build)
      api(
        `/releases/${p.releaseId}/readiness?build=${encodeURIComponent(p.build)}`,
      )
        .then((result) => {
          if (active) setGateResult({ scope: gateScope, gate: result });
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [p.filter, p.state, gateScope]);
  return (
    <>
      <ErrorMessage error={error} />
      {selected ? (
        <>
          <button
            className="text-button"
            onClick={() => {
              setSelected("");
              setDetail(null);
            }}
          >
            <ArrowLeft size={16} />
            All test runs
          </button>
          {detail ? (
            <>
              <Panel
                title={
                  p.state.plans.find((x) => x.id === detail.run.planId)?.name ||
                  "Test run"
                }
                description={`Build ${detail.run.build} · ${detail.run.kind} · ${date(detail.run.createdAt)}`}
                action={<Badge value={detail.run.kind} />}
              >
                <div className="run-meta">
                  <span>Run ID</span>
                  <code>{detail.run.id}</code>
                  <button
                    className="icon-button"
                    aria-label="Copy run ID"
                    onClick={() =>
                      task(() => navigator.clipboard.writeText(detail.run.id))
                    }
                  >
                    <Copy size={15} />
                  </button>
                </div>
                {detail.run.kind === "automated" && (
                  <ImportReport detail={detail} done={reload} />
                )}
              </Panel>
              {!detail.executions.length && (
                <Empty title="Waiting for execution results">
                  Upload a Playwright JSON report to populate this automated
                  run.
                </Empty>
              )}
              {detail.executions.map((e) => (
                <ExecutionCard
                  key={e.id}
                  execution={e}
                  detail={detail}
                  {...p}
                  done={reload}
                />
              ))}
            </>
          ) : (
            <Loading />
          )}
        </>
      ) : (
        <>
          <div className="toolbar">
            <span className="muted grow">
              Manual checks and local Playwright results
            </span>
            <button
              className="primary"
              disabled={!p.state.plans.length}
              onClick={() => setCreating(true)}
            >
              <Plus size={16} />
              Start run
            </button>
          </div>
          {p.filter === "gate" && gate && (
            <Panel
              title="Required results"
              description={`Selected build: ${p.build}`}
              action={<Badge value={gate.status} />}
            >
              <div className="gate-reasons">
                {gate.reasons.map((r) => (
                  <p key={r}>{r}</p>
                ))}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Case</th>
                      <th scope="col">Target</th>
                      <th scope="col">Result</th>
                      <th scope="col">Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gatePagination.pageItems.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.title}
                          <small>{r.caseId}</small>
                        </td>
                        <td>
                          {r.environment} / {r.browser}
                        </td>
                        <td>
                          <Badge value={r.status} />
                          {r.flaky ? <Badge value="flaky" /> : null}
                        </td>
                        <td>
                          {r.runId ? (
                            <button onClick={() => setSelected(r.runId!)}>
                              Inspect run
                            </button>
                          ) : (
                            "Not run"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={gatePagination.page}
                pageCount={gatePagination.pageCount}
                pageSize={gatePagination.pageSize}
                total={gatePagination.total}
                onPageChange={gatePagination.setPage}
              />
            </Panel>
          )}
          <Panel title="Run history" description="Most recent 200 runs">
            {p.state.runs.length ? (
              <>
                <div className="toolbar">
                  <Field label="Filter run history by release">
                    <select
                      value={runReleaseFilter}
                      onChange={(event) =>
                        setRunReleaseFilter(event.target.value)
                      }
                    >
                      <option value="all">All releases</option>
                      {p.state.releases.map((release) => (
                        <option key={release.id} value={release.id}>
                          {release.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {filteredRuns.length ? (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Plan / run</th>
                            <th scope="col">Release</th>
                            <th scope="col">Build</th>
                            <th scope="col">Type</th>
                            <th scope="col">Created</th>
                            <th scope="col" />
                          </tr>
                        </thead>
                        <tbody>
                          {runsPagination.pageItems.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <strong>{r.planName}</strong>
                                <small>{r.id.slice(0, 8)}</small>
                              </td>
                              <td>
                                {p.state.releases.find(
                                  (release) => release.id === runReleaseId(r),
                                )?.name || "Unknown release"}
                              </td>
                              <td>
                                <code>{r.build}</code>
                              </td>
                              <td>
                                <Badge value={r.kind} />
                              </td>
                              <td>{date(r.createdAt)}</td>
                              <td>
                                <button onClick={() => setSelected(r.id)}>
                                  Open run
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pagination
                      page={runsPagination.page}
                      pageCount={runsPagination.pageCount}
                      pageSize={runsPagination.pageSize}
                      total={runsPagination.total}
                      onPageChange={runsPagination.setPage}
                    />
                  </>
                ) : (
                  <Empty title="No runs for this release">
                    Choose another release to see its run history.
                  </Empty>
                )}
              </>
            ) : (
              <Empty title="Your run history starts here">
                Create a plan and start a manual or automated run.
              </Empty>
            )}
          </Panel>
        </>
      )}
      {creating && (
        <Modal title="Choose test plan" onClose={() => setCreating(false)}>
          <Form
            submit="Continue"
            onSubmit={async () => {
              const found = p.state.plans.find((x) => x.id === planId);
              if (!found) throw new Error("Choose a plan");
              setPlan(found);
              setCreating(false);
            }}
          >
            <Field label="Test plan">
              <select
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                {p.state.plans.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ·{" "}
                    {p.state.releases.find((r) => r.id === x.releaseId)?.name}
                  </option>
                ))}
              </select>
            </Field>
          </Form>
        </Modal>
      )}
      {plan && (
        <RunEditor
          plan={plan}
          close={() => setPlan(null)}
          done={async (id) => {
            await p.refresh();
            setSelected(id);
          }}
        />
      )}
    </>
  );
}
function ImportReport({
  detail,
  done,
}: {
  detail: RunDetail;
  done: () => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <div className="import-box">
        <Upload size={25} />
        <div className="grow">
          <h3>
            {detail.run.imported
              ? "Report imported"
              : "Import Playwright results"}
          </h3>
          <p>
            {detail.run.imported
              ? "A duplicate report is safe to retry. Use a new run for corrected results."
              : "Choose a JSON report from your local Playwright test run. Maximum 10 MB."}
          </p>
          <Form
            submit="Import report"
            onSubmit={async () => {
              if (!file) throw new Error("Choose a report");
              const form = new FormData();
              form.append("report", file);
              await api(
                `/runs/${detail.run.id}/imports/playwright`,
                "POST",
                form,
              );
              await done();
            }}
          >
            <Field label="Playwright JSON report">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </Field>
          </Form>
        </div>
      </div>
      <details className="integration-help">
        <summary>Configure Playwright and the local uploader</summary>
        <p>
          Tag each Gherkin scenario with its stable case ID, such as
          @TC-XXXXXXXX. Other tags such as @smoke are fine. The plan browser
          must match the Playwright project name, or provide browserName in
          project metadata.
        </p>
        <pre>{`// tests/feature-name.feature\n@TC-XXXXXXXX @smoke\nScenario: Customer can place an order\n  Given the customer has an active account\n  When the customer submits a valid order\n  Then the order is confirmed\n\n// For the one-command LOKASI runner, set QA_DASHBOARD_URL,\n// QA_PLAN_ID, QA_BUILD_ID, and a plan-bound QA_EDIT_TOKEN.\nnpm run test:lokasi:dashboard\n\n// Or upload this existing run manually with a plan-bound Edit token:\n// set QA_EDIT_TOKEN first\nnpm run upload -- --url https://YOUR-APP --run-id ${detail.run.id} --report results.json`}</pre>
        <p>
          Videos and traces stay local. Add an HTTPS link if you publish
          evidence elsewhere.
        </p>
      </details>
    </>
  );
}
function ExecutionCard(
  p: PageProps & {
    execution: Execution;
    detail: RunDetail;
    done: () => Promise<void>;
  },
) {
  const e = p.execution,
    last = e.attempts.at(-1),
    [status, setStatus] = useState("passed"),
    [note, setNote] = useState(""),
    [shot, setShot] = useState<File | null>(null),
    [link, setLink] = useState(""),
    [linkName, setLinkName] = useState(""),
    [defectId, setDefectId] = useState(""),
    [itemId, setItemId] = useState("");
  const { task, error } = useTask();
  const target = p.state.plans.find((x) => x.id === p.detail.run.planId);
  const available =
    target?.items.filter(
      (i) =>
        i.browser === e.browser &&
        !p.detail.executions.some((ex) => ex.planItemId === i.id),
    ) || [];
  return (
    <Panel
      title={e.content?.title || e.title}
      description={`${e.caseId || "Unmatched automated test"} · ${e.browser}${e.versionId ? " · frozen case version" : ""}`}
      action={
        <div className="pills">
          <Badge value={last?.status || "not_run"} />
          {e.flaky ? <Badge value="flaky" /> : null}
        </div>
      }
    >
      <ErrorMessage error={error} />
      {!e.planItemId && (
        <div className="mapping-box">
          <h3>Map this result to planned scope</h3>
          <p>Unmatched results do not satisfy release coverage.</p>
          <Form
            submit="Verify mapping"
            onSubmit={async () => {
              if (!itemId) throw new Error("Choose a planned case");
              await api(`/executions/${e.id}/map`, "POST", {
                planItemId: itemId,
              });
              await p.done();
            }}
          >
            <Field label="Planned case">
              <select
                value={itemId}
                onChange={(x) => setItemId(x.target.value)}
              >
                <option value="">Select matching case and target</option>
                {available.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title} ·{" "}
                    {
                      p.state.environments.find(
                        (env) => env.id === i.environmentId,
                      )?.name
                    }
                  </option>
                ))}
              </select>
            </Field>
          </Form>
        </div>
      )}
      {e.content && (
        <details className="case-detail">
          <summary>Test steps & preconditions</summary>
          <p>{e.content.preconditions || "No preconditions specified."}</p>
          <ol>
            {e.content.steps.map((s, i) => (
              <li key={i}>
                <strong>{s.action}</strong>
                <small>Expected: {s.expected || "—"}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
      {p.detail.run.kind === "manual" && (
        <Form
          submit="Record result"
          onSubmit={async () => {
            await api(`/executions/${e.id}/attempts`, "POST", { status, note });
            setNote("");
            await p.done();
          }}
        >
          <div className="form-grid">
            <Field label="Execution result">
              <select
                value={status}
                onChange={(x) => setStatus(x.target.value)}
              >
                {["passed", "failed", "blocked", "skipped", "not_run"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Execution notes">
              <textarea
                value={note}
                onChange={(x) => setNote(x.target.value)}
                placeholder="What did you observe?"
              />
            </Field>
          </div>
          <p className="muted">
            Evidence is optional. Attach a screenshot or link when it helps
            explain a failure.
          </p>
        </Form>
      )}
      {!!e.attempts.length && (
        <details className="attempt-history" open={last?.status === "failed"}>
          <summary>Attempt history ({e.attempts.length})</summary>
          {e.attempts.map((a) => (
            <div className="attempt" key={a.id}>
              <div>
                <Badge value={a.status} />
                <span>
                  Attempt {a.retry + 1} · {a.duration} ms · {date(a.createdAt)}
                </span>
              </div>
              {a.expectedStatus && (
                <small>
                  Expected: {a.expectedStatus} · actual: {a.actualStatus}
                </small>
              )}
              {a.note && <p>{a.note}</p>}
              {a.error && <pre>{a.error}</pre>}
              {(typeof a.attachments === "string"
                ? JSON.parse(a.attachments)
                : a.attachments
              ).map((f: any, i: number) => (
                <small key={i}>
                  {f.name} ·{" "}
                  {f.name === "screenshot"
                    ? e.evidence.some((ev) => ev.name.startsWith("playwright-"))
                      ? "Uploaded below as evidence"
                      : "Local artifact; use the CLI uploader to attach it"
                    : "Local artifact; not uploaded"}
                </small>
              ))}
            </div>
          ))}
        </details>
      )}
      <details className="evidence-details">
        <summary>
          Evidence & linked defects ({e.evidence.length} files/links ·{" "}
          {e.defects.length} defects)
        </summary>
        <div className="evidence-grid">
          {e.evidence.map((ev) => (
            <div className="evidence-item" key={ev.id}>
              {ev.url ? (
                <a href={ev.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={15} />
                  {ev.name}
                </a>
              ) : (
                <a
                  href={`/api/v1/evidence/${ev.id}/file`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img src={`/api/v1/evidence/${ev.id}/file`} alt={ev.name} />
                  {ev.name.startsWith("playwright-")
                    ? "Automated screenshot"
                    : ev.name}
                  <small>{bytes(ev.size)}</small>
                </a>
              )}
              <button
                className="icon-button"
                aria-label={`Delete evidence ${ev.name}`}
                onClick={() => {
                  if (
                    confirm(
                      "Permanently delete this selected evidence? Keep a backup if you need it.",
                    )
                  )
                    void task(async () => {
                      await api(`/evidence/${ev.id}`, "DELETE", {
                        confirm: true,
                      });
                      await p.done();
                    });
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="form-grid">
          <Form
            submit="Upload screenshot"
            onSubmit={async () => {
              if (!shot) throw new Error("Choose an image");
              const data = new FormData();
              data.append("screenshot", shot);
              await api(`/executions/${e.id}/evidence`, "POST", data);
              setShot(null);
              await p.done();
            }}
          >
            <Field label="Screenshot (max 2 MB)">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(x) => setShot(x.target.files?.[0] || null)}
              />
            </Field>
          </Form>
          <Form
            submit="Add evidence link"
            onSubmit={async () => {
              await api(`/executions/${e.id}/links`, "POST", {
                name: linkName,
                url: link,
              });
              setLink("");
              setLinkName("");
              await p.done();
            }}
          >
            <Field label="Link name">
              <input
                required
                value={linkName}
                onChange={(x) => setLinkName(x.target.value)}
              />
            </Field>
            <Field label="HTTPS evidence URL">
              <input
                type="url"
                required
                value={link}
                onChange={(x) => setLink(x.target.value)}
              />
            </Field>
          </Form>
        </div>
        {!!e.defects.length && (
          <div className="pills">
            {e.defects.map((d) => (
              <span key={d.id}>
                {d.title} <Badge value={d.severity} />
              </span>
            ))}
          </div>
        )}
        <Form
          submit="Link defect"
          onSubmit={async () => {
            if (!defectId) throw new Error("Choose a defect");
            await api(`/executions/${e.id}/defects`, "POST", { defectId });
            await p.done();
          }}
        >
          <Field label="Release defect">
            <select
              value={defectId}
              onChange={(x) => setDefectId(x.target.value)}
            >
              <option value="">Choose existing defect</option>
              {p.state.defects
                .filter((d) => d.releaseId === p.detail.run.releaseId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
            </select>
          </Field>
        </Form>
      </details>
    </Panel>
  );
}
