#!/usr/bin/env node
/**
 * Seeds a Cline data directory with *pre-migration* provider config, i.e. the
 * legacy `globalState.json` + `secrets.json` pair that shipped before provider
 * credentials moved into `settings/providers.json`.
 *
 * The migration itself is owned by
 * `sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts`
 * and runs on `ProviderSettingsManager` construction, so seeding a directory and
 * then pointing a host at it via `CLINE_DATA_DIR` is enough to exercise the real
 * upgrade path.
 *
 * Usage:
 *   node seed-legacy-config.mjs --shape anthropic --dir /tmp/cline-qa/data
 *   node seed-legacy-config.mjs --list
 *
 * Real API keys are never required: pass --key to substitute a live key into the
 * shape when you want the migrated config to also be able to send a request.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PLACEHOLDER = "sk-legacy-placeholder-do-not-use";

/**
 * Each shape is a `{ globalState, secrets }` pair written verbatim to disk.
 * Field names intentionally match `LegacyGlobalState` / `LegacySecrets` in
 * provider-settings-legacy-migration.ts — if those interfaces change, these
 * shapes must change with them.
 */
const SHAPES = {
	anthropic: {
		description: "Single provider, generic apiModelId, plan and act identical",
		globalState: {
			mode: "act",
			planModeApiProvider: "anthropic",
			actModeApiProvider: "anthropic",
			planModeApiModelId: "claude-sonnet-4-5-20250929",
			actModeApiModelId: "claude-sonnet-4-5-20250929",
			planModeThinkingBudgetTokens: 8192,
			actModeThinkingBudgetTokens: 8192,
		},
		secrets: { apiKey: PLACEHOLDER },
		keyField: ["secrets", "apiKey"],
	},

	openrouter: {
		description:
			"Provider-specific model id field (planModeOpenRouterModelId) rather than apiModelId",
		globalState: {
			mode: "act",
			planModeApiProvider: "openrouter",
			actModeApiProvider: "openrouter",
			planModeOpenRouterModelId: "anthropic/claude-sonnet-4.5",
			actModeOpenRouterModelId: "anthropic/claude-sonnet-4.5",
		},
		secrets: { openRouterApiKey: PLACEHOLDER },
		keyField: ["secrets", "openRouterApiKey"],
	},

	"openai-compatible": {
		description:
			"Legacy `openai` provider id (maps to openai-compatible) with base URL and custom headers",
		globalState: {
			mode: "act",
			planModeApiProvider: "openai",
			actModeApiProvider: "openai",
			planModeOpenAiModelId: "gpt-4.1-mini",
			actModeOpenAiModelId: "gpt-4.1-mini",
			openAiBaseUrl: "https://legacy.example.invalid/v1",
			openAiHeaders: { "X-Legacy-Header": "migrated", "X-Tenant": "qa" },
			requestTimeoutMs: 45_000,
		},
		secrets: { openAiApiKey: PLACEHOLDER },
		keyField: ["secrets", "openAiApiKey"],
	},

	"split-plan-act": {
		description:
			"Different provider AND model per mode — must survive as two distinct selections",
		globalState: {
			mode: "plan",
			planModeApiProvider: "anthropic",
			planModeApiModelId: "claude-opus-4-1-20250805", // gitleaks:allow — model id, not a credential
			actModeApiProvider: "openrouter",
			actModeOpenRouterModelId: "z-ai/glm-4.6",
		},
		secrets: { apiKey: PLACEHOLDER, openRouterApiKey: PLACEHOLDER },
		keyField: ["secrets", "apiKey"],
	},

	bedrock: {
		description:
			"Non-API-key credentials (AWS) plus region and prompt-cache flags",
		globalState: {
			mode: "act",
			planModeApiProvider: "bedrock",
			actModeApiProvider: "bedrock",
			planModeApiModelId: "anthropic.claude-sonnet-4-20250514-v1:0",
			actModeApiModelId: "anthropic.claude-sonnet-4-20250514-v1:0",
			awsRegion: "us-west-2",
			awsAuthentication: "credentials",
			awsUseCrossRegionInference: true,
			awsBedrockUsePromptCache: true,
		},
		secrets: {
			awsAccessKey: "AKIALEGACYPLACEHOLDER",
			awsSecretKey: PLACEHOLDER,
			awsSessionToken: "legacy-session-token",
		},
		keyField: ["secrets", "awsSecretKey"],
	},

	ollama: {
		description:
			"Local provider with a custom base URL and no credential at all",
		globalState: {
			mode: "act",
			planModeApiProvider: "ollama",
			actModeApiProvider: "ollama",
			planModeOllamaModelId: "qwen3:8b",
			actModeOllamaModelId: "qwen3:8b",
			ollamaBaseUrl: "http://127.0.0.1:11434",
		},
		secrets: {},
		keyField: null,
	},

	"many-keys": {
		description:
			"Selected provider is one of many stored credentials — the rest must migrate without becoming selected",
		globalState: {
			mode: "act",
			planModeApiProvider: "gemini",
			actModeApiProvider: "gemini",
			planModeApiModelId: "gemini-2.5-pro",
			actModeApiModelId: "gemini-2.5-pro",
			anthropicBaseUrl: "https://api.anthropic.com",
			qwenApiLine: "international",
			zaiApiLine: "china",
		},
		secrets: {
			apiKey: PLACEHOLDER,
			geminiApiKey: PLACEHOLDER,
			openRouterApiKey: PLACEHOLDER,
			deepSeekApiKey: PLACEHOLDER,
			groqApiKey: PLACEHOLDER,
			mistralApiKey: PLACEHOLDER,
			xaiApiKey: PLACEHOLDER,
			qwenApiKey: PLACEHOLDER,
			zaiApiKey: PLACEHOLDER,
		},
		keyField: ["secrets", "geminiApiKey"],
	},
};

