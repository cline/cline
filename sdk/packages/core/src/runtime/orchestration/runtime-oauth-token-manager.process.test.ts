import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderSettingsManager } from "../../services/storage/provider-settings-manager";

const directories: string[] = [];
const children: ReturnType<typeof spawn>[] = [];
afterEach(() => {
	for (const child of children.splice(0)) child.kill();
	for (const dir of directories.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe("OAuth refresh across processes", () => {
	it("refreshes a single-use token once and gives both processes the rotated credential", async () => {
		const dir = mkdtempSync(join(tmpdir(), "oauth-process-test-"));
		directories.push(dir);
		const path = join(dir, "providers.json");
		const settings = new ProviderSettingsManager({ filePath: path });
		settings.saveProviderSettings({
			provider: "cline",
			baseUrl: "https://unused.example",
			auth: {
				accessToken: "expired",
				refreshToken: "single-use",
				accountId: "account-a",
				expiresAt: 1,
			},
		});
		const refreshLog = join(dir, "refreshes");
		const release = join(dir, "release");
		// Exercise the built runtime in separate Node processes, like the hub
		// and sidecar. Only the remote token endpoint is replaced.
		const entry = new URL("../../../dist/index.js", import.meta.url).href;
		const script = `
			import { appendFileSync, existsSync } from "node:fs";
			import { setTimeout } from "node:timers/promises";
			import { RuntimeOAuthTokenManager, ProviderSettingsManager } from ${JSON.stringify(entry)};
			const [path, log, release] = process.argv.slice(1);
			globalThis.fetch = async () => {
				appendFileSync(log, "refresh\\n");
				console.log("refreshing");
				while (!existsSync(release)) await setTimeout(10);
				return Response.json({ success: true, data: {
					accessToken: "rotated", refreshToken: "rotated-refresh", tokenType: "Bearer",
					expiresAt: new Date(Date.now() + 3600000).toISOString(),
					userInfo: { clineUserId: "account-a", email: "", subject: null, name: "", accounts: [] }
				} });
			};
			const manager = new RuntimeOAuthTokenManager({
				providerSettingsManager: new ProviderSettingsManager({ filePath: path })
			});
			console.log("resolving");
			const result = await manager.resolveProviderApiKey({ providerId: "cline" });
			console.log(JSON.stringify(result));
		`;
		function launch() {
			const child = spawn(
				process.execPath,
				["--input-type=module", "-e", script, path, refreshLog, release],
				{
					env: { ...process.env, CLINE_DATA_DIR: dir, CLINE_DIR: dir },
					stdio: ["ignore", "pipe", "pipe"],
				},
			);
			children.push(child);
			let output = "";
			let errors = "";
			child.stdout.on("data", (data) => {
				output += data;
			});
			child.stderr.on("data", (data) => {
				errors += data;
			});
			const done = new Promise<string>((resolve, reject) => {
				child.on("error", reject);
				child.on("exit", (code) =>
					code === 0 ? resolve(output) : reject(new Error(errors)),
				);
			});
			return { output: () => output, done };
		}
		const first = launch();
		await expect.poll(first.output).toContain("refreshing");
		const second = launch();
		await expect.poll(second.output).toContain("resolving");
		writeFileSync(release, "");
		const results = await Promise.all([first.done, second.done]);
		for (const result of results)
			expect(result).toContain('"apiKey":"workos:rotated"');
		expect(readFileSync(refreshLog, "utf8").trim().split("\n")).toEqual([
			"refresh",
		]);
		expect(settings.getProviderSettings("cline")?.auth?.refreshToken).toBe(
			"rotated-refresh",
		);
	}, 15_000);
});
