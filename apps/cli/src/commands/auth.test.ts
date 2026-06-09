import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProviderSettingsManager } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import {
	getPersistedProviderApiKey,
	normalizeAuthProviderId,
	parseAuthCommandArgs,
	parseHeaderFlags,
	runAuthCommand,
	saveOAuthProviderSettings,
} from "./auth";

function createTempProviderSettingsManager(): ProviderSettingsManager {
	const dir = mkdtempSync(join(tmpdir(), "cline-auth-test-"));
	return new ProviderSettingsManager({
		filePath: join(dir, "settings", "providers.json"),
	});
}

function createAuthIo() {
	const out: string[] = [];
	const err: string[] = [];
	return {
		io: {
			writeln: (text?: string) => {
				out.push(text ?? "");
			},
			writeErr: (text: string) => {
				err.push(text);
			},
		},
		out,
		err,
	};
}

describe("parseAuthCommandArgs", () => {
	it("parses Azure API version quick setup option", () => {
		expect(
			parseAuthCommandArgs([
				"--provider",
				"openai-compatible",
				"--apikey",
				"key",
				"--modelid",
				"gpt-4.1",
				"--baseurl",
				"https://example.openai.azure.com/openai/deployments/gpt-4.1",
				"--azure-api-version",
				"2025-01-01-preview",
			]),
		).toMatchObject({
			explicitProvider: "openai-compatible",
			apikey: "key",
			modelid: "gpt-4.1",
			baseurl: "https://example.openai.azure.com/openai/deployments/gpt-4.1",
			azureApiVersion: "2025-01-01-preview",
		});
	});
});

describe("saveOAuthProviderSettings", () => {
	it("preserves existing manual apiKey while updating OAuth tokens", () => {
		const save = vi.fn();
		const manager = {
			saveProviderSettings: save,
		} as unknown as ProviderSettingsManager;

		const merged = saveOAuthProviderSettings(
			manager,
			"cline",
			{
				provider: "cline",
				apiKey: "manual-key",
				auth: {
					accessToken: "workos:old-access",
					refreshToken: "old-refresh",
					accountId: "acct-old",
				},
			},
			{
				access: "new-access",
				refresh: "new-refresh",
				expires: 4_000_000_000_000,
				accountId: "acct-new",
			},
		);

		expect(merged).toMatchObject({
			provider: "cline",
			apiKey: "manual-key",
			auth: {
				accessToken: "workos:new-access",
				refreshToken: "new-refresh",
				accountId: "acct-new",
				expiresAt: 4_000_000_000_000,
			},
		});
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "cline",
				apiKey: "manual-key",
				auth: expect.objectContaining({
					accessToken: "workos:new-access",
				}),
			}),
			{ tokenSource: "oauth" },
		);
	});
});

describe("getPersistedProviderApiKey", () => {
	it("does not double-prefix persisted Cline OAuth tokens", () => {
		expect(
			getPersistedProviderApiKey("cline", {
				provider: "cline",
				auth: {
					accessToken: "workos:oauth-access",
				},
			}),
		).toBe("workos:oauth-access");
	});
});

describe("parseAuthCommandArgs", () => {
	it("parses repeatable --header flags and model configuration options", () => {
		const parsed = parseAuthCommandArgs([
			"--provider",
			"openai-compatible",
			"--header",
			"X-Org=abc",
			"-H",
			"Authorization=Bearer a=b",
			"--context-window",
			"128000",
			"--max-output-tokens",
			"8192",
			"--supports-images",
		]);

		expect(parsed.parseError).toBeUndefined();
		expect(parsed.explicitProvider).toBe("openai-compatible");
		expect(parsed.header).toEqual(["X-Org=abc", "Authorization=Bearer a=b"]);
		expect(parsed.contextWindow).toBe("128000");
		expect(parsed.maxOutputTokens).toBe("8192");
		expect(parsed.supportsImages).toBe(true);
	});

	it("parses --no-supports-images as an explicit false", () => {
		const parsed = parseAuthCommandArgs([
			"--provider",
			"openai-compatible",
			"--no-supports-images",
		]);
		expect(parsed.supportsImages).toBe(false);
	});

	it("leaves supportsImages undefined when neither flag is given", () => {
		const parsed = parseAuthCommandArgs(["--provider", "openai-compatible"]);
		expect(parsed.supportsImages).toBeUndefined();
	});
});

describe("parseHeaderFlags", () => {
	it("splits each header at the first equals sign", () => {
		expect(
			parseHeaderFlags(["X-Org=abc", "Authorization=Bearer a=b=c"]),
		).toEqual({
			headers: {
				"X-Org": "abc",
				Authorization: "Bearer a=b=c",
			},
		});
	});

	it("rejects headers without a key", () => {
		expect(parseHeaderFlags(["=value"]).error).toMatch(/invalid --header/);
		expect(parseHeaderFlags(["no-separator"]).error).toMatch(
			/invalid --header/,
		);
	});

	it("returns no headers for empty input", () => {
		expect(parseHeaderFlags(undefined)).toEqual({});
		expect(parseHeaderFlags([])).toEqual({});
	});
});

