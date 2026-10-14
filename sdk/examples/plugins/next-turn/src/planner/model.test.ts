import { describe, expect, test } from "bun:test";
import { type ApiHandler, resolveProviderRequestHeaders } from "@cline/llms";
import { defaultSettings } from "../settings/settings";
import { suggestion } from "./candidates";
import { CORE_KINDS } from "./kinds";
import {
	type Complete,
	clineCompleter,
	generatePool,
	PoolCache,
	plannerProvider,
	resolveProviderConfig,
	streamCompletion,
} from "./model";

const input = { system: "s", user: "u" };
const answer =
	'{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run the retry tests.","why":"changed"}]}';

describe("one planner call", () => {
	test("a good answer is a pool, with its cost", async () => {
		const complete: Complete = async () => ({ text: answer, costUsd: 0.002 });
		const attempt = await generatePool(complete, input, CORE_KINDS);
		expect(attempt).toMatchObject({
			costUsd: 0.002,
			pool: [{ kind: "verify", prompt: "Run the retry tests." }],
		});
	});

	test("no provider, a bad answer, a throw and a slow call each say why", async () => {
		expect(await generatePool(async () => null, input, CORE_KINDS)).toEqual({
			reason: "no_provider",
		});
		expect(
			await generatePool(async () => ({ text: "sorry" }), input, CORE_KINDS),
		).toEqual({ reason: "unparseable" });
		expect(
			await generatePool(
				async () => Promise.reject(new Error("401")),
				input,
				CORE_KINDS,
			),
		).toEqual({ reason: "error", error: "401" });
		let aborted = false;
		const slow: Complete = (_input, signal) =>
			new Promise((resolve) => {
				signal.addEventListener("abort", () => {
					aborted = true;
					resolve({ text: answer });
				});
			});
		expect(await generatePool(slow, input, CORE_KINDS, 5)).toEqual({
			reason: "timeout",
		});
		expect(aborted).toBe(true);
	});

	test("pools are kept per turn position, oldest dropped first", () => {
		const cache = new PoolCache(2);
		const pool = [suggestion("verify", "model", "Run it.", "why")];
		cache.set("a", pool);
		cache.set("b", pool);
		cache.set("a", pool);
		cache.set("c", pool);
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("a")).toBe(pool);
	});
});

