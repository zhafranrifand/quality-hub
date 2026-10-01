import { createHash, randomUUID } from "node:crypto";
import { posix as path } from "node:path";
import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser,
} from "@cucumber/gherkin";

export type GherkinManifestInput = {
  relativePath: string;
  source: string;
};

export type GherkinManifestStep = {
  keyword: string;
  text: string;
};

export type GherkinManifestEntry = {
  key: string;
  title: string;
  featurePath: string;
  gherkin: string;
  background: string[];
  steps: GherkinManifestStep[];
  tags: string[];
  legacyCaseId?: string;
};

export class GherkinManifestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GherkinManifestError";
  }
}

const keyTagPrefix = "@qh_key";
const keyTagPattern = /^@qh_key_([a-z0-9]+(?:[_-][a-z0-9]+)*)$/;
type ParsedFeature = NonNullable<
  ReturnType<Parser<unknown>["parse"]>["feature"]
>;
type ParsedScenario = NonNullable<
  ParsedFeature["children"][number]["scenario"]
>;
type ParsedStep = ParsedScenario["steps"][number];
type ParsedFeatureChild = ParsedFeature["children"][number];
type ParsedRule = NonNullable<ParsedFeatureChild["rule"]>;
type ParsedRuleChild = ParsedRule["children"][number];

function isKeyTag(tag: string) {
  return tag.toLowerCase().startsWith(keyTagPrefix);
}

function normalizeFeaturePath(value: string) {
  const slashPath = value.replaceAll("\\", "/");
  const normalized = path.normalize(slashPath);
  if (
    !value.trim() ||
    path.isAbsolute(slashPath) ||
    /^[a-z]:\//i.test(slashPath) ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new GherkinManifestError(
      `Feature path must be a non-empty relative path inside the project: ${JSON.stringify(value)}`,
    );
  }
  return normalized;
}

function location(featurePath: string, line?: number) {
  return line ? `${featurePath}:${line}` : featurePath;
}

function nodeStartLine(node: {
  location: { line: number };
  tags?: readonly { location: { line: number } }[];
}) {
  if (!node) return Number.MAX_SAFE_INTEGER;
  const tagLines = node.tags?.map((tag) => tag.location.line) ?? [];
  return Math.min(node.location.line, ...tagLines);
}

function childStartLine(child: ParsedFeatureChild) {
  if (child.background) return nodeStartLine(child.background);
  if (child.scenario) return nodeStartLine(child.scenario);
  if (child.rule) return nodeStartLine(child.rule);
  return Number.MAX_SAFE_INTEGER;
}

function ruleChildStartLine(child: ParsedRuleChild) {
  if (child.background) return nodeStartLine(child.background);
  if (child.scenario) return nodeStartLine(child.scenario);
  return Number.MAX_SAFE_INTEGER;
}

function scenarioStartLine(scenario: ParsedScenario) {
  const tagLines = scenario.tags.map((tag) => tag.location.line);
  return Math.min(scenario.location.line, ...tagLines);
}