function parseArgs(argv) {
	const args = {
		shape: "anthropic",
		dir: null,
		key: null,
		list: false,
		force: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--list") args.list = true;
		else if (arg === "--force") args.force = true;
		else if (arg === "--shape") args.shape = argv[++i];
		else if (arg === "--dir") args.dir = argv[++i];
		else if (arg === "--key") args.key = argv[++i];
		else if (arg === "--help" || arg === "-h") args.list = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return args;
}

function main() {
	const args = parseArgs(process.argv.slice(2));

	if (args.list) {
		console.log("Available shapes:\n");
		for (const [name, shape] of Object.entries(SHAPES)) {
			console.log(`  ${name.padEnd(18)} ${shape.description}`);
		}
		console.log(
			"\nUsage: node seed-legacy-config.mjs --shape <name> --dir <dataDir> [--key <apiKey>] [--force]",
		);
		console.log("Then launch a host with CLINE_DATA_DIR=<dataDir>.");
		return;
	}

	const shape = SHAPES[args.shape];
	if (!shape) {
		throw new Error(
			`Unknown shape "${args.shape}". Run with --list to see the available shapes.`,
		);
	}
	if (!args.dir) {
		throw new Error(
			"--dir is required (point it at the data dir you will pass as CLINE_DATA_DIR)",
		);
	}

	const globalState = structuredClone(shape.globalState);
	const secrets = structuredClone(shape.secrets);
	if (args.key && shape.keyField) {
		const [bucket, field] = shape.keyField;
		(bucket === "secrets" ? secrets : globalState)[field] = args.key;
	}

	if (args.force) {
		rmSync(args.dir, { recursive: true, force: true });
	}
	mkdirSync(join(args.dir, "settings"), { recursive: true });

	const globalStatePath = join(args.dir, "globalState.json");
	const secretsPath = join(args.dir, "secrets.json");
	mkdirSync(dirname(globalStatePath), { recursive: true });
	writeFileSync(globalStatePath, `${JSON.stringify(globalState, null, 2)}\n`);
	writeFileSync(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`);

	console.log(`Seeded legacy shape "${args.shape}" into ${args.dir}`);
	console.log(`  ${globalStatePath}`);
	console.log(`  ${secretsPath}`);
	console.log(
		`  settings/providers.json intentionally absent — migration must create it`,
	);
	console.log(`\nLaunch with: CLINE_DATA_DIR=${args.dir}`);
}

main();
