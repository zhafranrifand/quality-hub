import { describe, expect, it } from "vitest";
import {
  hashGherkinManifestEntry,
  parseGherkinManifest,
  type GherkinManifestInput,
} from "../../../scripts/gherkin-manifest";

const feature = (
  relativePath: string,
  source: string,
): GherkinManifestInput => ({ relativePath, source });

describe("Gherkin manifest parser", () => {
  it("captures scenario metadata, inherited tags/backgrounds, and exact scenario source", () => {
    const source = [
      "@product @smoke",
      "Feature: Workspace access",
      "  Background: account setup",
      "    Given an active account",
      "  @web",
      "  Rule: email flow",
      "    Background: browser setup",
      "      And a supported browser",
      "    @qh_key_lokasi_auth_empty_email @critical @TC-OLDCASE",
      "    Scenario: valid email advances",
      "      Verifies the email step without submitting credentials.",
      "      When I enter a valid email",
      "      Then the password form appears",
      "",
    ].join("\n");

    const [entry] = parseGherkinManifest([
      feature("tests/features/access.feature", source),
    ]);

    expect(entry).toEqual({
      key: "lokasi_auth_empty_email",
      title: "valid email advances",
      featurePath: "tests/features/access.feature",
      tags: [
        "@product",
        "@smoke",
        "@web",
        "@qh_key_lokasi_auth_empty_email",
        "@critical",
        "@TC-OLDCASE",
      ],
      legacyCaseId: "TC-OLDCASE",
      background: ["Given an active account", "And a supported browser"],
      steps: [
        { keyword: "When", text: "I enter a valid email" },
        { keyword: "Then", text: "the password form appears" },
      ],
      gherkin:
        [
          "    @qh_key_lokasi_auth_empty_email @critical @TC-OLDCASE",
          "    Scenario: valid email advances",
          "      Verifies the email step without submitting credentials.",
          "      When I enter a valid email",
          "      Then the password form appears",
        ].join("\n") + "\n",
    });
    expect(Object.keys(entry).sort()).toEqual(
      [
        "background",
        "featurePath",
        "gherkin",
        "key",
        "legacyCaseId",
        "steps",
        "tags",
        "title",
      ].sort(),
    );
    expect(hashGherkinManifestEntry(entry)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves scenario declaration order and normalizes relative paths", () => {
    const entries = parseGherkinManifest([
      feature(
        ".\\tests\\access.feature",
        [
          "Feature: Access",
          "  @qh_key_first",
          "  Scenario: first",
          "    Given a state",
          "  @qh_key_second",
          "  Scenario: second",
          "    When an action",
        ].join("\n"),
      ),
    ]);

    expect(
      entries.map(({ key, title, featurePath }) => [key, title, featurePath]),
    ).toEqual([
      ["first", "first", "tests/access.feature"],
      ["second", "second", "tests/access.feature"],
    ]);
  });

  it("accepts lowercase key slugs containing both underscores and hyphens", () => {
    const [entry] = parseGherkinManifest([
      feature(
        "hyphen.feature",
        "Feature: Hyphenated key\n  @qh_key_checkout-v2_smoke\n  Scenario: checkout smoke\n    Then it passes\n",
      ),
    ]);
    expect(entry.key).toBe("checkout-v2_smoke");
  });

  it("preserves Background data tables and doc strings in the synced preconditions", () => {
    const [entry] = parseGherkinManifest([
      feature(
        "background-data.feature",
        [
          "Feature: API setup",
          "  Background: request setup",
          "    Given the request has headers",
          "      | name          | value          |",
          "      | Content-Type  | application/json |",
          "    And the request body is",
          '      """json',
          '      {"active": true}',
          '      """',
          "  @qh_key_request_has_context",
          "  Scenario: request uses setup data",
          "    Then the result is recorded",
        ].join("\n"),
      ),
    ]);

    expect(entry.background).toEqual([
      "Given the request has headers\n| name | value |\n| Content-Type | application/json |",
      'And the request body is\n""" json\n{"active": true}\n"""',
    ]);
  });

  it("keeps Gherkin source and content hashes scoped to each scenario", () => {
    const firstSource = [
      "@suite",
      "Feature: Two checks",
      "  Background: shared setup",
      "    Given the service is ready",
      "  @qh_key_first_check",
      "  Scenario: first check",
      "    When the first action runs",
      "    Then the first result appears",
      "  @qh_key_second_check",
      "  Scenario: second check",
      "    When the unrelated action runs",
      "    Then the unrelated result appears",
    ].join("\n");
    const changedSecondSource = firstSource.replace(
      "the unrelated result appears",
      "a different unrelated result appears",
    );
    const changedFirstSource = firstSource.replace(
      "the first result appears",
      "a changed first result appears",
    );

    const [before] = parseGherkinManifest([
      feature("checks.feature", firstSource),
    ]);
    const [after] = parseGherkinManifest([
      feature("checks.feature", changedSecondSource),
    ]);
    const [changed] = parseGherkinManifest([
      feature("checks.feature", changedFirstSource),
    ]);

    expect(before.gherkin).not.toContain("second check");
    expect(before.gherkin).toContain("first result appears");
    expect(before.background).toEqual(["Given the service is ready"]);
    expect(after.gherkin).toBe(before.gherkin);
    expect(hashGherkinManifestEntry(after)).toBe(
      hashGherkinManifestEntry(before),
    );
    expect(hashGherkinManifestEntry(changed)).not.toBe(
      hashGherkinManifestEntry(before),
    );
  });

  it("requires exactly one scenario-level case key", () => {
    expect(() =>
      parseGherkinManifest([
        feature("access.feature", "Feature: Access\n  Scenario: missing key\n"),
      ]),
    ).toThrow(/access\.feature:2:.*exactly one.*found 0/);

    expect(() =>
      parseGherkinManifest([
        feature(
          "access.feature",
          "Feature: Access\n  @qh_key_one @qh_key_two\n  Scenario: too many\n",
        ),
      ]),
    ).toThrow(/exactly one.*found 2/);
  });

  it("rejects malformed and inherited case keys with actionable locations", () => {
    expect(() =>
      parseGherkinManifest([
        feature(
          "access.feature",
          "Feature: Access\n  @qh_key_Bad_slug\n  Scenario: invalid key\n",
        ),
      ]),
    ).toThrow(/access\.feature:3:.*malformed case key.*lowercase-slug/);

    expect(() =>
      parseGherkinManifest([
        feature(
          "access.feature",
          "@qh_key_parent\nFeature: Access\n  @qh_key_child\n  Scenario: inherited key\n",
        ),
      ]),
    ).toThrow(/access\.feature:1:.*must be placed on a Scenario/);
  });

  it("rejects duplicate keys across feature files", () => {
    expect(() =>
      parseGherkinManifest([
        feature(
          "one.feature",
          "Feature: One\n  @qh_key_shared\n  Scenario: first\n",
        ),
        feature(
          "two.feature",
          "Feature: Two\n  @qh_key_shared\n  Scenario: second\n",
        ),
      ]),
    ).toThrow(/two\.feature:3: duplicate.*@qh_key_shared.*one\.feature:3/);
  });

  it("captures an existing Quality Hub case ID and rejects conflicting legacy IDs", () => {
    const entry = parseGherkinManifest([
      feature(
        "legacy.feature",
        [
          "Feature: Existing case",
          "  @qh_key_existing_case @TC-1234ABCD",
          "  Scenario: existing scenario",
          "    Then it remains linked",
        ].join("\n"),
      ),
    ])[0];
    expect(entry.legacyCaseId).toBe("TC-1234ABCD");

    expect(() =>
      parseGherkinManifest([
        feature(
          "legacy.feature",
          [
            "Feature: Existing case",
            "  @qh_key_existing_case @TC-1234ABCD @TC-5678EFGH",
            "  Scenario: conflicting migration IDs",
            "    Then sync stops safely",
          ].join("\n"),
        ),
      ]),
    ).toThrow(/conflicting legacy case tags.*keep at most one/);
  });

  it("rejects Scenario Outline with a v1 migration hint", () => {
    expect(() =>
      parseGherkinManifest([
        feature(
          "outline.feature",
          [
            "Feature: Access",
            "  @qh_key_lookup",
            "  Scenario Outline: lookup <value>",
            "    When I search for <value>",
            "    Examples:",
            "      | value |",
            "      | test  |",
          ].join("\n"),
        ),
      ]),
    ).toThrow(
      /outline\.feature:3:.*Scenario Outline.*Convert it to individual Scenarios/,
    );
  });

  it("surfaces malformed Gherkin and rejects paths outside the project", () => {
    expect(() =>
      parseGherkinManifest([
        feature("broken.feature", "Scenario: missing feature\n"),
      ]),
    ).toThrow(/broken\.feature: invalid Gherkin/);

    expect(() =>
      parseGherkinManifest([
        feature("..\\outside.feature", "Feature: Access\n"),
      ]),
    ).toThrow(/relative path inside the project/);
  });
});