function lineOffsets(source: string) {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function sourceLines(source: string, offsets: number[]) {
  const startLine = offsets.length;
  const endLine = startLine + (source.endsWith("\n") ? 0 : 1);
  return { startLine, endLine };
}

function extractSource(
  source: string,
  offsets: number[],
  startLine: number,
  endLineExclusive: number,
) {
  const start = offsets[startLine - 1] ?? source.length;
  const end = offsets[endLineExclusive - 1] ?? source.length;
  const chunks = source.slice(start, end).match(/[^\n]*\n|[^\n]+$/g) ?? [];
  while (chunks.length && chunks.at(-1)!.trim() === "") chunks.pop();
  return chunks.join("");
}

function formatBackgroundStep(step: ParsedStep) {
  const lines = [`${step.keyword.trimEnd()} ${step.text}`];
  if (step.docString) {
    const mediaType = step.docString.mediaType
      ? ` ${step.docString.mediaType}`
      : "";
    lines.push(
      `${step.docString.delimiter}${mediaType}`,
      step.docString.content,
      step.docString.delimiter,
    );
  }
  if (step.dataTable) {
    for (const row of step.dataTable.rows) {
      lines.push(`| ${row.cells.map((cell) => cell.value).join(" | ")} |`);
    }
  }
  return lines.join("\n");
}

function rejectAncestorKeys(
  tags: readonly { name: string; location: { line: number } }[] | undefined,
  scope: string,
  featurePath: string,
) {
  for (const tag of tags ?? []) {
    if (isKeyTag(tag.name)) {
      throw new GherkinManifestError(
        `${location(featurePath, tag.location.line)}: ${tag.name} is a scenario identity and must be placed on a Scenario, not ${scope}.`,
      );
    }
  }
}

/**
 * Parse Gherkin feature sources into one manifest entry per Scenario.
 * Feature and Rule tags/backgrounds are inherited in declaration order.
 */
export function parseGherkinManifest(
  inputs: readonly GherkinManifestInput[],
): GherkinManifestEntry[] {
  const entries: GherkinManifestEntry[] = [];
  const seenKeys = new Map<string, string>();

  for (const input of inputs) {
    const featurePath = normalizeFeaturePath(input.relativePath);
    let feature;
    try {
      feature = new Parser(
        new AstBuilder(randomUUID),
        new GherkinClassicTokenMatcher(),
      ).parse(input.source).feature;
    } catch (error) {
      throw new GherkinManifestError(
        `${featurePath}: invalid Gherkin: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (!feature) {
      throw new GherkinManifestError(
        `${featurePath}: no Feature declaration was found.`,
      );
    }

    rejectAncestorKeys(feature.tags, "Feature", featurePath);
    const featureTags = (feature.tags ?? []).map((tag) => tag.name);
    const featureBackgrounds: ParsedStep[] = [];
    const offsets = lineOffsets(input.source);
    const endOfFeature = sourceLines(input.source, offsets).endLine;

    for (
      let childIndex = 0;
      childIndex < feature.children.length;
      childIndex++
    ) {
      const child = feature.children[childIndex];
      const childEndLine =
        childIndex + 1 < feature.children.length
          ? childStartLine(feature.children[childIndex + 1])
          : endOfFeature;
      if (child.background) {
        featureBackgrounds.push(...child.background.steps);
        continue;
      }

      if (child.scenario) {
        appendScenario({
          scenario: child.scenario,
          inheritedTags: featureTags,
          background: featureBackgrounds.map(formatBackgroundStep),
          featurePath,
          source: extractSource(
            input.source,
            offsets,
            scenarioStartLine(child.scenario),
            childEndLine,
          ),
          seenKeys,
          entries,
        });
        continue;
      }

      if (!child.rule) continue;
      rejectAncestorKeys(child.rule.tags, "Rule", featurePath);
      const ruleTags = (child.rule.tags ?? []).map((tag) => tag.name);
      const ruleBackgrounds: ParsedStep[] = [];
      for (
        let ruleChildIndex = 0;
        ruleChildIndex < child.rule.children.length;
        ruleChildIndex++
      ) {
        const ruleChild = child.rule.children[ruleChildIndex];
        const ruleChildEndLine =
          ruleChildIndex + 1 < child.rule.children.length
            ? ruleChildStartLine(child.rule.children[ruleChildIndex + 1])
            : childEndLine;
        if (ruleChild.background) {
          ruleBackgrounds.push(...ruleChild.background.steps);
          continue;
        }
        if (!ruleChild.scenario) continue;
        appendScenario({
          scenario: ruleChild.scenario,
          inheritedTags: [...featureTags, ...ruleTags],
          background: [...featureBackgrounds, ...ruleBackgrounds].map(
            formatBackgroundStep,
          ),
          featurePath,
          source: extractSource(
            input.source,
            offsets,
            scenarioStartLine(ruleChild.scenario),
            ruleChildEndLine,
          ),
          seenKeys,
          entries,
        });
      }
    }
  }

  return entries;
}

/** Hash only scenario metadata/content; file location and sibling scenarios are excluded. */
export function hashGherkinManifestEntry(entry: GherkinManifestEntry) {
  const { title, gherkin, background, steps, tags, legacyCaseId } = entry;
  return createHash("sha256")
    .update(
      JSON.stringify({ title, gherkin, background, steps, tags, legacyCaseId }),
    )
    .digest("hex");
}

function appendScenario(args: {
  scenario: ParsedScenario | undefined;
  inheritedTags: string[];
  background: string[];
  featurePath: string;
  source: string;
  seenKeys: Map<string, string>;
  entries: GherkinManifestEntry[];
}) {
  const { scenario, featurePath, source, seenKeys, entries } = args;
  if (!scenario) return;

  if (scenario.examples.length > 0) {
    throw new GherkinManifestError(
      `${location(featurePath, scenario.location.line)}: Scenario Outline "${scenario.name}" is not supported by manifest sync yet. Convert it to individual Scenarios for v1.`,
    );
  }

  const directTags = (scenario.tags ?? []).map((tag) => tag.name);
  const keyTags = directTags.filter(isKeyTag);
  const validKeys = keyTags.map((tag) => ({
    tag,
    match: keyTagPattern.exec(tag),
  }));
  const malformed = validKeys.find(({ match }) => !match);
  if (malformed) {
    throw new GherkinManifestError(
      `${location(featurePath, scenario.location.line)}: malformed case key ${malformed.tag}; use exactly one @qh_key_<lowercase-slug> tag, for example @qh_key_sign-in-valid.`,
    );
  }
  if (keyTags.length !== 1) {
    throw new GherkinManifestError(
      `${location(featurePath, scenario.location.line)}: Scenario "${scenario.name}" needs exactly one scenario-level @qh_key_<slug> tag; found ${keyTags.length}.`,
    );
  }

  const legacyTags = directTags.filter((tag) =>
    /^@TC-[A-Z0-9][A-Z0-9_-]*$/i.test(tag),
  );
  const legacyCaseIds = [...new Set(legacyTags.map((tag) => tag.slice(1)))];
  if (legacyCaseIds.length > 1) {
    throw new GherkinManifestError(
      `${location(featurePath, scenario.location.line)}: conflicting legacy case tags (${legacyTags.join(", ")}); keep at most one @TC-… tag on this Scenario.`,
    );
  }

  const key = validKeys[0].match![1];
  const keyLocation = location(featurePath, scenario.location.line);
  const previous = seenKeys.get(key);
  if (previous) {
    throw new GherkinManifestError(
      `${keyLocation}: duplicate Gherkin case key @qh_key_${key}; it was already declared at ${previous}.`,
    );
  }
  seenKeys.set(key, keyLocation);

  const title = scenario.name;
  const tags = [...args.inheritedTags, ...directTags];
  const steps = scenario.steps.map((step) => ({
    keyword: step.keyword.trimEnd(),
    text: step.text,
  }));

  entries.push({
    key,
    title,
    featurePath,
    gherkin: source,
    background: args.background,
    steps,
    tags,
    ...(legacyCaseIds[0] ? { legacyCaseId: legacyCaseIds[0] } : {}),
  });
}
