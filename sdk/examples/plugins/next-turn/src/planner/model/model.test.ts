import { describe, expect, test } from "bun:test";
import {
	type ApiHandler,
	type ApiStreamChunk,
	classifyProviderError,
	isRetryableProviderError,
	resolveProviderRequestHeaders,
} from "@cline/llms";
import { PLANNER_MAX_OUTPUT_TOKENS, POOL_CACHE_LIMIT } from "../../config";
import { defaultSettings } from "../../settings/settings";
import { suggestion } from "../candidates";
import { CORE_KINDS } from "../kinds";
import {
	CallMeter,
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
const usage = (
	inputTokens: number,
	totalCost: number,
): Extract<ApiStreamChunk, { type: "usage" }> => ({
	type: "usage",
	inputTokens,
	outputTokens: 10,
	totalCost,
	id: "r",
});

describe("one planner call", () => {
	test("a good answer is a pool, with its cost", async () => {
		const complete: Complete = async (_input, _signal, _settings, meter) => {
			meter.note(usage(1_000, 0.002));
			return { text: answer };
		};
		const attempt = await generatePool(complete, input, CORE_KINDS, defaults);
		expect(attempt).toMatchObject({
			costUsd: 0.002,
			pool: [{ kind: "verify", prompt: "Run the retry tests." }],
		});
	});

	test("no provider, a bad answer, a throw and a slow call each say why", async () => {
		expect(
			await generatePool(async () => null, input, CORE_KINDS, defaults),
		).toEqual({ reason: "no_provider", totalMs: expect.any(Number) });
		expect(
			await generatePool(
				async () => ({ text: "sorry" }),
				input,
				CORE_KINDS,
				defaults,
			),
		).toEqual({ reason: "unparseable", totalMs: expect.any(Number) });
		expect(
			await generatePool(
				async () => Promise.reject(new Error("401")),
				input,
				CORE_KINDS,
				defaults,
			),
		).toEqual({ reason: "error", error: "401", totalMs: expect.any(Number) });
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
			totalMs: expect.any(Number),
		});
		expect(aborted).toBe(true);
	});

	test("a call that fails or outlasts the deadline keeps what it had measured by then, and nothing reported later", async () => {
		const measureSoFar = (meter: CallMeter) => {
			meter.asking({ providerId: "openai", modelId: "fast" });
			meter.sending();
			meter.note({ type: "text", text: "{", id: "r" });
			meter.note(usage(500, 0.005));
		};
		const failed = await generatePool(
			async (_input, _signal, _settings, meter) => {
				measureSoFar(meter);
				throw new Error("overloaded");
			},
			input,
			CORE_KINDS,
			defaults,
		);
		let reportLate = () => {};
		const slow: Complete = (_input, signal, _settings, meter) =>
			new Promise((resolve) => {
				measureSoFar(meter);
				signal.addEventListener("abort", () => {
					reportLate = () => meter.note(usage(5_000, 0.5));
					resolve({ text: answer });
				});
			});
		const timedOut = await generatePool(slow, input, CORE_KINDS, defaults, 5);
		reportLate();
		const measured = {
			usage: {
				inputTokens: 500,
				outputTokens: 10,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
			costUsd: 0.005,
			totalMs: expect.any(Number),
			firstTokenMs: expect.any(Number),
			providerId: "openai",
			modelId: "fast",
		};
		expect(failed).toEqual({
			reason: "error",
			error: "overloaded",
			...measured,
		});
		expect(timedOut).toEqual({ reason: "timeout", ...measured });
	});

	test("a call gone stale is aborted and says so, keeping what it measured, even when it answers anyway", async () => {
		const stale = new AbortController();
		const answersAnyway: Complete = (_input, signal, _settings, meter) =>
			new Promise((resolve) => {
				meter.note(usage(900, 0.009));
				signal.addEventListener("abort", () => resolve({ text: answer }));
				stale.abort();
			});
		expect(
			await generatePool(
				answersAnyway,
				input,
				CORE_KINDS,
				defaults,
				1_000,
				stale.signal,
			),
		).toEqual({
			reason: "aborted",
			totalMs: expect.any(Number),
			costUsd: 0.009,
			usage: {
				inputTokens: 900,
				outputTokens: 10,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		});
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

	test("streams the answer and notes, as they arrive, the usage, cost and reasoning tokens reported and the first token from the request; a failed stream throws, its measurements kept", async () => {
		const handler = (chunks: unknown[]) =>
			({
				async *createMessage() {
					for (const chunk of chunks) yield chunk;
				},
			}) as unknown as ApiHandler;
		let clock = 100;
		const meter = new CallMeter(() => {
			clock += 250;
			return clock;
		});
		expect(
			await streamCompletion(
				handler([
					{ type: "reasoning", reasoning: "thinking", id: "r" },
					{ type: "text", text: '{"sugg' },
					{
						type: "usage",
						inputTokens: 1_000,
						outputTokens: 10,
						cacheReadTokens: 800,
						thoughtsTokenCount: 30,
						totalCost: 0.001,
						id: "r",
					},
					{ type: "text", text: 'estions":[]}' },
					{
						type: "usage",
						inputTokens: 1,
						outputTokens: 5,
						cacheWriteTokens: 40,
						thoughtsTokenCount: 12,
						totalCost: 0.002,
						id: "r",
					},
				]),
				input,
				meter,
			),
		).toBe('{"suggestions":[]}');
		expect(meter.read()).toEqual({
			totalMs: 750,
			firstTokenMs: 250,
			costUsd: 0.003,
			usage: {
				inputTokens: 1_001,
				outputTokens: 15,
				cacheReadTokens: 800,
				cacheWriteTokens: 40,
				reasoningTokens: 42,
			},
		});
		const noReasoningCount = new CallMeter();
		await streamCompletion(
			handler([{ type: "text", text: "{}" }, usage(1, 0.001)]),
			input,
			noReasoningCount,
		);
		expect(noReasoningCount.read().usage).not.toHaveProperty("reasoningTokens");
		const failed = new CallMeter();
		await expect(
			streamCompletion(
				handler([
					{ type: "text", text: "{" },
					usage(1_000, 0.01),
					{ type: "done", success: false, error: "overloaded" },
				]),
				input,
				failed,
			),
		).rejects.toThrow("overloaded");
		expect(failed.read()).toMatchObject({
			usage: { inputTokens: 1_000 },
			costUsd: 0.01,
			firstTokenMs: expect.any(Number),
		});
	});

	test("the completer imports Cline on first use, only once a provider is known, and calls with the planner's bounds; the first token is timed from the request, the import left out", async () => {
		const configs: Record<string, unknown>[] = [];
		const { core } = fakeCore({
			providerId: "anthropic",
			modelId: "m",
			apiKey: "k",
		});
		let clock = 0;
		const llms = {
			...llmsHelpers,
			createHandlerAsync: async (config: Record<string, unknown>) => {
				configs.push(config);
				return {
					async *createMessage() {
						clock += 300;
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
				clock += 4_000;
				return { core, llms };
			},
		});
		const meter = new CallMeter(() => clock);
		expect(
			await complete(input, new AbortController().signal, defaults, meter),
		).toEqual({ text: answer });
		expect(meter.read()).toEqual({
			providerId: "anthropic",
			modelId: "m",
			totalMs: 4_300,
			firstTokenMs: 300,
		});
		expect(configs[0]).toMatchObject({
			providerId: "anthropic",
			thinking: false,
			maxOutputTokens: PLANNER_MAX_OUTPUT_TOKENS,
		});
		await complete(
			input,
			new AbortController().signal,
			defaults,
			new CallMeter(),
		);
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
			await none(
				input,
				new AbortController().signal,
				defaults,
				new CallMeter(),
			),
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
		const ask = (complete: Complete, signal = new AbortController().signal) =>
			complete(input, signal, defaults, new CallMeter());
		const refusesOff = completer("m");
		expect(await ask(refusesOff)).toEqual({ text: answer });
		expect(configs.map((config) => config.thinking)).toEqual([false, true]);
		expect(configs[1]).toMatchObject({
			maxOutputTokens: 2_000,
			reasoningEffort: "low",
		});
		configs.length = 0;
		expect(await ask(refusesOff)).toEqual({ text: answer });
		expect(configs.map((config) => config.thinking)).toEqual([true]);
		configs.length = 0;
		const broken = completer("other", () => new Error("400 from the provider"));
		await expect(ask(broken)).rejects.toThrow("400");
		expect(configs).toHaveLength(2);
		configs.length = 0;
		const aborted = new AbortController();
		aborted.abort();
		await expect(ask(broken, aborted.signal)).rejects.toThrow("400");
		expect(configs).toHaveLength(1);
		configs.length = 0;
		const unauthorized = completer("auth", () =>
			Object.assign(new Error("unauthorized"), { status: 401 }),
		);
		await expect(ask(unauthorized)).rejects.toThrow("unauthorized");
		expect(configs).toHaveLength(1);
		configs.length = 0;
		const busy = completer("busy", () =>
			Object.assign(new Error("overloaded"), { status: 503 }),
		);
		await expect(ask(busy)).rejects.toThrow("overloaded");
		await expect(ask(busy)).rejects.toThrow("overloaded");
		expect(configs.map((config) => config.thinking)).toEqual([false, false]);
	});

	/** A completer whose provider streams `attempts` in order, one per request; an `Error` among the chunks is thrown there. */
	function streamsInTurn(modelId: string, ...attempts: unknown[][]): Complete {
		let requests = 0;
		const llms = {
			...llmsHelpers,
			createHandlerAsync: async () => {
				const chunks = attempts[requests++] ?? [];
				return {
					async *createMessage() {
						for (const chunk of chunks) {
							if (chunk instanceof Error) throw chunk;
							yield chunk;
						}
					},
				};
			},
		} as unknown as typeof import("@cline/llms");
		return clineCompleter({
			choice: () => ({ providerId: "cline" }),
			load: async () => ({
				core: fakeCore({ providerId: "cline", modelId, apiKey: "k" }).core,
				llms,
			}),
		});
	}

	test("a call that fails keeps what the provider had reported and names the model it asked, even when it never reached it", async () => {
		expect(
			await generatePool(
				streamsInTurn("ends-failed", [
					{ type: "text", text: "{" },
					usage(1_000, 0.01),
					{
						type: "done",
						success: false,
						error: "Provider returned error",
						id: "r",
					},
				]),
				input,
				CORE_KINDS,
				defaults,
			),
		).toMatchObject({
			reason: "error",
			error: "Provider returned error",
			usage: { inputTokens: 1_000, outputTokens: 10 },
			costUsd: 0.01,
			firstTokenMs: expect.any(Number),
			providerId: "cline",
			modelId: "ends-failed",
		});
		expect(
			await generatePool(
				streamsInTurn("breaks", [
					{ type: "reasoning", reasoning: "Weighing the tests", id: "r" },
					usage(2_000, 0.02),
					Object.assign(new Error("socket hang up"), { status: 503 }),
				]),
				input,
				CORE_KINDS,
				defaults,
			),
		).toMatchObject({
			reason: "error",
			error: "socket hang up",
			usage: { inputTokens: 2_000 },
			costUsd: 0.02,
			firstTokenMs: expect.any(Number),
			providerId: "cline",
			modelId: "breaks",
		});
		expect(
			await generatePool(
				clineCompleter({
					choice: () => ({ providerId: "openai", modelId: "fast" }),
					load: () => Promise.reject(new Error("cannot load @cline/core")),
				}),
				input,
				CORE_KINDS,
				defaults,
			),
		).toMatchObject({ reason: "error", providerId: "openai", modelId: "fast" });
	});

	test("a first attempt refused with reasoning off counts with its retry: usage, cost and reasoning tokens summed, the first token the call's first", async () => {
		const refusal = {
			type: "done",
			success: false,
			error: "reasoning is required for this model",
			id: "r",
		};
		let clock = 0;
		const meter = new CallMeter(() => {
			clock += 100;
			return clock;
		});
		expect(
			await streamsInTurn(
				"retried",
				[{ type: "text", text: "{" }, usage(1_000, 0.01), refusal],
				[
					{ type: "reasoning", reasoning: "Weighing the tests", id: "r" },
					{ type: "text", text: answer },
					{ ...usage(2_000, 0.02), thoughtsTokenCount: 300 },
				],
			)(input, new AbortController().signal, defaults, meter),
		).toEqual({ text: answer });
		expect(meter.read()).toEqual({
			totalMs: 300,
			firstTokenMs: 100,
			usage: {
				inputTokens: 3_000,
				outputTokens: 20,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				reasoningTokens: 300,
			},
			costUsd: 0.03,
			providerId: "cline",
			modelId: "retried",
		});
		expect(
			await generatePool(
				streamsInTurn(
					"both-refused",
					[usage(1_000, 0.01), refusal],
					[
						usage(2_000, 0.02),
						{ ...refusal, error: "low reasoning refused too" },
					],
				),
				input,
				CORE_KINDS,
				defaults,
			),
		).toMatchObject({
			reason: "error",
			error: "low reasoning refused too",
			usage: { inputTokens: 3_000, outputTokens: 20 },
			costUsd: 0.03,
			modelId: "both-refused",
		});
	});
});
