import { describe, expect, test } from "bun:test";
import {
	type ApiHandler,
	classifyProviderError,
	isRetryableProviderError,
	resolveProviderRequestHeaders,
} from "@cline/llms";
import { POOL_CACHE_LIMIT } from "../config";
import { defaultSettings } from "../settings/settings";
import { suggestion } from "./candidates";
import { CORE_KINDS } from "./kinds";
import {
	type Complete,
	clineCompleter,
	generatePool,
	PoolCache,
	plannerProvider,
	providerResolver,
	streamCompletion,
} from "./model";

const input = { system: "s", user: "u" };
const defaults = defaultSettings();
const answer =
	'{"suggestions":[{"kind":"verify","source":"turn","prompt":"Run the retry tests.","why":"changed"}]}';

describe("one planner call", () => {
	test("a good answer is a pool, with its cost", async () => {
		const complete: Complete = async () => ({ text: answer, costUsd: 0.002 });
		const attempt = await generatePool(complete, input, CORE_KINDS, defaults);
		expect(attempt).toMatchObject({
			costUsd: 0.002,
			pool: [{ kind: "verify", prompt: "Run the retry tests." }],
		});
	});

	test("no provider, a bad answer, a throw and a slow call each say why", async () => {
		expect(
			await generatePool(async () => null, input, CORE_KINDS, defaults),
		).toEqual({
			reason: "no_provider",
		});
		expect(
			await generatePool(
				async () => ({ text: "sorry" }),
				input,
				CORE_KINDS,
				defaults,
			),
		).toEqual({ reason: "unparseable" });
		expect(
			await generatePool(
				async () => Promise.reject(new Error("401")),
				input,
				CORE_KINDS,
				defaults,
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
		expect(await generatePool(slow, input, CORE_KINDS, defaults, 5)).toEqual({
			reason: "timeout",
		});
		expect(aborted).toBe(true);
	});

	test("pools are kept per turn position, oldest dropped first", () => {
		const cache = new PoolCache();
		const pool = [suggestion("verify", "model", "Run it.", "why")];
		for (let index = 0; index < POOL_CACHE_LIMIT; index += 1)
			cache.set(`k${index}`, pool);
		cache.set("k0", pool);
		cache.set("overflow", pool);
		expect(cache.get("k1")).toBeUndefined();
		expect(cache.get("k0")).toBe(pool);
		expect(cache.get("overflow")).toBe(pool);
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

	/** Settings already shaped as the provider config, so the fake's `toProviderConfig` passes them through. */
	function fakeCore(
		settings: Record<string, unknown> | undefined,
		oauthKey?: string,
	) {
		const asked: string[] = [];
		const core = {
			CORE_BUILD_VERSION: "0.0.92",
			ProviderSettingsManager: class {
				getProviderSettings(id: string) {
					asked.push(`settings:${id}`);
					return settings;
				}
				getLastUsedProviderConfig() {
					asked.push("last-used");
					return settings;
				}
			},
			RuntimeOAuthTokenManager: class {
				async resolveProviderApiKey() {
					return oauthKey ? { apiKey: oauthKey } : undefined;
				}
			},
			resolveProviderApiKeyFromSettings: () => undefined,
			toProviderConfig: (stored: Record<string, unknown>) => ({ ...stored }),
		};
		return { core: core as unknown as typeof import("@cline/core"), asked };
	}

	const llmsHelpers = {
		resolveProviderRequestHeaders,
		classifyProviderError,
		isRetryableProviderError,
	};

	test("resolves the key the way a chat does, reads the provider's settings once, and refuses a provider it cannot call", async () => {
		const { core, asked } = fakeCore(
			{ providerId: "cline", modelId: "x", apiKey: "" },
			"oauth-key",
		);
		expect(
			await providerResolver(
				core,
				llmsHelpers,
			)({
				providerId: "cline",
				modelId: "y",
			}),
		).toMatchObject({
			providerId: "cline",
			modelId: "y",
			apiKey: "oauth-key",
			accessToken: "oauth-key",
		});
		expect(asked).toEqual(["settings:cline"]);
		const resolveWith = (settings: Record<string, unknown> | undefined) =>
			providerResolver(fakeCore(settings).core, llmsHelpers);
		expect(
			await resolveWith({ providerId: "openai", apiKey: "" })({
				providerId: "openai",
			}),
		).toBeUndefined();
		expect(
			await resolveWith(undefined)({ providerId: "openai" }),
		).toBeUndefined();
		expect(
			await resolveWith({
				providerId: "ollama",
				baseUrl: "http://localhost:11434",
			})({ providerId: "ollama" }),
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
		const resolve = (settings: Record<string, unknown>, sessionId: string) =>
			providerResolver(fakeCore(settings).core, llmsHelpers)(
				{
					providerId: String(settings.providerId),
					modelId: String(settings.modelId),
				},
				{ sessionId, client: desktopClient },
			);

		for (const providerId of ["cline", "cline-pass"]) {
			const resolved = await resolve(
				{
					providerId,
					modelId: "claude-sonnet",
					apiKey: "tok",
					headers: { "X-Custom": "1" },
				},
				"sess_42",
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
		const codex = await resolve(
			{ providerId: "openai-codex", modelId: "gpt-5", apiKey: jwt },
			"sess_codex",
		);
		expect(codex?.headers).toMatchObject({
			originator: "cline",
			session_id: "sess_codex",
			"ChatGPT-Account-Id": "acct_jwt",
		});

		const anthropic = await resolve(
			{
				providerId: "anthropic",
				modelId: "claude",
				apiKey: "sk-ant",
				headers: { "anthropic-beta": "prompt-caching" },
			},
			"sess_ant",
		);
		expect(anthropic?.headers).toEqual({ "anthropic-beta": "prompt-caching" });

		const opencode = await resolve(
			{ providerId: "opencode-go", modelId: "go-1", apiKey: "oc-key" },
			"sess_oc",
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

	test("the completer imports Cline on first use, only once a provider is known, and calls with the planner's bounds", async () => {
		const configs: Record<string, unknown>[] = [];
		const { core } = fakeCore({
			providerId: "anthropic",
			modelId: "m",
			apiKey: "k",
		});
		const llms = {
			...llmsHelpers,
			createHandlerAsync: async (config: Record<string, unknown>) => {
				configs.push(config);
				return {
					async *createMessage() {
						yield { type: "text", text: answer };
					},
				};
			},
		} as unknown as typeof import("@cline/llms");
		let loads = 0;
		const viewers = ["cline-cli", "cline-desktop"];
		const complete = clineCompleter({
			choice: () => ({ providerId: "anthropic", modelId: "m" }),
			requestContext: () => ({ client: { name: viewers.shift() } }),
			load: async () => {
				loads += 1;
				return { core, llms };
			},
		});
		expect(
			await complete(input, new AbortController().signal, defaults),
		).toEqual({
			text: answer,
			providerId: "anthropic",
			modelId: "m",
		});
		expect(configs[0]).toMatchObject({
			providerId: "anthropic",
			thinking: false,
			maxOutputTokens: 600,
		});
		await complete(input, new AbortController().signal, defaults);
		expect(loads).toBe(1);
		expect(viewers).toEqual([]);
		const none = clineCompleter({
			choice: () => ({}),
			load: async () => {
				loads += 1;
				return { core: fakeCore(undefined).core, llms };
			},
		});
		expect(
			await none(input, new AbortController().signal, defaults),
		).toBeNull();
		expect(loads).toBe(1);
	});

	test("a call refused with reasoning off is asked once more with low reasoning; an aborted, unauthorized or transient failure is not", async () => {
		const configs: Record<string, unknown>[] = [];
		const llms = (failure?: () => Error) =>
			({
				...llmsHelpers,
				createHandlerAsync: async (config: Record<string, unknown>) => {
					configs.push(config);
					return {
						async *createMessage() {
							if (failure) throw failure();
							if (config.thinking === false)
								throw new Error("400 from the provider");
							yield { type: "text", text: answer };
						},
					};
				},
			}) as unknown as typeof import("@cline/llms");
		const completer = (modelId: string, failure?: () => Error) =>
			clineCompleter({
				choice: () => ({ providerId: "cline" }),
				load: async () => ({
					core: fakeCore({ providerId: "cline", modelId, apiKey: "k" }).core,
					llms: llms(failure),
				}),
			});
		const refusesOff = completer("m");
		expect(
			await refusesOff(input, new AbortController().signal, defaults),
		).toEqual({
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
		expect(
			await refusesOff(input, new AbortController().signal, defaults),
		).toEqual({
			text: answer,
			providerId: "cline",
			modelId: "m",
		});
		expect(configs.map((config) => config.thinking)).toEqual([true]);
		configs.length = 0;
		const broken = completer("other", () => new Error("400 from the provider"));
		await expect(
			broken(input, new AbortController().signal, defaults),
		).rejects.toThrow("400");
		expect(configs).toHaveLength(2);
		configs.length = 0;
		const aborted = new AbortController();
		aborted.abort();
		await expect(broken(input, aborted.signal, defaults)).rejects.toThrow(
			"400",
		);
		expect(configs).toHaveLength(1);
		configs.length = 0;
		const unauthorized = completer("auth", () =>
			Object.assign(new Error("unauthorized"), { status: 401 }),
		);
		await expect(
			unauthorized(input, new AbortController().signal, defaults),
		).rejects.toThrow("unauthorized");
		expect(configs).toHaveLength(1);
		configs.length = 0;
		const busy = completer("busy", () =>
			Object.assign(new Error("overloaded"), { status: 503 }),
		);
		await expect(
			busy(input, new AbortController().signal, defaults),
		).rejects.toThrow("overloaded");
		await expect(
			busy(input, new AbortController().signal, defaults),
		).rejects.toThrow("overloaded");
		expect(configs.map((config) => config.thinking)).toEqual([false, false]);
	});
});
