import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { api, date, percent } from "./api";
import { Pagination, usePagination } from "./Pagination";
import {
  Badge,
  Panel,
  Empty,
  Modal,
  Form,
  Field,
  CheckList,
  ErrorMessage,
  useTask,
} from "./components";
import type { PageProps, State, Plan } from "./types";
import { RunEditor } from "./run-editor";
import {
  automationIdentity,
  caseExecutionMode,
  executionModeCompatible,
  executionModeLabel,
  type ExecutionMode,
} from "./case-domain";
type DefectExecutionLink = {
  executionId: string;
  runId: string;
  planId: string;
  planName: string;
  build: string;
  runKind: string;
  releaseId: string;
  releaseName: string;
  caseId: string | null;
  caseTitle: string;
  latestStatus: string | null;
  flaky: boolean;
};
type DefectDetail = {
  defect: State["defects"][number];
  linkedExecutions: DefectExecutionLink[];
};

export function PlansPage(p: PageProps) {
  const [modal, setModal] = useState<"release" | "environment" | null>(null),
    [name, setName] = useState(""),
    [planning, setPlanning] = useState<string | null>(null),
    [running, setRunning] = useState<Plan | null>(null);
  return (
    <>
      <div className="toolbar">
        <span className="muted grow">
          Plans freeze case versions and execution targets.
        </span>
        <button
          onClick={() => {
            setName("");
            setModal("environment");
          }}
        >
          Add environment
        </button>
        <button
          className="primary"
          onClick={() => {
            setName("");
            setModal("release");
          }}
        >
          <Plus size={16} />
          New release
        </button>
      </div>
      {!p.state.releases.length ? (
        <Empty title="Start with a release">
          Create a release, then select approved cases for its test plan.
        </Empty>
      ) : (
        p.state.releases.map((r) => (
          <Panel
            key={r.id}
            title={r.name}
            action={
              <button onClick={() => setPlanning(r.id)}>
                <Plus size={15} />
                Create plan
              </button>
            }
          >
            {p.state.plans
              .filter((plan) => plan.releaseId === r.id)
              .map((plan) => (
                <div className="plan-row" key={plan.id}>
                  <div>
                    <strong>{plan.name}</strong>
                    <small>
                      {plan.items.length} required combinations · frozen scope
                    </small>
                  </div>
                  <button className="primary" onClick={() => setRunning(plan)}>
                    <Plus size={14} />
                    Start run
                  </button>
                  <details>
                    <summary>View scope</summary>
                    <ul>
                      {plan.items.map((i) => (
                        <li key={i.id}>
                          {i.title} ·{" "}
                          {
                            p.state.environments.find(
                              (e) => e.id === i.environmentId,
                            )?.name
                          }{" "}
                          · {i.browser}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ))}
            {!p.state.plans.some((plan) => plan.releaseId === r.id) && (
              <p className="muted">
                No plans yet. Approve test cases before adding a plan.
              </p>
            )}
          </Panel>
        ))
      )}
      <Panel title="Environments">
        {p.state.environments.length ? (
          <div className="pills">
            {p.state.environments.map((e) => (
              <Badge key={e.id} value={e.name} />
            ))}
          </div>
        ) : (
          <p className="muted">Add an environment such as staging or local.</p>
        )}
      </Panel>
      {modal && (
        <Modal
          title={modal === "release" ? "New release" : "Add environment"}
          onClose={() => setModal(null)}
        >
          <Form
            onCancel={() => setModal(null)}
            onSubmit={async () => {
              await api(
                `/projects/${p.projectId}/${modal === "release" ? "releases" : "environments"}`,
                "POST",
                { name },
              );
              await p.refresh();
              setModal(null);
            }}
          >
            <Field
              label={modal === "release" ? "Release name" : "Environment name"}
            >
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </Form>
        </Modal>
      )}
      {planning && (
        <PlanEditor {...p} rel={planning} close={() => setPlanning(null)} />
      )}
      {running && (
        <RunEditor
          plan={running}
          close={() => setRunning(null)}
          done={async (id) => {
            await p.refresh();
            p.navigate("Test Runs", id);
          }}
        />
      )}
    </>
  );
}
function PlanEditor(p: PageProps & { rel: string; close: () => void }) {
  const [name, setName] = useState(""),
    [ids, setIds] = useState<string[]>([]),
    [envs, setEnvs] = useState<string[]>([]),
    [browsers, setBrowsers] = useState("chromium"),
    [runKind, setRunKind] = useState<"manual" | "automated">("manual");
  const approved = p.state.cases.filter(
    (c) => c.status === "approved" && c.approved,
  );
  return (
    <Modal title="Create frozen plan" wide onClose={p.close}>
      <Form
        submit="Freeze plan"
        onCancel={p.close}
        onSubmit={async () => {
          if (!ids.length || !envs.length)
            throw new Error("Choose at least one case and environment");
          const bs = [
            ...new Set(
              browsers
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ];
          if (!bs.length) throw new Error("Add at least one browser");
          await api(`/releases/${p.rel}/plans`, "POST", {
            name,
            items: ids.flatMap((versionId) =>
              envs.flatMap((environmentId) =>
                bs.map((browser) => ({ versionId, environmentId, browser })),
              ),
            ),
          });
          await p.refresh();
          p.close();
        }}
      >
        <Field label="Plan name">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        {!!p.state.suites.length && (
          <Field label="Add cases from suite">
            <select
              defaultValue=""
              onChange={(e) => {
                const s = p.state.suites.find((x) => x.id === e.target.value);
                if (s)
                  setIds([
                    ...new Set([
                      ...ids,
                      ...approved
                        .filter((c) => s.caseIds.includes(c.id))
                        .map((c) => c.versionId),
                    ]),
                  ]);
              }}
            >
              <option value="">Choose suite</option>
              {p.state.suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field
          label="Check compatibility for"
          hint="Preview only. The plan freezes the selected case versions; choose the actual run type when starting a run."
        >
          <select
            value={runKind}
            onChange={(e) =>
              setRunKind(e.target.value as "manual" | "automated")
            }
          >
            <option value="manual">Manual run</option>
            <option value="automated">Automated run</option>
          </select>
        </Field>
        <CheckList
          label="Approved cases"
          items={approved.map((c) => ({
            id: c.versionId,
            title: c.title,
            detail: `${c.id} · v${c.number} · ${executionModeLabel[caseExecutionMode(c)]} · ${executionModeCompatible(caseExecutionMode(c), runKind) ? `eligible for ${runKind} runs` : `not eligible for ${runKind} runs`}`,
          }))}
          selected={ids}
          onChange={setIds}
        />
        <CheckList
          label="Environments"
          items={p.state.environments.map((e) => ({ id: e.id, title: e.name }))}
          selected={envs}
          onChange={setEnvs}
        />
        <Field
          label="Browsers (comma separated)"
          hint="Use Playwright project names unless your report provides browserName metadata."
        >
          <input
            required
            value={browsers}
            onChange={(e) => setBrowsers(e.target.value)}
          />
        </Field>
      </Form>
    </Modal>
  );
}
export function DefectsPage(p: PageProps) {
  const [creating, setCreating] = useState(false),
    [selectedDefect, setSelectedDefect] = useState<
      DefectDetail["defect"] | null
    >(null),
    [detail, setDetail] = useState<DefectDetail | null>(null),
    [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState(""),
    [openOnly, setOpenOnly] = useState(p.filter === "open"),
    [title, setTitle] = useState(""),
    [severity, setSeverity] = useState("medium"),
    [release, setRelease] = useState(
      p.releaseId || p.state.releases[0]?.id || "",
    ),
    [url, setUrl] = useState("");
  const { task, error } = useTask();
  const detailRequestId = useRef(0);
  const rows = p.state.defects.filter(
    (d) =>
      (!openOnly || d.status !== "closed") &&
      (p.filter !== "open" || !p.releaseId || d.releaseId === p.releaseId),
  );
  const defectPagination = usePagination(
    rows,
    JSON.stringify([p.projectId, openOnly, p.filter, p.releaseId]),
  );
  async function openDetails(defect: DefectDetail["defect"]) {
    const requestId = ++detailRequestId.current;
    setSelectedDefect(defect);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const result = await api<DefectDetail>(`/defects/${defect.id}`);
      if (requestId === detailRequestId.current) setDetail(result);
    } catch (error) {
      if (requestId === detailRequestId.current) {
        setDetailError(
          error instanceof Error
            ? error.message
            : "Could not load defect details. Please retry.",
        );
      }
    } finally {
      if (requestId === detailRequestId.current) setDetailLoading(false);
    }
  }
  return (
    <>
      <div className="toolbar">
        <label className="inline-check grow">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          Open defects only{p.filter === "open" ? " · selected release" : ""}
        </label>
        <button
          className="primary"
          disabled={!p.state.releases.length}
          onClick={() => setCreating(true)}
        >
          <Plus size={15} />
          New defect
        </button>
      </div>
      <ErrorMessage error={error} />
      <Panel
        title="Defect register"
        description={`${rows.length} matching defects`}
      >
        {rows.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Defect</th>
                    <th scope="col">Release</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Details</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {defectPagination.pageItems.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.title}</strong>
                        {d.url && (
                          <a href={d.url} target="_blank" rel="noreferrer">
                            External issue ↗
                          </a>
                        )}
                      </td>
                      <td>
                        {
                          p.state.releases.find((r) => r.id === d.releaseId)
                            ?.name
                        }
                      </td>
                      <td>
                        <select
                          aria-label={`Severity for ${d.title}`}
                          value={d.severity}
                          onChange={(e) =>
                            task(async () => {
                              await api(`/defects/${d.id}`, "PATCH", {
                                severity: e.target.value,
                              });
                              await p.refresh();
                            })
                          }
                        >
                          {["critical", "high", "medium", "low"].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          aria-label={`View details for ${d.title}`}
                          onClick={() => void openDetails(d)}
                        >
                          View details
                        </button>
                      </td>
                      <td>
                        <select
                          aria-label={`Status for ${d.title}`}
                          value={d.status}
                          onChange={(e) =>
                            task(async () => {
                              await api(`/defects/${d.id}`, "PATCH", {
                                status: e.target.value,
                              });
                              await p.refresh();
                            })
                          }
                        >
                          {["open", "in_progress", "closed"].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={defectPagination.page}
              pageCount={defectPagination.pageCount}
              pageSize={defectPagination.pageSize}
              total={defectPagination.total}
              onPageChange={defectPagination.setPage}
            />
          </>
        ) : (
          <Empty title="No matching defects">
            Create a release first, then record issues discovered while testing.
          </Empty>
        )}
      </Panel>
      {creating && (
        <Modal title="New defect" onClose={() => setCreating(false)}>
          <Form
            submit="Create defect"
            onCancel={() => setCreating(false)}
            onSubmit={async () => {
              await api(`/projects/${p.projectId}/defects`, "POST", {
                title,
                severity,
                releaseId: release,
                ...(url ? { url } : {}),
              });
              await p.refresh();
              setCreating(false);
              setTitle("");
            }}
          >
            <Field label="Defect title">
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Affected release">
              <select
                value={release}
                onChange={(e) => setRelease(e.target.value)}
              >
                {p.state.releases.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Severity">
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                {["critical", "high", "medium", "low"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="External issue URL (optional)">
              <input
                type="url"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
          </Form>
        </Modal>
      )}
      {selectedDefect && (
        <Modal
          title={`Defect details · ${selectedDefect.title}`}
          wide
          onClose={() => {
            detailRequestId.current += 1;
            setSelectedDefect(null);
            setDetail(null);
            setDetailError("");
            setDetailLoading(false);
          }}
        >
          <div>
            <div className="pills">
              <Badge
                value={detail?.defect.severity || selectedDefect.severity}
              />
              <Badge value={detail?.defect.status || selectedDefect.status} />
              <Badge
                value={
                  p.state.releases.find(
                    (r) =>
                      r.id ===
                      (detail?.defect.releaseId || selectedDefect.releaseId),
                  )?.name || "Release"
                }
              />
            </div>
            {(detail?.defect.url || selectedDefect.url) && (
              <p>
                <strong>External issue: </strong>
                <a
                  href={detail?.defect.url || selectedDefect.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {detail?.defect.url || selectedDefect.url} ↗
                </a>
              </p>
            )}
            {detailLoading && <p role="status">Loading linked executions…</p>}
            {!!detailError && (
              <>
                <ErrorMessage error={detailError} />
                <button onClick={() => void openDetails(selectedDefect)}>
                  Retry loading details
                </button>
              </>
            )}
            {detail && (
              <>
                <h3>Linked runs and executions</h3>
                {detail.linkedExecutions.length ? (
                  detail.linkedExecutions.map((execution) => (
                    <section className="list-row" key={execution.executionId}>
                      <div className="grow">
                        <strong>
                          {execution.caseTitle || "Unmatched execution"}
                        </strong>
                        <small>
                          {execution.caseId || "No mapped case"} ·{" "}
                          {execution.releaseName} · {execution.planName}
                        </small>
                        <small>
                          Build {execution.build || "—"} · {execution.runKind}{" "}
                          run · Execution {execution.executionId}
                        </small>
                        <small>
                          Latest result:{" "}
                          {execution.latestStatus || "No result recorded"}
                          {execution.flaky
                            ? " · flaky (passed after a failure)"
                            : ""}
                        </small>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedDefect(null);
                          p.navigate("Test Runs", execution.runId);
                        }}
                      >
                        Open run
                      </button>
                    </section>
                  ))
                ) : (
                  <p className="muted">
                    No linked executions are recorded for this defect.
                  </p>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
export function CoveragePage(p: PageProps) {
  const [create, setCreate] = useState(false),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [editing, setEditing] = useState<State["requirements"][number] | null>(
      null,
    ),
    [ids, setIds] = useState<string[]>([]);
  const mappingPagination = usePagination(p.state.mappings, p.projectId);
  return (
    <>
      <div className="coverage-summary">
        <div>
          <strong>{percent(p.state.requirementCoverage)}</strong>
          <span>Requirement coverage</span>
        </div>
        <div>
          <strong>{percent(p.state.automationCoverage)}</strong>
          <span>Automation coverage</span>
          <small>
            Verified mappings count for Automated and Both cases; Manual-only
            cases are excluded. Coverage divides mapped cases by all active
            approved cases.
          </small>
        </div>
      </div>
      <Panel
        title="Requirement traceability"
        action={
          <button className="primary" onClick={() => setCreate(true)}>
            <Plus size={15} />
            New requirement
          </button>
        }
      >
        {p.state.requirements.length ? (
          p.state.requirements.map((r) => (
            <div key={r.id} className="list-row">
              <div className="grow">
                <strong>{r.title}</strong>
                <small>{r.description}</small>
                <small>
                  {r.caseIds.length} linked cases ·{" "}
                  {
                    r.caseIds.filter((id) =>
                      p.state.cases.some(
                        (c) => c.id === id && c.status === "approved",
                      ),
                    ).length
                  }{" "}
                  approved
                </small>
              </div>
              <button
                onClick={() => {
                  setEditing(r);
                  setIds(r.caseIds);
                }}
              >
                Link cases
              </button>
            </div>
          ))
        ) : (
          <Empty title="Requirements not configured">
            Connect requirements to approved cases to measure coverage.
          </Empty>
        )}
      </Panel>
      <Panel
        title="Verified automation mappings"
        description="Mappings are verified through a case annotation or explicit assignment of an imported result."
      >
        {p.state.mappings.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Automation identity</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody>
                  {mappingPagination.pageItems.map((m) => (
                    <tr key={m.id}>
                      <td>
                        {p.state.cases.find((c) => c.id === m.caseId)?.title}
                        <small>{m.caseId}</small>
                      </td>
                      <td className="break-word">
                        {(() => {
                          const identity = automationIdentity(m.externalKey);
                          return (
                            <>
                              <strong>{identity.title}</strong>
                              {identity.file && <small>{identity.file}</small>}
                              {identity.project && (
                                <small>
                                  Playwright project: {identity.project}
                                </small>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td>
                        <Badge value={m.verified ? "verified" : "unverified"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={mappingPagination.page}
              pageCount={mappingPagination.pageCount}
              pageSize={mappingPagination.pageSize}
              total={mappingPagination.total}
              onPageChange={mappingPagination.setPage}
            />
          </>
        ) : (
          <Empty title="No verified mappings yet">
            Import a Playwright report with a stable case annotation, or map an
            unmatched test.
          </Empty>
        )}
      </Panel>
      {create && (
        <Modal title="New requirement" onClose={() => setCreate(false)}>
          <Form
            submit="Create requirement"
            onCancel={() => setCreate(false)}
            onSubmit={async () => {
              await api(`/projects/${p.projectId}/requirements`, "POST", {
                title,
                description,
              });
              await p.refresh();
              setCreate(false);
              setTitle("");
              setDescription("");
            }}
          >
            <Field label="Requirement title">
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
          </Form>
        </Modal>
      )}
      {editing && (
        <Modal
          title="Link requirement to cases"
          onClose={() => setEditing(null)}
        >
          <Form
            onSubmit={async () => {
              await api(`/requirements/${editing.id}/cases`, "PUT", {
                caseIds: ids,
              });
              await p.refresh();
              setEditing(null);
            }}
          >
            <p>{editing.title}</p>
            <CheckList
              items={p.state.cases.map((c) => ({
                id: c.id,
                title: c.title,
                detail: c.status,
              }))}
              selected={ids}
              onChange={setIds}
            />
          </Form>
        </Modal>
      )}
    </>
  );
}
