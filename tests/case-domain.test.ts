import { describe, expect, it } from "vitest";
import {
  automationIdentity,
  caseExecutionMode,
  executionModeCompatible,
  versionChanges,
} from "../src/case-domain";
import type { Case, CaseContent } from "../src/types";

const testCase = (executionMode?: CaseContent["executionMode"]) =>
  ({ executionMode }) as Case;

const content: CaseContent = {
  title: "Sign in",
  preconditions: "User has an account",
  steps: [{ action: "Enter credentials", expected: "User is signed in" }],
  priority: "high",
  component: "Authentication",
  tags: ["auth"],
  executionMode: "both",
};

describe("case domain rules", () => {
  it("normalizes legacy or absent execution modes to both", () => {
    expect(caseExecutionMode(testCase(undefined))).toBe("both");
    expect(caseExecutionMode(testCase("manual"))).toBe("manual");
    expect(caseExecutionMode(testCase("automated"))).toBe("automated");
  });

  it("checks whether a case can run in a selected execution mode", () => {
    expect(executionModeCompatible("both", "manual")).toBe(true);
    expect(executionModeCompatible("manual", "manual")).toBe(true);
    expect(executionModeCompatible("automated", "manual")).toBe(false);
  });

  it("parses supported automation identities and falls back to legacy labels", () => {
    expect(
      automationIdentity(
        JSON.stringify({
          file: "tests/auth.spec.ts",
          title: "sign in",
          projectName: "chromium",
        }),
      ),
    ).toEqual({
      title: "sign in",
      file: "tests/auth.spec.ts",
      project: "chromium",
    });
    expect(automationIdentity("legacy mapping").title).toBe("legacy mapping");
    expect(automationIdentity("").title).toBe("Unlabelled automation");
  });

  it("describes tracked content changes while preserving legacy mode defaults", () => {
    expect(versionChanges(content)).toEqual([
      { label: "Initial version", before: "", after: "" },
    ]);
    expect(
      versionChanges(content, { ...content, title: "Log in" }),
    ).toContainEqual({
      label: "Title",
      before: "Log in",
      after: "Sign in",
    });
    expect(
      versionChanges(content, { ...content, executionMode: undefined }),
    ).toEqual([
      { label: "No differences in tracked fields", before: "", after: "" },
    ]);
  });
});