describe("the planner's provider", () => {
	test("the chat's provider and model by default; the settings' choice when set", () => {
		const settings = defaultSettings();
		expect(
			plannerProvider(settings, { providerId: "anthropic", modelId: "m" }),
		).toEqual({ providerId: "anthropic", modelId: "m" });
		expect(plannerProvider(settings)).toEqual({});
		settings.planner.model = {
			kind: "model",
			providerId: "openai",
			modelId: "fast",
		};
		expect(
			plannerProvider(settings, { providerId: "anthropic", modelId: "m" }),
		).toEqual({ providerId: "openai", modelId: "fast" });
	});

	function fakeCore(
		config: Record<string, unknown> | undefined,
		oauthKey?: string,
		stored?: Record<string, unknown>,
	) {
		const asked: string[] = [];
		const core = {
			CORE_BUILD_VERSION: "0.0.92",
			ProviderSettingsManager: class {
				getProviderConfig(id: string) {
					asked.push(`provider:${id}`);
					return config;
				}
				getProviderSettings(id: string) {
					asked.push(`settings:${id}`);
					return stored;
				}
				getLastUsedProviderConfig() {
					asked.push("last-used");
					return config;
				}
			},
			RuntimeOAuthTokenManager: class {
				async resolveProviderApiKey() {
					return oauthKey ? { apiKey: oauthKey } : undefined;
				}
			},
			resolveProviderApiKeyFromSettings: () => undefined,
		};
		return { core: core as unknown as typeof import("@cline/core"), asked };
	}

	test("resolves the key the way a chat does, never borrows last-used when the chat provider is unknown, and refuses a provider it cannot call", async () => {
		const { core, asked } = fakeCore(
			{ providerId: "cline", modelId: "x", apiKey: "" },
			"oauth-key",
		);
		expect(
			await resolveProviderConfig(core, { providerId: "cline", modelId: "y" }),
		).toMatchObject({
			providerId: "cline",
			modelId: "y",
			apiKey: "oauth-key",
			accessToken: "oauth-key",
		});
		expect(asked).toEqual(["provider:cline", "settings:cline"]);
		const noChoice = fakeCore({ providerId: "openai", apiKey: "k" });
		expect(await resolveProviderConfig(noChoice.core, {})).toBeUndefined();
		expect(noChoice.asked).toEqual([]);
		expect(
			await resolveProviderConfig(
				fakeCore({ providerId: "openai", apiKey: "" }).core,
				{ providerId: "openai" },
			),
		).toBeUndefined();
		expect(
			await resolveProviderConfig(fakeCore(undefined).core, {
				providerId: "openai",
			}),
		).toBeUndefined();
		expect(
			await resolveProviderConfig(
				fakeCore({ providerId: "ollama", baseUrl: "http://localhost:11434" })
					.core,
				{ providerId: "ollama" },
			),
		).toMatchObject({ providerId: "ollama" });
	});

	test("attaches the chat path's request headers for cline, cline-pass, openai-codex, anthropic and opencode-go", async () => {
		const desktopClient = {
			name: "cline-desktop",
			version: "0.0.45",
			platform: "darwin",
			platformVersion: "24.0.0",
			isMultiRoot: false,
		};
		const llms = { resolveProviderRequestHeaders };

		for (const providerId of ["cline", "cline-pass"]) {
			const { core } = fakeCore(
				{ providerId, modelId: "claude-sonnet", apiKey: "tok" },
				undefined,
				{ headers: { "X-Custom": "1" } },
			);
			const resolved = await resolveProviderConfig(
				core,
				{ providerId, modelId: "claude-sonnet" },
				llms,
				{
					sessionId: "sess_42",
					client: desktopClient,
				},
			);
			expect(resolved?.headers).toEqual({
				"X-Custom": "1",
				"HTTP-Referer": "https://cline.bot",
				"X-Title": "Cline",
				"X-IS-MULTIROOT": "false",
				"X-CLIENT-TYPE": "cline-desktop",
				"X-CLIENT-VERSION": "0.0.45",
				"X-PLATFORM": "darwin",
				"X-PLATFORM-VERSION": "24.0.0",
				"X-CORE-VERSION": "0.0.92",
				"X-Task-ID": "sess_42",
				"User-Agent": "Cline/0.0.45",
			});
		}

		const jwtPayload = Buffer.from(
			JSON.stringify({ chatgpt_account_id: "acct_jwt" }),
		).toString("base64url");
		const jwt = `eyJhbGciOiJub25lIn0.${jwtPayload}.sig`;
		const codex = await resolveProviderConfig(
			fakeCore({ providerId: "openai-codex", modelId: "gpt-5", apiKey: jwt })
				.core,
			{ providerId: "openai-codex", modelId: "gpt-5" },
			llms,
			{ sessionId: "sess_codex", client: desktopClient },
		);
		expect(codex?.headers).toMatchObject({
			originator: "cline",
			session_id: "sess_codex",
			"ChatGPT-Account-Id": "acct_jwt",
		});

		const anthropic = await resolveProviderConfig(
			fakeCore(
				{ providerId: "anthropic", modelId: "claude", apiKey: "sk-ant" },
				undefined,
				{ headers: { "anthropic-beta": "prompt-caching" } },
			).core,
			{ providerId: "anthropic", modelId: "claude" },
			llms,
			{ sessionId: "sess_ant", client: desktopClient },
		);
		expect(anthropic?.headers).toEqual({ "anthropic-beta": "prompt-caching" });

		const opencode = await resolveProviderConfig(
			fakeCore({ providerId: "opencode-go", modelId: "go-1", apiKey: "oc-key" })
				.core,
			{ providerId: "opencode-go", modelId: "go-1" },
			llms,
			{ sessionId: "sess_oc", client: desktopClient },
		);
		expect(opencode?.headers).toEqual({
			"x-opencode-session": "sess_oc",
			"User-Agent": "Cline/0.0.45",
		});
	});

	test("streams the answer and sums the reported cost; a failed stream throws", async () => {
		const handler = (chunks: unknown[]) =>
			({
				async *createMessage() {
					for (const chunk of chunks) yield chunk;
				},
			}) as unknown as ApiHandler;
		expect(
			await streamCompletion(
				handler([
					{ type: "text", text: '{"sugg' },
					{
						type: "usage",
						inputTokens: 1,
						outputTokens: 1,
						totalCost: 0.001,
						id: "r",
					},
					{ type: "text", text: 'estions":[]}' },
					{
						type: "usage",
						inputTokens: 1,
						outputTokens: 1,
						totalCost: 0.002,
						id: "r",
					},
				]),
				input,
			),
		).toEqual({ text: '{"suggestions":[]}', costUsd: 0.003 });
		await expect(
			streamCompletion(
				handler([{ type: "done", success: false, error: "overloaded" }]),
				input,
			),
		).rejects.toThrow("overloaded");
	});

	test("the completer imports Cline on first use and calls with the planner's bounds", async () => {
		const configs: Record<string, unknown>[] = [];
		const { core } = fakeCore({
			providerId: "anthropic",
			modelId: "m",
			apiKey: "k",
		});
		const llms = {
			createHandlerAsync: async (config: Record<string, unknown>) => {
				configs.push(config);
				return {
					async *createMessage() {
						yield { type: "text", text: answer };
					},
				};
			},
		} as unknown as typeof import("@cline/llms");
		const complete = clineCompleter(
			() => ({ providerId: "anthropic", modelId: "m" }),
			async () => ({ core, llms }),
		);
		expect(await complete(input, new AbortController().signal)).toEqual({
			text: answer,
			providerId: "anthropic",
			modelId: "m",
		});
		expect(configs[0]).toMatchObject({
			providerId: "anthropic",
			thinking: false,
			maxOutputTokens: 600,
		});
		const none = clineCompleter(
			() => ({}),
			async () => ({ core: fakeCore(undefined).core, llms }),
		);
		expect(await none(input, new AbortController().signal)).toBeNull();
	});

	test("a call refused with reasoning off is asked once more with low reasoning; an aborted call is not", async () => {
		const { core } = fakeCore({
			providerId: "cline",
			modelId: "m",
			apiKey: "k",
		});
		const configs: Record<string, unknown>[] = [];
		const llms = (alwaysFail = false) =>
			({
				createHandlerAsync: async (config: Record<string, unknown>) => {
					configs.push(config);
					return {
						async *createMessage() {
							if (alwaysFail || config.thinking === false)
								throw new Error("400 from the provider");
							yield { type: "text", text: answer };
						},
					};
				},
			}) as unknown as typeof import("@cline/llms");
		const refusesOff = clineCompleter(
			() => ({ providerId: "cline", modelId: "m" }),
			async () => ({ core, llms: llms() }),
		);
		expect(await refusesOff(input, new AbortController().signal)).toEqual({
			text: answer,
			providerId: "cline",
			modelId: "m",
		});
		expect(configs.map((config) => config.thinking)).toEqual([false, true]);
		expect(configs[1]).toMatchObject({
			maxOutputTokens: 2_000,
			reasoningEffort: "low",
		});
		configs.length = 0;
		expect(await refusesOff(input, new AbortController().signal)).toEqual({
			text: answer,
			providerId: "cline",
			modelId: "m",
		});
		expect(configs.map((config) => config.thinking)).toEqual([true]);
		configs.length = 0;
		const otherModel = fakeCore({
			providerId: "cline",
			modelId: "other",
			apiKey: "k",
		}).core;
		const broken = clineCompleter(
			() => ({ providerId: "cline" }),
			async () => ({ core: otherModel, llms: llms(true) }),
		);
		await expect(broken(input, new AbortController().signal)).rejects.toThrow(
			"400",
		);
		expect(configs).toHaveLength(2);
		configs.length = 0;
		const aborted = new AbortController();
		aborted.abort();
		await expect(broken(input, aborted.signal)).rejects.toThrow("400");
		expect(configs).toHaveLength(1);
	});
});
