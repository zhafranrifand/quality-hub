import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  Layers,
  ClipboardList,
  Play,
  Flag,
  GitBranch,
  Settings,
  Plus,
  LogOut,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
  Menu,
} from "lucide-react";
import { api, setCsrf, percent, date } from "./api";
import {
  Badge,
  Empty,
  Loading,
  ErrorMessage,
  Panel,
  Metric,
  Modal,
  Form,
  Field,
} from "./components";
import type { Project, State, Page, Dashboard, PageProps } from "./types";
import { CasesPage } from "./cases";
import { PlansPage, CoveragePage, DefectsPage } from "./management";
import { RunsPage } from "./execution";
import { SettingsPage } from "./settings";
const nav: [Page, typeof Activity][] = [
  ["Overview", Activity],
  ["Test Cases", ClipboardList],
  ["Plans & Releases", Layers],
  ["Test Runs", Play],
  ["Defects", Flag],
  ["Coverage", GitBranch],
  ["Settings", Settings],
];
type BuildOption = { releaseId: string; build: string; createdAt: number };
export default function App() {
  const [session, setSession] = useState<{
      email: string;
      csrf: string;
    } | null>(null),
    [checking, setChecking] = useState(true),
    [projects, setProjects] = useState<Project[]>([]),
    [buildOptions, setBuildOptions] = useState<BuildOption[]>([]),
    [projectId, setProjectId] = useState(""),
    [state, setState] = useState<State | null>(null),
    [page, setPage] = useState<Page>("Overview"),
    [filter, setFilter] = useState(""),
    [releaseId, setReleaseId] = useState(""),
    [build, setBuild] = useState(""),
    [error, setError] = useState(""),
    [newProject, setNewProject] = useState(false),
    [name, setName] = useState(""),
    [sidebar, setSidebar] = useState(false);
  useEffect(() => {
    api("/session")
      .then((s) => {
        setSession(s);
        setCsrf(s.csrf);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
    const expired = () => setSession(null);
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (session) void loadProjects();
  }, [session]);
  async function loadProjects() {
    try {
      const ps = await api<Project[]>("/projects");
      setProjects(ps);
      setProjectId((prev) =>
        ps.some((p) => p.id === prev) ? prev : ps[0]?.id || "",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function refresh() {
    if (!projectId) return;
    setError("");
    const [s, builds] = await Promise.all([
      api<State>("/projects/" + projectId + "/state"),
      api<BuildOption[]>("/projects/" + projectId + "/builds"),
    ]);
    setState(s);
    setBuildOptions(builds);
    setReleaseId((prev) =>
      s.releases.some((r) => r.id === prev) ? prev : s.releases[0]?.id || "",
    );
  }
  useEffect(() => {
    setState(null);
    setBuildOptions([]);
    setReleaseId("");
    setBuild("");
    if (projectId) refresh().catch((e) => setError(e.message));
  }, [projectId]);
  useEffect(() => {
    if (state) {
      const candidates = buildOptions.filter((r) => r.releaseId === releaseId);
      setBuild((prev) =>
        candidates.some((r) => r.build === prev)
          ? prev
          : candidates[0]?.build || "",
      );
    }
  }, [state, buildOptions, releaseId]);
  const navigate = (next: Page, f = "") => {
    setPage(next);
    setFilter(f);
    setSidebar(false);
  };
  if (checking) return <Loading />;
  if (!session)
    return (
      <Login
        onLogin={(s) => {
          setCsrf(s.csrf);
          setSession(s);
        }}
      />
    );
  const props: PageProps = {
    projectId,
    state: state!,
    refresh,
    navigate,
    filter,
    releaseId,
    build,
  };
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (sidebar ? "open" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("Overview");
          }}
        >
          <span className="brand-mark">
            <ShieldCheck size={22} />
          </span>
          <span>
            Quality Hub<small>PERSONAL WORKSPACE</small>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          {nav.map(([label, Icon]) => (
            <button
              key={label}
              className={page === label ? "selected" : ""}
              onClick={() => navigate(label)}
            >
              <Icon size={18} />
              {label}
              {label === "Defects" &&
                !!state?.defects.filter((d) => d.status !== "closed")
                  .length && (
                  <span className="nav-count">
                    {state.defects.filter((d) => d.status !== "closed").length}
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">{session.email[0].toUpperCase()}</span>
          <div>
            <strong>Personal account</strong>
            <small>{session.email}</small>
          </div>
          <button
            aria-label="Sign out"
            className="icon-button"
            onClick={() =>
              api("/auth/logout", "POST", {})
                .then(() => setSession(null))
                .catch((e) => setError(e.message))
            }
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Toggle navigation"
              onClick={() => setSidebar(!sidebar)}
            >
              <Menu size={19} />
            </button>
            <span>Workspace</span>
            <span>/</span>
            <strong>{page}</strong>
          </div>
          <div className="topbar-actions">
            <select
              aria-label="Project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {!projects.length && <option value="">No projects</option>}
            </select>
            <button
              className="icon-button"
              aria-label="New project"
              onClick={() => setNewProject(true)}
            >
              <Plus size={18} />
            </button>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR QUALITY WORKSPACE</div>
              <h1>
                {page === "Overview" ? "A clearer view of quality." : page}
              </h1>
              <p>
                {
                  {
                    Overview:
                      "From test coverage to release confidence, in one place.",
                    "Test Cases":
                      "Build a reliable, versioned library of what matters.",
                    "Plans & Releases":
                      "Freeze your testing scope and track each release.",
                    "Test Runs": "Every result, retry, and piece of evidence.",
                    Defects: "Turn failures into a focused list of fixes.",
                    Coverage:
                      "Connect requirements, test cases, and automation.",
                    Settings:
                      "Private access, evidence storage, and portable backups.",
                  }[page]
                }
              </p>
            </div>
            {state && page !== "Settings" && (
              <button
                onClick={() => refresh().catch((e) => setError(e.message))}
              >
                <RefreshCw size={15} />
                Refresh
              </button>
            )}
          </div>
          <ErrorMessage error={error} />
          {page === "Settings" ? (
            <SettingsPage />
          ) : !projects.length ? (
            <Empty title="Your first quality workspace">
              Create a project to begin managing test cases and releases.
              <button className="primary" onClick={() => setNewProject(true)}>
                <Plus size={16} />
                Create project
              </button>
            </Empty>
          ) : !state ? (
            <Loading />
          ) : (
            <>
              {page === "Overview" && (
                <>
                  <div className="scope-bar">
                    <span className="scope-label">RELEASE SCOPE</span>
                    <select
                      aria-label="Release"
                      value={releaseId}
                      onChange={(e) => setReleaseId(e.target.value)}
                    >
                      <option value="">Select release</option>
                      {state.releases.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Build"
                      value={build}
                      onChange={(e) => setBuild(e.target.value)}
                    >
                      <option value="">Select build</option>
                      {buildOptions
                        .filter((option) => option.releaseId === releaseId)
                        .map((option) => (
                          <option
                            key={`${option.releaseId}:${option.build}`}
                            value={option.build}
                          >
                            {option.build}
                          </option>
                        ))}
                    </select>
                    <span className="scope-hint">Updates when you refresh</span>
                  </div>
                  <Overview {...props} />
                </>
              )}
              {page === "Test Cases" && <CasesPage {...props} />}
              {page === "Plans & Releases" && <PlansPage {...props} />}
              {page === "Test Runs" && <RunsPage {...props} />}
              {page === "Defects" && <DefectsPage {...props} />}
              {page === "Coverage" && <CoveragePage {...props} />}
            </>
          )}
        </div>
        <footer>
          Quality Hub <span>Personal QA workspace · v1.0</span>
        </footer>
      </main>
      {newProject && (
        <Modal title="Create project" onClose={() => setNewProject(false)}>
          <Form
            submit="Create project"
            onCancel={() => setNewProject(false)}
            onSubmit={async () => {
              const p = await api("/projects", "POST", { name });
              await loadProjects();
              setProjectId(p.id);
              setNewProject(false);
              setName("");
            }}
          >
            <Field label="Project name">
              <input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Checkout platform"
              />
            </Field>
          </Form>
        </Modal>
      )}
    </div>
  );
}
function Login({
  onLogin,
}: {
  onLogin: (s: { email: string; csrf: string }) => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  return (
    <div className="login">
      <section className="login-story">
        <span className="brand">
          <span className="brand-mark">
            <ShieldCheck />
          </span>
          Quality Hub
        </span>
        <div>
          <div className="eyebrow">CONFIDENCE IN EVERY RELEASE</div>
          <h1>
            Good testing.
            <br />
            Clear evidence.
            <br />
            <em>Better releases.</em>
          </h1>
          <p>
            Your test cases, manual checks, and Playwright results, connected in
            one private workspace.
          </p>
        </div>
        <span>Built for a thoughtful QA workflow.</span>
      </section>
      <section className="login-form">
        <div className="eyebrow">WELCOME BACK</div>
        <h2>Sign in to your workspace</h2>
        <p>Use the owner account configured for this deployment.</p>
        <Form
          submit="Sign in"
          onSubmit={async () =>
            onLogin(await api("/auth/login", "POST", { email, password }))
          }
        >
          <Field label="Email address">
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </Form>
        <small className="muted">
          Private by default. Only your owner account has access.
        </small>
      </section>
    </div>
  );
}
function Overview(p: PageProps) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api<Dashboard>(
      `/projects/${p.projectId}/dashboard?releaseId=${p.releaseId}&build=${encodeURIComponent(p.build)}`,
    )
      .then((d) => {
        if (live) {
          setDashboard(d);
          setError("");
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [p.state, p.releaseId, p.build]);
  if (error) return <ErrorMessage error={error} />;
  if (!dashboard) return <Loading />;
  const g = dashboard.gate;
  const open = p.state.defects.filter(
    (d) => d.status !== "closed" && d.releaseId === p.releaseId,
  );
  return (
    <>
      <div className="metrics">
        <Metric
          title="Release readiness"
          value={g?.status || "Unknown"}
          note={
            g
              ? `${g.rows.length} required combinations`
              : "Choose a release and build"
          }
          accent
          onClick={() => p.navigate("Test Runs", "gate")}
        />
        <Metric
          title="Pass rate"
          value={percent(g?.passRate)}
          note={
            g
              ? `${g.counts.passed} passed · ${g.counts.failed} failed`
              : "No executed tests"
          }
          onClick={() => p.navigate("Test Runs", "gate")}
        />
        <Metric
          title="Open defects"
          value={open.length}
          note={`${open.filter((d) => d.severity === "critical").length} critical in this release`}
          onClick={() => p.navigate("Defects", "open")}
        />
        <Metric
          title="Automation coverage"
          value={percent(dashboard.automationCoverage)}
          note="Verified mappings / approved cases"
          onClick={() => p.navigate("Coverage", "automation")}
        />
      </div>
      <div className="overview-grid">
        <Panel
          title="Release confidence"
          description="Evidence for the selected build"
          action={<Badge value={g?.status || "Unknown"} />}
        >
          {g ? (
            <>
              <div className="gate-reasons">
                {g.reasons.map((r) => (
                  <div key={r}>
                    <span
                      className={
                        "status-dot " + g.status.toLowerCase().replace(" ", "-")
                      }
                    />
                    {r}
                  </div>
                ))}
              </div>
              <div className="progress-heading">
                <span>Execution completion</span>
                <strong>{percent(g.completion)}</strong>
              </div>
              <div className="progress-track">
                <div style={{ width: `${g.completion || 0}%` }} />
              </div>
              <div className="execution-counts">
                {[
                  ["passed", "Passed"],
                  ["failed", "Failed"],
                  ["blocked", "Blocked"],
                  ["skipped", "Skipped"],
                  ["not_run", "Not run"],
                  ["interrupted", "Interrupted"],
                  ["expected_failure", "Expected failure"],
                ].map(([key, label]) => (
                  <div key={key}>
                    <strong>{g.counts[key as keyof typeof g.counts]}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <button
                className="text-button"
                onClick={() => p.navigate("Test Runs", "gate")}
              >
                Inspect required results <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <Empty title="Build your release picture">
              Create approved cases, freeze a plan, and start a test run.
              <button onClick={() => p.navigate("Plans & Releases")}>
                Set up a release
              </button>
            </Empty>
          )}
        </Panel>
        <Panel
          title="Coverage snapshot"
          description="Linked evidence across your project"
        >
          <CoverageBar
            label="Automation coverage"
            value={dashboard.automationCoverage}
          />
          <CoverageBar
            label="Requirement coverage"
            value={dashboard.requirementCoverage}
          />
          <div className="inventory">
            <div>
              <strong>
                {p.state.cases.filter((c) => c.status === "approved").length}
              </strong>
              <span>Approved cases</span>
            </div>
            <div>
              <strong>
                {p.state.cases.filter((c) => c.status === "draft").length}
              </strong>
              <span>Draft cases</span>
            </div>
            <div>
              <strong>{p.state.requirements.length}</strong>
              <span>Requirements</span>
            </div>
          </div>
          <button
            className="text-button"
            onClick={() => p.navigate("Coverage")}
          >
            Explore coverage <ArrowRight size={15} />
          </button>
        </Panel>
      </div>
      <div className="overview-grid">
        <Panel
          title="Build trend"
          description="Pass rate · latest 10 builds in this release"
        >
          {dashboard.trend.length ? (
            <div className="trend">
              {dashboard.trend.map((d) => (
                <div className="trend-column" key={d.build}>
                  <strong>{percent(d.passRate)}</strong>
                  <div className="trend-track">
                    <div style={{ height: `${d.passRate || 0}%` }} />
                  </div>
                  <span>{d.build}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Trends start with your first run">
              Completed results will appear here.
            </Empty>
          )}
        </Panel>
        <Panel
          title="Recent test runs"
          action={
            <button
              className="text-button"
              onClick={() => p.navigate("Test Runs")}
            >
              View all <ArrowRight size={14} />
            </button>
          }
        >
          {dashboard.recentRuns.length ? (
            <div className="list">
              {dashboard.recentRuns.map((r) => (
                <button
                  className="list-row"
                  key={r.id}
                  onClick={() => p.navigate("Test Runs", r.id)}
                >
                  <span className="run-icon">
                    <Play size={15} />
                  </span>
                  <span className="grow">
                    <strong>{r.planName}</strong>
                    <small>
                      {r.build} · {date(r.createdAt)}
                    </small>
                  </span>
                  <Badge value={r.kind} />
                </button>
              ))}
            </div>
          ) : (
            <Empty title="No test runs yet">
              Your manual and automated runs will appear here.
            </Empty>
          )}
        </Panel>
      </div>
    </>
  );
}
export function CoverageBar({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="coverage-bar">
      <div>
        <span>{label}</span>
        <strong>{value == null ? "Not configured" : percent(value)}</strong>
      </div>
      <div className="progress-track">
        <div style={{ width: `${value || 0}%` }} />
      </div>
    </div>
  );
}
