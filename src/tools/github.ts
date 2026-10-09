// github_api: free read-only GitHub REST API (60 requests an hour without a token, 5,000 with one).
import { config } from "../config";
import { clip, type Tool } from "./types";
import { USER_AGENT } from "./web";

const ALLOWED = /^\/(users|repos|orgs|search)\/[\w.\-/?=&:+,]*$/;

/**
 * Only plain public read paths. Percent-encoding, backslashes, "..", "//" and spaces are refused: URL parsing
 * turns "/users/%2e%2e/user" into "/user", which would send the token to the owner's own private endpoints.
 */
export function assertGithubPath(path: string): URL {
  if (/[%\\\s]|\.\.|\/\//.test(path) || !ALLOWED.test(path)) {
    throw new Error(`github_api path must be a plain /users/, /repos/, /orgs/ or /search/ path (got "${path.slice(0, 80)}")`);
  }
  const url = new URL(path, "https://api.github.com");
  if (url.origin !== "https://api.github.com" || !/^\/(users|repos|orgs|search)\//.test(url.pathname)) {
    throw new Error("github_api path resolves outside the allowed endpoints");
  }
  return url;
}

export const githubApi: Tool<{ path: string }> = {
  name: "github_api",
  description:
    "Free. GET on the GitHub REST API. Prefer this over scraping for any github.com link. Useful paths: /users/{user}, /users/{user}/repos?per_page=100&sort=updated, /repos/{owner}/{repo}, /repos/{owner}/{repo}/languages, /repos/{owner}/{repo}/readme (base64 content), /repos/{owner}/{repo}/contents/{path}. Forked repos have fork=true.",
  parameters: {
    type: "object",
    properties: { path: { type: "string", description: "API path starting with /users/, /repos/, /orgs/ or /search/" } },
    required: ["path"],
    additionalProperties: false,
  },
  available: () => true,
  async run({ path }) {
    const target = assertGithubPath(path);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(config.GITHUB_TOKEN ? { Authorization: `Bearer ${config.GITHUB_TOKEN}` } : {}),
    };
    const url = target.href;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}${res.status === 403 ? " (rate limit?)" : ""}`);
    const raw: unknown = await res.json();
    return { raw, text: clip(JSON.stringify(raw, null, 1), 12_000), url, usd: 0 };
  },
};
