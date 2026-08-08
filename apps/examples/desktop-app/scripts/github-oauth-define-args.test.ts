import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { githubOAuthDefineArgs } from "./github-oauth-define-args";

function defineMap(args: string[]): Record<string, string> {
	const map: Record<string, string> = {};
	for (let index = 0; index < args.length; index += 2) {
		expect(args[index]).toBe("--define");
		const pair = args[index + 1];
		const separator = pair.indexOf("=");
		map[pair.slice(0, separator)] = pair.slice(separator + 1);
	}
	return map;
}

describe("githubOAuthDefineArgs", () => {
	it("inlines configured GitHub OAuth values for packaged sidecars", () => {
		const defines = defineMap(
			githubOAuthDefineArgs({
				GITHUB_OAUTH_APP_ID: "client-id",
				GITHUB_OAUTH_APP_SECRETS: 'secret-with-"quotes"',
				GITHUB_OAUTH_CALLBACK_PORT: "8085",
			}),
		);

		expect(defines).toEqual({
			"process.env.GITHUB_OAUTH_APP_ID": '"client-id"',
			"process.env.GITHUB_OAUTH_APP_SECRETS": '"secret-with-\\"quotes\\""',
			"process.env.GITHUB_OAUTH_CALLBACK_PORT": '"8085"',
		});
	});

	it("does not replace runtime environment lookups when values are absent", () => {
		expect(githubOAuthDefineArgs({})).toEqual([]);
	});

	it("embeds configured values into the actual bundled OAuth module", () => {
		const tempRoot = mkdtempSync(join(tmpdir(), "github-oauth-bundle-"));
		const outfile = join(tempRoot, "github-mcp-oauth.js");
		const appId = "bundle-test-client-id";
		const appSecret = "bundle-test-client-secret";
		try {
			execFileSync(
				"bun",
				[
					"build",
					"./sidecar/github-mcp-oauth.ts",
					"--target",
					"bun",
					"--outfile",
					outfile,
					...githubOAuthDefineArgs({
						GITHUB_OAUTH_APP_ID: appId,
						GITHUB_OAUTH_APP_SECRETS: appSecret,
						GITHUB_OAUTH_CALLBACK_PORT: "8085",
					}),
				],
				{ cwd: process.cwd(), stdio: "pipe" },
			);
			const bundle = readFileSync(outfile, "utf8");
			expect(bundle).toContain(appId);
			expect(bundle).toContain(appSecret);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});
