import { describe, expect, it, vi } from "vitest";
import {
	createFactoryConnectionsReader,
	FACTORY_CONNECTIONS_CACHE_MS,
	type FactoryProbeRunner,
	parseGhAuthStatus,
	probeGitHubCli,
} from "./factory-connections";

const TOKEN = "gho_abcdefghijklmnopqrstuvwxyz0123456789";
const SIGNED_IN = `github.com
  ✓ Logged in to github.com account octocat (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: ${TOKEN}
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'

ghe.example.com
  X Failed to log in to ghe.example.com account hubber (keyring)
  - The token in keyring is invalid.
`;
const NOT_SIGNED_IN =
	"You are not logged into any GitHub hosts. To log in, run: gh auth login\n";
const hub = { status: "connected" as const, appVersion: "1.2.3" };

function runner(
	answers: Record<string, Awaited<ReturnType<FactoryProbeRunner>>>,
): FactoryProbeRunner & ReturnType<typeof vi.fn> {
	return vi.fn(async (_file: string, args: string[]) => {
		const answer = answers[args.join(" ")];
		if (!answer) throw new Error(`unexpected probe ${args.join(" ")}`);
		return answer;
	}) as never;
}

describe("Factory connections", () => {
	it("reports gh signed in with its hosts and logins, and never a token", async () => {
		const run = runner({
			"--version": { code: 0, output: "gh version 2.62.0 (2024-11-14)\n" },
			"auth status": { code: 0, output: SIGNED_IN },
		});
		const gh = await probeGitHubCli(run, { PATH: "" });
		expect(gh).toEqual({
			installed: true,
			version: "2.62.0",
			hosts: [
				{ host: "github.com", login: "octocat", signedIn: true },
				{ host: "ghe.example.com", login: "hubber", signedIn: false },
			],
		});
		expect(JSON.stringify(gh)).not.toContain("gho_");
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("reports gh missing or signed out, and a probe that timed out", async () => {
		await expect(
			probeGitHubCli(runner({ "--version": { code: "ENOENT", output: "" } })),
		).resolves.toEqual({ installed: false, hosts: [] });
		await expect(
			probeGitHubCli(
				runner({
					"--version": { code: 0, output: "gh version 2.40.1 (2023-12-13)" },
					"auth status": { code: 1, output: NOT_SIGNED_IN },
				}),
				{ PATH: "" },
			),
		).resolves.toEqual({ installed: true, version: "2.40.1", hosts: [] });
		await expect(
			probeGitHubCli(
				runner({
					"--version": { code: 0, output: "gh version 2.40.1" },
					"auth status": { code: "TIMEOUT", output: "" },
				}),
				{ PATH: "" },
			),
		).resolves.toMatchObject({
			installed: true,
			hosts: [],
			error: expect.any(String),
		});
	});

	it("reads the older gh status format", () => {
		expect(
			parseGhAuthStatus(
				"github.com\n  ✓ Logged in to github.com as octocat (oauth_token)\n  ✓ Token: *******************\n",
			),
		).toEqual([{ host: "github.com", login: "octocat", signedIn: true }]);
	});

	it("caches gh for five minutes unless asked to check again, and reads Linear from the environment only", async () => {
		let now = 1_000;
		const run = runner({
			"--version": { code: 0, output: "gh version 2.62.0" },
			"auth status": { code: 0, output: SIGNED_IN },
		});
		const read = createFactoryConnectionsReader({
			run,
			env: { PATH: "", LINEAR_API_KEY: "lin_api_secret" },
			now: () => now,
		});
		const first = await read({ hub });
		expect(first).toMatchObject({
			gh: { installed: true },
			linear: { configured: true },
			hub,
		});
		expect(JSON.stringify(first)).not.toContain("lin_api_secret");
		expect(JSON.stringify(first)).not.toContain(TOKEN);
		await read({ hub });
		expect(run).toHaveBeenCalledTimes(2);
		now += FACTORY_CONNECTIONS_CACHE_MS + 1;
		await read({ hub });
		expect(run).toHaveBeenCalledTimes(4);
		await read({ hub, refresh: true });
		expect(run).toHaveBeenCalledTimes(6);
		await expect(
			createFactoryConnectionsReader({
				run,
				env: { PATH: "", LINEAR_ACCESS_TOKEN: "  " },
			})({ hub }),
		).resolves.toMatchObject({ linear: { configured: false } });
	});
});
