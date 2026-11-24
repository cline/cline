import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProviderSettingsManager } from "@cline/core";
import { describe, expect, it, vi } from "vitest";
import {
	getPersistedProviderApiKey,
	normalizeAuthProviderId,
	parseAuthCommandArgs,
	runAuthCommand,
	saveOAuthProviderSettings,
} from "./auth";

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

	it("parses --protocol quick setup option", () => {
		expect(
			parseAuthCommandArgs([
				"--provider",
				"openai-compatible",
				"--apikey",
				"key",
				"--modelid",
				"gpt-6-astra",
				"--baseurl",
				"https://proxy.example/v1",
				"--protocol",
				"openai-responses",
			]),
		).toMatchObject({
			explicitProvider: "openai-compatible",
			apikey: "key",
			modelid: "gpt-6-astra",
			baseurl: "https://proxy.example/v1",
			protocol: "openai-responses",
		});
	});
});

describe("runAuthCommand quick setup protocol", () => {
	const createIo = () => {
		const out: string[] = [];
		const err: string[] = [];
		return {
			out,
			err,
			io: {
				writeln: (text = "") => {
					out.push(text);
				},
				writeErr: (text: string) => {
					err.push(text);
				},
			},
		};
	};

	const createMockManager = (
		getStored?: () => Record<string, unknown> | undefined,
		setStored?: (settings: Record<string, unknown>) => void,
	) =>
		({
			getFilePath: vi.fn(() =>
				join(tmpdir(), "cline-auth-test", "providers.json"),
			),
			read: vi.fn(() => ({ providers: {}, modes: {} })),
			getVoiceInputSettings: vi.fn(() => undefined),
			getProviderSettings: vi.fn(() => getStored?.()),
			saveProviderSettings: vi.fn((settings: Record<string, unknown>) => {
				setStored?.(settings);
			}),
			listConfiguredProviders: vi.fn(() => []),
		}) as unknown as ProviderSettingsManager;

	it("persists openai-responses protocol for openai-compatible and clears it for openai-chat", async () => {
		let stored: Record<string, unknown> | undefined;
		const manager = createMockManager(
			() => stored,
			(settings) => {
				stored = settings;
			},
		);

		const { io, err } = createIo();
		const code1 = await runAuthCommand({
			providerSettingsManager: manager,
			explicitProvider: "openai-compatible",
			apikey: "key",
			modelid: "gpt-6-astra",
			baseurl: "https://proxy.example/v1",
			protocol: "openai-responses",
			io,
		});
		expect(code1).toBe(0);
		expect(err).toEqual([]);
		expect(stored).toMatchObject({
			provider: "openai-compatible",
			baseUrl: "https://proxy.example/v1",
			protocol: "openai-responses",
		});

		const preserveCode = await runAuthCommand({
			providerSettingsManager: manager,
			explicitProvider: "openai-compatible",
			apikey: "updated-key",
			modelid: "gpt-6-astra",
			io,
		});
		expect(preserveCode).toBe(0);
		expect(stored).toMatchObject({
			provider: "openai-compatible",
			apiKey: "updated-key",
			protocol: "openai-responses",
		});

		const code2 = await runAuthCommand({
			providerSettingsManager: manager,
			explicitProvider: "openai-compatible",
			apikey: "key",
			modelid: "gpt-6-astra",
			protocol: "openai-chat",
			io,
		});
		expect(code2).toBe(0);
		expect(stored).not.toHaveProperty("protocol");
	});

	it("rejects invalid protocol values and non-openai-compatible providers", async () => {
		const manager = createMockManager();

		const invalidIo = createIo();
		const invalidCode = await runAuthCommand({
			providerSettingsManager: manager,
			explicitProvider: "openai-compatible",
			apikey: "key",
			modelid: "gpt-6-astra",
			protocol: "bogus",
			io: invalidIo.io,
		});
		expect(invalidCode).toBe(1);
		expect(invalidIo.err[0]).toMatch(/openai-chat.*openai-responses/);

		const wrongProviderIo = createIo();
		const wrongProviderCode = await runAuthCommand({
			providerSettingsManager: manager,
			explicitProvider: "anthropic",
			apikey: "key",
			modelid: "claude-sonnet-4",
			protocol: "openai-responses",
			io: wrongProviderIo.io,
		});
		expect(wrongProviderCode).toBe(1);
		expect(wrongProviderIo.err[0]).toMatch(
			/only supported for OpenAI-compatible/i,
		);

		const emptyProtocolIo = createIo();
		const emptyProtocolCode = await runAuthCommand({
			providerSettingsManager: manager,
			explicitProvider: "openai-compatible",
			apikey: "key",
			modelid: "gpt-6-astra",
			protocol: "   ",
			io: emptyProtocolIo.io,
		});
		expect(emptyProtocolCode).toBe(1);
		expect(emptyProtocolIo.err[0]).toMatch(/openai-chat.*openai-responses/);
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
