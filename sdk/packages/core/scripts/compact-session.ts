#!/usr/bin/env bun

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { MessageWithMetadata } from "@cline/shared";
import { createContextCompactionPrepareTurn } from "../src/extensions/context/compaction";
import { getCompactionSummaryMetadata } from "../src/extensions/context/compaction-shared";
import { normalizeStoredMessagesForPersistence } from "../src/services/session-data";
import type { ProviderConfig } from "../src/types/provider-settings";

type CompactionStrategy = "basic" | "agentic";
type StrategySelection = CompactionStrategy | "both";

const PROVIDER_API_KEY_ENV: Record<string, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	cline: "CLINE_API_KEY",
	gemini: "GOOGLE_API_KEY",
	mistral: "MISTRAL_API_KEY",
	openai: "OPENAI_API_KEY",
	"openai-compatible": "OPENAI_API_KEY",
};

function usage(): never {
	console.error(`Usage:
	  bun -F @cline/core test:compaction -- <session-directory> [options]

Options:
	  --strategy <strategy>       basic, agentic, or both (default: both)
	  --provider <provider-id>    Required for agentic compaction
	  --model <model-id>          Required for agentic compaction
	  --api-key-env <name>        Environment variable containing the API key
	                              (agentic compaction only)
  --base-url <url>            Custom provider base URL
  --max-input-tokens <count>  Summarizer input limit (default: 128000)
  --max-output-tokens <count> Summarizer output limit (default: 1024)
  --preserve-recent-tokens <count>
                              Verbatim tail to retain (default: 0)
	  --output <path>             Write canonical compacted messages JSON. With
	                              --strategy both, .basic and .agentic are added
	                              before the file extension.

The directory must contain messages.json or exactly one *.messages.json file.
For agentic compaction, provider API key defaults are ANTHROPIC_API_KEY,
CLINE_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, or MISTRAL_API_KEY, according
to --provider.`);
	process.exit(1);
}

function positiveInteger(
	value: string | undefined,
	name: string,
	fallback: number,
): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

function nonNegativeInteger(
	value: string | undefined,
	name: string,
	fallback: number,
): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return parsed;
}

function parseStrategy(value: string | undefined): StrategySelection {
	const strategy = value ?? "both";
	if (strategy !== "basic" && strategy !== "agentic" && strategy !== "both") {
		throw new Error("--strategy must be basic, agentic, or both");
	}
	return strategy;
}

function selectedStrategies(
	selection: StrategySelection,
): CompactionStrategy[] {
	return selection === "both" ? ["basic", "agentic"] : [selection];
}

function strategyOutputPath(
	path: string,
	strategy: CompactionStrategy,
	selection: StrategySelection,
): string {
	const absolutePath = resolve(path);
	if (selection !== "both") return absolutePath;
	const extension = extname(absolutePath);
	const stem = extension
		? absolutePath.slice(0, -extension.length)
		: absolutePath;
	return `${stem}.${strategy}${extension}`;
}

async function resolveMessagesPath(directory: string): Promise<string> {
	const absoluteDirectory = resolve(directory);
	if (!(await stat(absoluteDirectory)).isDirectory()) {
		throw new Error(`Not a directory: ${absoluteDirectory}`);
	}
	const names = await readdir(absoluteDirectory);
	if (names.includes("messages.json"))
		return join(absoluteDirectory, "messages.json");
	const candidates = names.filter((name) => name.endsWith(".messages.json"));
	if (candidates.length !== 1) {
		throw new Error(
			`Expected exactly one *.messages.json in ${absoluteDirectory}; found ${candidates.length}`,
		);
	}
	return join(absoluteDirectory, candidates[0]);
}

function readMessages(payload: unknown): {
	messages: MessageWithMetadata[];
	systemPrompt: string;
	sessionId: string;
} {
	if (!payload || typeof payload !== "object")
		throw new Error("messages.json must contain an object");
	const record = payload as Record<string, unknown>;
	if (!Array.isArray(record.messages) || record.messages.length < 2) {
		throw new Error("messages.json must contain at least two messages");
	}
	for (const [index, message] of record.messages.entries()) {
		if (!message || typeof message !== "object")
			throw new Error(`messages[${index}] must be an object`);
		const candidate = message as Record<string, unknown>;
		if (
			(candidate.role !== "user" && candidate.role !== "assistant") ||
			(typeof candidate.content !== "string" &&
				!Array.isArray(candidate.content))
		) {
			throw new Error(
				`messages[${index}] must have a user/assistant role and string or array content`,
			);
		}
	}
	return {
		messages: record.messages as MessageWithMetadata[],
		systemPrompt:
			typeof record.system_prompt === "string" ? record.system_prompt : "",
		sessionId:
			typeof record.sessionId === "string"
				? record.sessionId
				: "offline-compaction",
	};
}

