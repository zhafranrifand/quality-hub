import type { Case, CaseContent } from "./types";
import type { ExecutionMode } from "../shared/contracts";

export type { ExecutionMode };

export type AutomationIdentity = {
  title: string;
  file: string;
  project: string;
};

export type VersionChange = {
  label: string;
  before: string;
  after: string;
};

export const executionModeLabel: Record<ExecutionMode, string> = {
  manual: "Manual",
  automated: "Automated",
  both: "Both",
};

export function caseExecutionMode(testCase: Case): ExecutionMode {
  const mode = testCase.executionMode;
  return mode === "manual" || mode === "automated" ? mode : "both";
}

export function executionModeCompatible(
  mode: ExecutionMode,
  runKind: string,
): boolean {
  return mode === "both" || mode === runKind;
}

export function automationIdentity(externalKey: string): AutomationIdentity {
  try {
    const parsed: unknown = JSON.parse(externalKey);
    if (Array.isArray(parsed)) {
      const [file, title, project] = parsed.map((part) =>
        typeof part === "string" ? part.trim() : "",
      );
      return {
        title: title || file || externalKey,
        file: title && file ? file : "",
        project: project || "",
      };
    }

    if (parsed && typeof parsed === "object") {
      const identity = parsed as Record<string, unknown>;
      const file = typeof identity.file === "string" ? identity.file : "";
      const title = typeof identity.title === "string" ? identity.title : "";
      const project =
        typeof identity.projectName === "string" ? identity.projectName : "";
      if (file || title) {
        return { title: title || file, file: title ? file : "", project };
      }
    }
  } catch {
    // Older mappings may be plain text rather than structured identities.
  }

  return {
    title: externalKey || "Unlabelled automation",
    file: "",
    project: "",
  };
}

export function versionChanges(
  current: CaseContent,
  older?: CaseContent,
): VersionChange[] {
  if (!older) return [{ label: "Initial version", before: "", after: "" }];

  const changes: VersionChange[] = [];
  const fields: [keyof CaseContent, string][] = [
    ["title", "Title"],
    ["preconditions", "Preconditions"],
    ["priority", "Priority"],
    ["component", "Component"],
    ["executionMode", "Execution method"],
  ];

  for (const [key, label] of fields) {
    const oldValue =
      key === "executionMode"
        ? older.executionMode || "both"
        : (older[key] ?? "");
    const newValue =
      key === "executionMode"
        ? current.executionMode || "both"
        : (current[key] ?? "");

    if (newValue !== oldValue) {
      changes.push({
        label,
        before:
          key === "executionMode"
            ? executionModeLabel[oldValue as ExecutionMode]
            : String(oldValue || "—"),
        after:
          key === "executionMode"
            ? executionModeLabel[newValue as ExecutionMode]
            : String(newValue || "—"),
      });
    }
  }

  if (JSON.stringify(current.tags) !== JSON.stringify(older.tags)) {
    changes.push({
      label: "Tags",
      before: older.tags.join(", ") || "—",
      after: current.tags.join(", ") || "—",
    });
  }

  const oldSteps = older.steps || [];
  const newSteps = current.steps || [];
  for (
    let index = 0;
    index < Math.max(oldSteps.length, newSteps.length);
    index++
  ) {
    const oldStep = oldSteps[index];
    const newStep = newSteps[index];

    if (!oldStep) {
      changes.push({
        label: `Step ${index + 1} added`,
        before: "—",
        after: `${newStep.action} · Expected: ${newStep.expected || "—"}`,
      });
    } else if (!newStep) {
      changes.push({
        label: `Step ${index + 1} removed`,
        before: `${oldStep.action} · Expected: ${oldStep.expected || "—"}`,
        after: "—",
      });
    } else {
      if (oldStep.action !== newStep.action) {
        changes.push({
          label: `Step ${index + 1} action`,
          before: oldStep.action || "—",
          after: newStep.action || "—",
        });
      }
      if (oldStep.expected !== newStep.expected) {
        changes.push({
          label: `Step ${index + 1} expected result`,
          before: oldStep.expected || "—",
          after: newStep.expected || "—",
        });
      }
    }
  }

  return changes.length
    ? changes
    : [{ label: "No differences in tracked fields", before: "", after: "" }];
}
