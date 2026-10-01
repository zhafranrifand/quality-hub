import { useState } from "react";
import {
  Plus,
  Search,
  Copy,
  Check,
  Archive,
  Pencil,
  History,
  ArrowRight,
} from "lucide-react";
import { api, date } from "./api";
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
import type { PageProps, Case, CaseContent, State } from "./types";
import {
  caseExecutionMode,
  executionModeLabel,
  versionChanges,
  type ExecutionMode,
} from "./case-domain";

type EditableCaseContent = CaseContent & { executionMode: ExecutionMode };
const blank: EditableCaseContent = {
  title: "",
  preconditions: "",
  steps: [{ action: "", expected: "" }],
  priority: "medium",
  component: "",
  tags: [],
  executionMode: "both",
};
export function CasesPage(p: PageProps) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [method, setMethod] = useState<ExecutionMode | "all">("all"),
    [suiteId, setSuiteId] = useState(""),
    [editing, setEditing] = useState<Case | null | undefined>(undefined),
    [history, setHistory] = useState<any[] | null>(null),
    [suite, setSuite] = useState<State["suites"][number] | null | undefined>(
      undefined,
    );
  const { task, error } = useTask();
  const filtered = p.state.cases.filter(
    (c) =>
      (status === "all" || c.status === status) &&
      (method === "all" || caseExecutionMode(c) === method) &&
      (!suiteId ||
        p.state.suites.find((s) => s.id === suiteId)?.caseIds.includes(c.id)) &&
      [c.id, c.title, c.component, ...c.tags]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const casePagination = usePagination(
    filtered,
    JSON.stringify([p.projectId, query, status, method, suiteId]),
  );
  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Search cases"
            placeholder="Search cases, tags, or components"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          aria-label="Case status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {["all", "draft", "approved", "deprecated"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          aria-label="Execution method filter"
          value={method}
          onChange={(e) => setMethod(e.target.value as ExecutionMode | "all")}
        >
          <option value="all">All methods</option>
          {Object.entries(executionModeLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Test suite"
          value={suiteId}
          onChange={(e) => setSuiteId(e.target.value)}
        >
          <option value="">All suites</option>
          {p.state.suites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button onClick={() => setSuite(null)}>New suite</button>
        <button className="primary" onClick={() => setEditing(null)}>
          <Plus size={16} />
          New test case
        </button>
      </div>
      <ErrorMessage error={error} />
      <Panel
        title="Test case library"
        description={`${filtered.length} cases · approved revisions are preserved`}
      >
        {filtered.length ? (
          <>
            <div className="table-wrap">
              <table style={{ minWidth: 820 }}>
                <thead>
                  <tr>
                    <th scope="col">Test case</th>
                    <th scope="col">Component</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Method</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {casePagination.pageItems.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.title}</strong>
                        <small>
                          {c.id} · v{c.number}
                          {c.tags.length ? ` · ${c.tags.join(", ")}` : ""}
                        </small>
                      </td>
                      <td>{c.component || "—"}</td>
                      <td>
                        <Badge value={c.priority} />
                      </td>
                      <td>
                        <Badge
                          value={executionModeLabel[caseExecutionMode(c)]}
                        />
                      </td>
                      <td>
                        <Badge value={c.status} />
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            aria-label={`Edit ${c.title}`}
                            onClick={() => setEditing(c)}
                            disabled={c.status === "deprecated"}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            aria-label={`History ${c.title}`}
                            onClick={() =>
                              task(async () =>
                                setHistory(
                                  await api(`/cases/${c.id}/versions`),
                                ),
                              )
                            }
                          >
                            <History size={15} />
                          </button>
                          {c.status === "draft" && (
                            <button
                              aria-label={`Approve ${c.title}`}
                              onClick={() =>
                                task(async () => {
                                  await api(
                                    `/cases/${c.id}/approve`,
                                    "POST",
                                    {},
                                  );
                                  await p.refresh();
                                })
                              }
                            >
                              <Check size={15} />
                            </button>
                          )}
                          <button
                            aria-label={`Duplicate ${c.title}`}
                            onClick={() =>
                              task(async () => {
                                await api(
                                  `/cases/${c.id}/duplicate`,
                                  "POST",
                                  {},
                                );
                                await p.refresh();
                              })
                            }
                          >
                            <Copy size={15} />
                          </button>
                          {c.status !== "deprecated" && (
                            <button
                              aria-label={`Deprecate ${c.title}`}
                              onClick={() => {
                                if (
                                  confirm(
                                    "Deprecate this case? Existing plans and results are preserved.",
                                  )
                                )
                                  void task(async () => {
                                    await api(
                                      `/cases/${c.id}/deprecate`,
                                      "POST",
                                      {},
                                    );
                                    await p.refresh();
                                  });
                              }}
                            >
                              <Archive size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={casePagination.page}
              pageCount={casePagination.pageCount}
              pageSize={casePagination.pageSize}
              total={casePagination.total}
              onPageChange={casePagination.setPage}
            />
          </>
        ) : (
          <Empty title="Define what good looks like">
            Create a test case with clear steps and expected results.
          </Empty>
        )}
      </Panel>
      {!!p.state.suites.length && (
        <Panel
          title="Reusable suites"
          description="Organize smoke, regression, and feature checks"
        >
          <div className="suite-grid">
            {p.state.suites.map((s) => (
              <button key={s.id} className="suite" onClick={() => setSuite(s)}>
                <strong>{s.name}</strong>
                <span>
                  {s.caseIds.length} cases <ArrowRight size={14} />
                </span>
              </button>
            ))}
          </div>
        </Panel>
      )}
      {editing !== undefined && (
        <CaseEditor
          initial={editing}
          projectId={p.projectId}
          close={() => setEditing(undefined)}
          done={p.refresh}
        />
      )}
      {suite !== undefined && (
        <CollectionEditor
          title={suite ? "Edit suite" : "Create suite"}
          initial={suite}
          cases={p.state.cases}
          close={() => setSuite(undefined)}
          save={async (name, caseIds) => {
            await api(
              suite ? `/suites/${suite.id}` : `/projects/${p.projectId}/suites`,
              suite ? "PUT" : "POST",
              { name, caseIds },
            );
            await p.refresh();
            setSuite(undefined);
          }}
        />
      )}
      {history && (
        <Modal
          title="Case version history"
          wide
          onClose={() => setHistory(null)}
        >
          {history.map((v, index) => (
            <section className="history-version" key={v.id}>
              <h3>
                Version {v.number}{" "}
                <Badge value={v.approved ? "approved" : "draft"} />
              </h3>
              <small>{date(v.createdAt)}</small>
              <div className="muted">
                <strong>Changes from the previous version</strong>
                <ul>
                  {versionChanges(v.content, history[index + 1]?.content).map(
                    (change) => (
                      <li key={change.label}>
                        <strong>{change.label}</strong>
                        {!!change.after && (
                          <small>
                            Before: {change.before} → After: {change.after}
                          </small>
                        )}
                      </li>
                    ),
                  )}
                </ul>
              </div>
              <h4>{v.content.title}</h4>
              <p>{v.content.preconditions}</p>
              <ol>
                {v.content.steps.map((s: any, i: number) => (
                  <li key={i}>
                    {s.action}
                    <small>Expected: {s.expected || "—"}</small>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </Modal>
      )}
    </>
  );
}
function CaseEditor({
  initial,
  projectId,
  close,
  done,
}: {
  initial: Case | null;
  projectId: string;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [value, setValue] = useState<EditableCaseContent>(
      initial
        ? {
            title: initial.title,
            preconditions: initial.preconditions,
            steps: initial.steps.map((s) => ({ ...s })),
            priority: initial.priority,
            component: initial.component,
            tags: initial.tags,
            executionMode: caseExecutionMode(initial),
          }
        : structuredClone(blank),
    ),
    [tags, setTags] = useState(initial?.tags.join(", ") || "");
  return (
    <Modal
      title={initial ? "Edit test case" : "New test case"}
      wide
      onClose={close}
    >
      <Form
        submit={initial ? "Save new revision" : "Create test case"}
        onCancel={close}
        onSubmit={async () => {
          await api(
            initial ? `/cases/${initial.id}` : `/projects/${projectId}/cases`,
            initial ? "PUT" : "POST",
            {
              ...value,
              tags: tags
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            },
          );
          await done();
          close();
        }}
      >
        <Field label="Case title">
          <input
            required
            value={value.title}
            onChange={(e) => setValue({ ...value, title: e.target.value })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Component">
            <input
              value={value.component}
              onChange={(e) =>
                setValue({ ...value, component: e.target.value })
              }
            />
          </Field>
          <Field label="Priority">
            <select
              value={value.priority}
              onChange={(e) =>
                setValue({ ...value, priority: e.target.value as any })
              }
            >
              {["critical", "high", "medium", "low"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Execution method">
            <select
              value={value.executionMode}
              onChange={(e) =>
                setValue({
                  ...value,
                  executionMode: e.target.value as ExecutionMode,
                })
              }
            >
              {Object.entries(executionModeLabel).map(([mode, label]) => (
                <option key={mode} value={mode}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Tags (comma separated)">
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="Preconditions">
          <textarea
            value={value.preconditions}
            onChange={(e) =>
              setValue({ ...value, preconditions: e.target.value })
            }
          />
        </Field>
        <div className="steps-heading">
          <h3>Test steps</h3>
          <button
            type="button"
            onClick={() =>
              setValue({
                ...value,
                steps: [...value.steps, { action: "", expected: "" }],
              })
            }
          >
            <Plus size={14} />
            Add step
          </button>
        </div>
        {value.steps.map((s, i) => (
          <div className="step-editor" key={i}>
            <span className="step-number">{i + 1}</span>
            <div className="grow">
              <Field label={`Step ${i + 1} action`}>
                <textarea
                  required
                  value={s.action}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      steps: value.steps.map((x, n) =>
                        n === i ? { ...x, action: e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
              <Field label={`Step ${i + 1} expected result`}>
                <textarea
                  value={s.expected}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      steps: value.steps.map((x, n) =>
                        n === i ? { ...x, expected: e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
            </div>
            <button
              type="button"
              aria-label={`Remove step ${i + 1}`}
              disabled={value.steps.length === 1}
              onClick={() =>
                setValue({
                  ...value,
                  steps: value.steps.filter((_, n) => n !== i),
                })
              }
            >
              ×
            </button>
          </div>
        ))}
      </Form>
    </Modal>
  );
}
function CollectionEditor({
  title,
  initial,
  cases,
  close,
  save,
}: {
  title: string;
  initial: { name: string; caseIds: string[] } | null;
  cases: Case[];
  close: () => void;
  save: (name: string, ids: string[]) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name || ""),
    [ids, setIds] = useState(initial?.caseIds || []);
  return (
    <Modal title={title} onClose={close}>
      <Form onCancel={close} onSubmit={() => save(name, ids)}>
        <Field label="Suite name">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <CheckList
          items={cases
            .filter((c) => c.status !== "deprecated")
            .map((c) => ({ id: c.id, title: c.title, detail: c.id }))}
          selected={ids}
          onChange={setIds}
        />
      </Form>
    </Modal>
  );
}