const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	strict: true,
	options: {
		strategy: { type: "string" },
		provider: { type: "string" },
		model: { type: "string" },
		"api-key-env": { type: "string" },
		"base-url": { type: "string" },
		"max-input-tokens": { type: "string" },
		"max-output-tokens": { type: "string" },
		"preserve-recent-tokens": { type: "string" },
		output: { type: "string" },
	},
});

const directory = positionals[0];
const providerId = values.provider;
const modelId = values.model;
if (!directory || positionals.length !== 1) usage();
const strategySelection = parseStrategy(values.strategy);
const strategies = selectedStrategies(strategySelection);
if (strategies.includes("agentic") && (!providerId || !modelId)) {
	console.error(
		"Error: --provider and --model are required for agentic compaction\n",
	);
	usage();
}

const maxInputTokens = positiveInteger(
	values["max-input-tokens"],
	"--max-input-tokens",
	128_000,
);
const maxOutputTokens = positiveInteger(
	values["max-output-tokens"],
	"--max-output-tokens",
	1_024,
);
const preserveRecentTokens = nonNegativeInteger(
	values["preserve-recent-tokens"],
	"--preserve-recent-tokens",
	0,
);
const needsProviderCredentials = strategies.includes("agentic");
const apiKeyEnvironment = needsProviderCredentials
	? (values["api-key-env"] ??
		(providerId ? PROVIDER_API_KEY_ENV[providerId] : undefined))
	: undefined;
const apiKey = apiKeyEnvironment ? process.env[apiKeyEnvironment] : undefined;
if (apiKeyEnvironment && !apiKey)
	throw new Error(`Missing API key in ${apiKeyEnvironment}`);

const messagesPath = await resolveMessagesPath(directory);
const payload = JSON.parse(await readFile(messagesPath, "utf8")) as unknown;
const { messages, systemPrompt, sessionId } = readMessages(payload);
const resolvedProviderId = providerId ?? "offline";
const resolvedModelId = modelId ?? "offline";
const providerConfig = {
	providerId: resolvedProviderId,
	modelId: resolvedModelId,
	...(apiKey ? { apiKey } : {}),
	...(values["base-url"] ? { baseUrl: values["base-url"] } : {}),
	maxOutputTokens,
	modelInfo: {
		id: resolvedModelId,
		contextWindow: maxInputTokens,
		maxInputTokens,
		maxTokens: maxOutputTokens,
	},
} as ProviderConfig;

console.error(`Reading ${messages.length} messages from ${messagesPath}`);
for (const strategy of strategies) {
	const compact = createContextCompactionPrepareTurn(
		{
			providerId: resolvedProviderId,
			modelId: resolvedModelId,
			providerConfig,
			sessionId,
			compaction: { enabled: true, strategy, preserveRecentTokens },
			logger: {
				debug: (message, metadata) =>
					console.error(`[${strategy}:debug] ${message}`, metadata ?? ""),
				log: (message, metadata) =>
					console.error(`[${strategy}:log] ${message}`, metadata ?? ""),
			},
		},
		{ mode: "manual" },
	);
	if (!compact) throw new Error(`${strategy} compaction was not initialized`);
	console.error(
		strategy === "agentic"
			? `Running agentic compaction with ${resolvedProviderId}/${resolvedModelId}`
			: "Running basic compaction",
	);
	const result = await compact({
		agentId: "offline-compaction",
		conversationId: sessionId,
		parentAgentId: null,
		iteration: 1,
		messages,
		apiMessages: messages,
		abortSignal: new AbortController().signal,
		systemPrompt,
		tools: [],
		model: {
			id: resolvedModelId,
			provider: resolvedProviderId,
			info: {
				id: resolvedModelId,
				contextWindow: maxInputTokens,
				maxInputTokens,
				maxTokens: maxOutputTokens,
			},
		},
	});
	if (!result?.messages)
		throw new Error(`${strategy} compaction produced no result`);

	console.log(`\n===== ${strategy.toUpperCase()} COMPACTION =====`);
	const summary = result.messages
		.map(getCompactionSummaryMetadata)
		.find(Boolean)?.summary;
	if (summary) console.log(summary);
	else console.log(JSON.stringify(result.messages, null, 2));

	if (values.output) {
		const outputPath = strategyOutputPath(
			values.output,
			strategy,
			strategySelection,
		);
		const outputPayload = {
			...(payload as Record<string, unknown>),
			updated_at: new Date().toISOString(),
			messages: normalizeStoredMessagesForPersistence(result.messages),
		};
		await writeFile(
			outputPath,
			`${JSON.stringify(outputPayload, null, 2)}\n`,
			"utf8",
		);
		console.error(`Wrote ${strategy} compacted messages to ${outputPath}`);
	}
}