describe("runAuthCommand quick setup", () => {
	it("persists headers and model configuration for openai-compatible", async () => {
		const manager = createTempProviderSettingsManager();
		const { io, err } = createAuthIo();

		const exitCode = await runAuthCommand({
			providerSettingsManager: manager,
			io,
			explicitProvider: "openai-compatible",
			apikey: "sk-test",
			modelid: "my-custom-model",
			baseurl: "https://llm.example.com/v1",
			header: ["X-Org=abc", "Authorization=Bearer token=1"],
			contextWindow: "128000",
			maxOutputTokens: "8192",
			supportsImages: true,
		});

		expect(err).toEqual([]);
		expect(exitCode).toBe(0);
		expect(manager.getProviderSettings("openai-compatible")).toMatchObject({
			provider: "openai-compatible",
			apiKey: "sk-test",
			model: "my-custom-model",
			baseUrl: "https://llm.example.com/v1",
			headers: {
				"X-Org": "abc",
				Authorization: "Bearer token=1",
			},
			contextWindow: 128_000,
			maxTokens: 8_192,
		});
		expect(
			manager.getProviderSettings("openai-compatible")?.capabilities,
		).toEqual(expect.arrayContaining(["streaming", "tools", "vision"]));
	});

	it("updates stored settings without requiring the api key again", async () => {
		const manager = createTempProviderSettingsManager();
		manager.saveProviderSettings({
			provider: "openai-compatible",
			apiKey: "sk-existing",
			model: "my-custom-model",
			baseUrl: "https://llm.example.com/v1",
		});
		const { io, err } = createAuthIo();

		const exitCode = await runAuthCommand({
			providerSettingsManager: manager,
			io,
			explicitProvider: "openai-compatible",
			header: ["X-Team=infra"],
		});

		expect(err).toEqual([]);
		expect(exitCode).toBe(0);
		expect(manager.getProviderSettings("openai-compatible")).toMatchObject({
			apiKey: "sk-existing",
			model: "my-custom-model",
			headers: { "X-Team": "infra" },
		});
	});

	it("removes the vision capability with --no-supports-images", async () => {
		const manager = createTempProviderSettingsManager();
		manager.saveProviderSettings({
			provider: "openai-compatible",
			apiKey: "sk-existing",
			model: "my-custom-model",
			capabilities: ["streaming", "tools", "vision"],
		});
		const { io } = createAuthIo();

		const exitCode = await runAuthCommand({
			providerSettingsManager: manager,
			io,
			explicitProvider: "openai-compatible",
			supportsImages: false,
		});

		expect(exitCode).toBe(0);
		const capabilities =
			manager.getProviderSettings("openai-compatible")?.capabilities;
		expect(capabilities).toEqual(
			expect.arrayContaining(["streaming", "tools"]),
		);
		expect(capabilities).not.toContain("vision");
	});

	it("rejects custom headers for providers without endpoint customization", async () => {
		const manager = createTempProviderSettingsManager();
		const { io, err } = createAuthIo();

		const exitCode = await runAuthCommand({
			providerSettingsManager: manager,
			io,
			explicitProvider: "anthropic",
			apikey: "sk-ant",
			modelid: "claude-sonnet-4-20250514",
			header: ["X-Org=abc"],
		});

		expect(exitCode).toBe(1);
		expect(err.join("\n")).toMatch(/custom headers are only supported/i);
	});

	it("rejects model configuration options for non openai-compatible providers", async () => {
		const manager = createTempProviderSettingsManager();
		const { io, err } = createAuthIo();

		const exitCode = await runAuthCommand({
			providerSettingsManager: manager,
			io,
			explicitProvider: "anthropic",
			apikey: "sk-ant",
			modelid: "claude-sonnet-4-20250514",
			contextWindow: "128000",
		});

		expect(exitCode).toBe(1);
		expect(err.join("\n")).toMatch(/model configuration options/i);
	});

	it("rejects malformed header and numeric flag values", async () => {
		const manager = createTempProviderSettingsManager();
		const malformedHeader = createAuthIo();
		expect(
			await runAuthCommand({
				providerSettingsManager: manager,
				io: malformedHeader.io,
				explicitProvider: "openai-compatible",
				apikey: "sk-test",
				modelid: "my-custom-model",
				header: ["missing-separator"],
			}),
		).toBe(1);
		expect(malformedHeader.err.join("\n")).toMatch(/invalid --header/);

		const malformedNumber = createAuthIo();
		expect(
			await runAuthCommand({
				providerSettingsManager: manager,
				io: malformedNumber.io,
				explicitProvider: "openai-compatible",
				apikey: "sk-test",
				modelid: "my-custom-model",
				maxOutputTokens: "not-a-number",
			}),
		).toBe(1);
		expect(malformedNumber.err.join("\n")).toMatch(/--max-output-tokens/);
	});
});

describe("normalizeAuthProviderId", () => {
	it("keeps CLI-only codex shorthand in CLI parsing", () => {
		expect(normalizeAuthProviderId("codex")).toBe("openai-codex");
	});
});

describe("loadAuthTuiRuntime", () => {
	it("loads OpenTUI React after provider catalog initialization", async () => {
		const cliRoot = fileURLToPath(new URL("../..", import.meta.url));
		const script = `
import { ProviderSettingsManager, ensureCustomProvidersLoaded, listLocalProviders } from "@cline/core";
import { loadAuthTuiRuntime } from "./src/commands/auth.ts";
const manager = new ProviderSettingsManager();
await ensureCustomProvidersLoaded(manager);
await listLocalProviders(manager);
const runtime = await loadAuthTuiRuntime();
if (typeof runtime.createCliRenderer !== "function") throw new Error("missing createCliRenderer");
if (typeof runtime.createRoot !== "function") throw new Error("missing createRoot");
if (typeof runtime.OnboardingView !== "function") throw new Error("missing OnboardingView");
`;

		const result = spawnSync(
			"bun",
			["--conditions=development", "-e", script],
			{
				cwd: cliRoot,
				encoding: "utf8",
			},
		);

		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
	});
});
