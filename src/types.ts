import type { CaseContent, ExecutionStatus, Gate } from "../shared/contracts";
export type { CaseContent, ExecutionStatus, Gate };
export type Project = { id: string; name: string };
export type SyncedAutomation = NonNullable<CaseContent["automationSource"]>;
export type Case = CaseContent & {
  id: string;
  versionId: string;
  number: number;
  status: string;
  approved: boolean;
  createdAt: number;
};
export type AutomationTokenScope =
  | "read_only"
  | "edit"
  | "upload"
  | "runner"
  | "automation_sync";
export type AutomationPlanOption = {
  id: string;
  name: string;
  releaseName: string;
  projectId: string;
  projectName: string;
};
export type StoredAutomationToken = {
  id: string;
  name: string;
  scope?: AutomationTokenScope;
  planId?: string | null;
  planName?: string | null;
  createdAt: number;
};
export type PlanItem = {
  id: string;
  versionId: string;
  caseId: string;
  environmentId: string;
  browser: string;
  title: string;
};
export type Plan = {
  id: string;
  releaseId: string;
  name: string;
  items: PlanItem[];
};
export type Run = {
  id: string;
  planId: string;
  planName?: string;
  releaseId?: string;
  build: string;
  kind: string;
  createdAt: number;
  complete: boolean;
  imported: boolean;
};
export type Defect = {
  id: string;
  releaseId: string;
  title: string;
  severity: string;
  status: string;
  url?: string;
  createdAt: number;
};
export type State = {
  cases: Case[];
  releases: { id: string; name: string }[];
  plans: Plan[];
  environments: { id: string; name: string }[];
  requirements: {
    id: string;
    title: string;
    description: string;
    caseIds: string[];
  }[];
  suites: { id: string; name: string; caseIds: string[] }[];
  runs: Run[];
  defects: Defect[];
  mappings: {
    id: string;
    caseId: string;
    externalKey: string;
    verified: boolean;
  }[];
  automationCoverage: number | null;
  requirementCoverage: number | null;
};
export type Attempt = {
  id: string;
  status: ExecutionStatus;
  note: string;
  error: string;
  retry: number;
  duration: number;
  createdAt: number;
  expectedStatus?: string;
  actualStatus?: string;
  attachments: string | { name: string; path?: string; contentType?: string }[];
};
export type Evidence = {
  id: string;
  name: string;
  url?: string;
  path?: string;
  mime?: string;
  size: number;
};
export type Execution = {
  id: string;
  planItemId: string | null;
  caseId?: string;
  versionId?: string;
  content?: CaseContent;
  title: string;
  browser: string;
  projectName?: string;
  flaky: boolean;
  attempts: Attempt[];
  evidence: Evidence[];
  defects: Defect[];
};
export type RunDetail = {
  run: Run;
  executions: Execution[];
  unmatched: Execution[];
};
export type Dashboard = {
  gate: Gate;
  automationCoverage: number | null;
  requirementCoverage: number | null;
  trend: { build: string; passRate: number | null }[];
  recentRuns: Run[];
};
export type Page =
  | "Overview"
  | "Test Cases"
  | "Plans & Releases"
  | "Test Runs"
  | "Defects"
  | "Coverage"
  | "Settings";
export type Navigate = (page: Page, filter?: string) => void;
export type PageProps = {
  projectId: string;
  state: State;
  refresh: () => Promise<void>;
  navigate: Navigate;
  filter: string;
  releaseId: string;
  build: string;
};
