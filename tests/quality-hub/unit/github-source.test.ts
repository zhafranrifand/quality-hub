import { describe, expect, it } from "vitest";
import {
  GithubSourceError,
  loadGithubManifest,
  type GithubSourceConfig,
} from "../../../server/github-source";

const source: GithubSourceConfig = {
  repository: "zhafranrifand/quality-hub",
  branch: "main",
  featureRoot: "tests/targets/lokasi",
  token: "fine-grained-read-token",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GitHub Gherkin source", () => {
  it("loads one consistent branch commit and only feature files under the configured root", async () => {
    const calls: { url: string; authorization?: string }[] = [];
    const feature = [
      "Feature: Search",
      "  @qh_key_search_works",
      "  Scenario: search works",
      "    Given the search page is open",
      "    When I submit a search",
      "    Then results are shown",
      "",
    ].join("\n");
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        authorization: new Headers(init?.headers).get("Authorization") || undefined,
      });
      if (url.includes("/commits/main"))
        return response({ sha: "commit123", commit: { tree: { sha: "tree123" } } });
      if (url.includes("/git/trees/tree123"))
        return response({
          tree: [
            {
              path: "tests/targets/lokasi/search.feature",
              type: "blob",
              mode: "100644",
              sha: "feature123",
              size: Buffer.byteLength(feature),
            },
            {
              path: "tests/targets/other/ignored.feature",
              type: "blob",
              mode: "100644",
              sha: "ignored123",
              size: 12,
            },
            {
              path: "tests/targets/lokasi/link.feature",
              type: "blob",
              mode: "120000",
              sha: "symlink123",
              size: 12,
            },
          ],
        });
      if (url.includes("/git/blobs/feature123"))
        return response({
          encoding: "base64",
          content: Buffer.from(feature).toString("base64"),
        });
      throw new Error(`Unexpected GitHub API request ${url}`);
    };

    const manifest = await loadGithubManifest(source, fetcher);

    expect(manifest).toMatchObject({
      repository: "zhafranrifand/quality-hub",
      branch: "main",
      featureRoot: "tests/targets/lokasi",
      commitSha: "commit123",
      browser: "chromium",
      files: 1,
    });
    expect(manifest.scenarios.map(({ key }) => key)).toEqual(["search_works"]);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.authorization === `Bearer ${source.token}`)).toBe(true);
  });

  it("rejects a truncated Git tree rather than partially syncing", async () => {
    const fetcher: typeof fetch = async (input) =>
      String(input).includes("/commits/main")
        ? response({ sha: "commit123", commit: { tree: { sha: "tree123" } } })
        : response({ truncated: true, tree: [] });

    await expect(loadGithubManifest(source, fetcher)).rejects.toThrow(
      "repository tree is too large",
    );
  });

  it("rejects unsafe repository paths before making network requests", async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error("Should not make a request");
    };

    await expect(
      loadGithubManifest({ ...source, featureRoot: "../secrets" }, fetcher),
    ).rejects.toBeInstanceOf(GithubSourceError);
  });

  it("returns a safe access error for private repositories without permission", async () => {
    const fetcher: typeof fetch = async () => response({}, 404);

    await expect(loadGithubManifest(source, fetcher)).rejects.toThrow(
      "repository or branch",
    );
  });
});
