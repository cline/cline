import { expect, test } from "bun:test";
import { type CompleteRequest, clineCompleter } from "./completer";

type Bounds = {
	thinking: boolean;
	maxOutputTokens: number;
	reasoningEffort?: string;
};

/** Just the parts of `@cline/core` the completer touches, over an in-memory provider store. */
function fakeCore(options: {
	stored?: Record<string, unknown>;
	failures?: Array<Error | undefined>;
	classify?: (error: unknown) => string;
}) {
	const attempts: Bounds[] = [];
	const failures = [...(options.failures ?? [])];
	const core = {
		CORE_BUILD_VERSION: "0.0.0-test",
		ProviderSettingsManager: class {
			getProviderSettings(providerId: string) {
				return options.stored?.[providerId];
			}
		},
		toProviderConfig: (stored: { providerId: string; apiKey?: string }) => ({
			providerId: stored.providerId,
			apiKey: stored.apiKey,
		}),
		resolveProviderApiKeyFromSettings: () => undefined,
		isProviderSettingsUsable: () => false,
		Llms: {
			resolveProviderRequestHeaders: () => ({ "x-test": "1" }),
			classifyProviderError: options.classify ?? (() => "unknown"),
			isRetryableProviderError: () => false,
			createHandlerAsync: async (
				config: Bounds & { abortSignal: AbortSignal },
			) => {
				attempts.push({
					thinking: config.thinking,
					maxOutputTokens: config.maxOutputTokens,
					reasoningEffort: config.reasoningEffort,
				});
				const failure = failures.shift();
				return {
					setAbortSignal: () => {},
					async *createMessage() {
						if (failure) throw failure;
						yield { type: "text", text: '{"suggestions":[]}' };
						yield {
							type: "usage",
							inputTokens: 10,
							outputTokens: 4,
							totalCost: 0.001,
						};
					},
				};
			},
		},
	};
	return { core: core as never, attempts };
}

const request = (): CompleteRequest => ({
	input: { system: "s", user: "u" },
	chat: { providerId: "anthropic", modelId: "claude-x" },
	sessionId: "sess-1",
	signal: new AbortController().signal,
});

const STORED = { anthropic: { providerId: "anthropic", apiKey: "k" } };

test("the call is tool-less with reasoning off, on the chat's provider and model, and reports usage", async () => {
	const { core, attempts } = fakeCore({ stored: STORED });
	const answer = await clineCompleter(async () => core)(request());
	expect(answer).toEqual({
		text: '{"suggestions":[]}',
		usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.001 },
	});
	expect(attempts).toEqual([
		{ thinking: false, maxOutputTokens: 400, reasoningEffort: undefined },
	]);
});

test("a model that refuses reasoning off is retried with low reasoning, and later calls skip the first try", async () => {
	const { core, attempts } = fakeCore({
		stored: STORED,
		failures: [new Error("reasoning is mandatory for this model")],
	});
	const complete = clineCompleter(async () => core);
	const secondModel = {
		...request(),
		chat: { providerId: "anthropic", modelId: "claude-y" },
	};
	await complete(secondModel);
	await complete(secondModel);
	expect(attempts).toEqual([
		{ thinking: false, maxOutputTokens: 400, reasoningEffort: undefined },
		{ thinking: true, maxOutputTokens: 2_000, reasoningEffort: "low" },
		{ thinking: true, maxOutputTokens: 2_000, reasoningEffort: "low" },
	]);
});

test("an auth failure is not retried", async () => {
	const { core, attempts } = fakeCore({
		stored: STORED,
		failures: [new Error("401")],
		classify: () => "auth",
	});
	await expect(clineCompleter(async () => core)(request())).rejects.toThrow(
		"401",
	);
	expect(attempts).toHaveLength(1);
});

test("a provider the chat uses but has no stored credentials for resolves to no model", async () => {
	const { core, attempts } = fakeCore({ stored: {} });
	expect(await clineCompleter(async () => core)(request())).toBeNull();
	expect(attempts).toHaveLength(0);
});

test("a failed load of @cline/core is retried by the next call", async () => {
	const { core } = fakeCore({ stored: STORED });
	let loads = 0;
	const complete = clineCompleter(async () => {
		loads += 1;
		if (loads === 1) throw new Error("import budget");
		return core;
	});
	await expect(complete(request())).rejects.toThrow("import budget");
	expect((await complete(request()))?.text).toBe('{"suggestions":[]}');
});
