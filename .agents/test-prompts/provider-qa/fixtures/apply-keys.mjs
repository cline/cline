#!/usr/bin/env node
/**
 * Turns a filled-in `keys.json` into a ready-to-use Cline data directory, so a
 * test run can start from a configured provider instead of a human pasting
 * credentials into a form.
 *
 * Writes `<dataDir>/settings/providers.json`, which is where both the
 * credentials and the active-provider pointer (`lastUsedProvider`) live.
 *
 * Usage:
 *   node apply-keys.mjs --keys keys.json --dir /tmp/cline-qa/data --select anthropic
 *   node apply-keys.mjs --keys keys.json --dir /tmp/cline-qa/data --only anthropic,openrouter
 *   node apply-keys.mjs --keys keys.json --list
 *   node apply-keys.mjs --keys keys.json --print-env
 *
 * Prompts that test setup-from-scratch should NOT use this — clicking through
 * the form is the thing under test there. Use it for the prompts where being
 * configured is a precondition rather than the subject.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Env var each provider's credential is conventionally read from, for --print-env. */
const ENV_BY_PROVIDER = {
	anthropic: "ANTHROPIC_API_KEY",
	"openai-native": "OPENAI_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	gemini: "GEMINI_API_KEY",
	cline: "CLINE_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	groq: "GROQ_API_KEY",
	xai: "XAI_API_KEY",
	mistral: "MISTRAL_API_KEY",
	together: "TOGETHER_API_KEY",
	fireworks: "FIREWORKS_API_KEY",
	requesty: "REQUESTY_API_KEY",
	cerebras: "CEREBRAS_API_KEY",
	baseten: "BASETEN_API_KEY",
	"vercel-ai-gateway": "AI_GATEWAY_API_KEY",
	huggingface: "HF_TOKEN",
	moonshot: "MOONSHOT_API_KEY",
	zai: "ZAI_API_KEY",
	qwen: "DASHSCOPE_API_KEY",
};

/** Credential-bearing fields; an entry with none of them filled is treated as unconfigured. */
const CREDENTIAL_FIELDS = [
	"apiKey",
	"awsAccessKey",
	"awsSecretKey",
	"vertexProjectId",
	"baseUrl",
];

function parseArgs(argv) {
	const args = {
		keys: "keys.json",
		dir: null,
		select: null,
		only: null,
		list: false,
		printEnv: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--list") args.list = true;
		else if (arg === "--print-env") args.printEnv = true;
		else if (arg === "--keys") args.keys = argv[++i];
		else if (arg === "--dir") args.dir = argv[++i];
		else if (arg === "--select") args.select = argv[++i];
		else if (arg === "--only")
			args.only = argv[++i].split(",").map((s) => s.trim());
		else if (arg === "--help" || arg === "-h") args.list = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return args;
}

function isConfigured(entry) {
	return CREDENTIAL_FIELDS.some(
		(field) => typeof entry[field] === "string" && entry[field].trim() !== "",
	);
}

/**
 * The keys JSON uses flat UI-flavoured names for Bedrock and Vertex, but
 * `ProviderSettingsSchema` nests them under `aws`/`gcp` and silently strips
 * unknown top-level keys — copied verbatim they would vanish on read.
 */
const NESTED_FIELDS = {
	awsAccessKey: ["aws", "accessKey"],
	awsSecretKey: ["aws", "secretKey"],
	awsRegion: ["aws", "region"],
	vertexProjectId: ["gcp", "projectId"],
	vertexRegion: ["gcp", "region"],
};

function toProviderSettings(providerId, entry) {
	const settings = { provider: providerId };
	for (const [key, value] of Object.entries(entry)) {
		if (typeof value === "string" && value.trim() === "") continue;
		if (value === null || value === undefined) continue;
		const nested = NESTED_FIELDS[key];
		if (nested) {
			const [group, field] = nested;
			settings[group] = { ...settings[group], [field]: value };
		} else {
			settings[key] = value;
		}
	}
	return settings;
}

function main() {
	const args = parseArgs(process.argv.slice(2));

	if (!existsSync(args.keys)) {
		throw new Error(
			`Keys file not found: ${args.keys}. Copy keys.template.json and fill it in.`,
		);
	}
	const raw = JSON.parse(readFileSync(args.keys, "utf8"));
	const entries = Object.entries(raw).filter(
		([id, value]) => !id.startsWith("_") && value && typeof value === "object",
	);

	const configured = entries.filter(([, entry]) => isConfigured(entry));
	const skipped = entries.filter(([, entry]) => !isConfigured(entry));

	if (args.list) {
		console.log(`Configured (${configured.length}):`);
		for (const [id, entry] of configured) {
			console.log(
				`  ${id.padEnd(20)} model=${entry.model || "(provider default)"}`,
			);
		}
		console.log(`\nSkipped, no credential (${skipped.length}):`);
		console.log(`  ${skipped.map(([id]) => id).join(", ") || "(none)"}`);
		return;
	}

	if (args.printEnv) {
		for (const [id, entry] of configured) {
			const envName = ENV_BY_PROVIDER[id];
			if (envName && entry.apiKey) {
				// POSIX single-quoted strings cannot contain a literal ', so
				// close the quote, emit an escaped one, and reopen: ' -> '\''
				const quoted = `'${entry.apiKey.replace(/'/g, "'\\''")}'`;
				console.log(`export ${envName}=${quoted}`);
			}
		}
		return;
	}

	if (!args.dir) {
		throw new Error(
			"--dir is required (the data dir you will pass as CLINE_DATA_DIR)",
		);
	}

	const selected = args.only
		? configured.filter(([id]) => args.only.includes(id))
		: configured;

	if (selected.length === 0) {
		throw new Error(
			"No configured providers to apply. Fill in at least one credential in the keys file.",
		);
	}
	if (args.select && !selected.some(([id]) => id === args.select)) {
		throw new Error(
			`--select ${args.select} is not among the configured providers: ${selected
				.map(([id]) => id)
				.join(", ")}`,
		);
	}

	// The active provider must sort last by updatedAt as well as being named in
	// lastUsedProvider, because some callers fall back to recency.
	const base = Date.now() - selected.length * 1000;
	const providers = {};
	selected.forEach(([id, entry], index) => {
		const isSelected = id === args.select;
		providers[id] = {
			settings: toProviderSettings(id, entry),
			updatedAt: new Date(
				isSelected ? Date.now() : base + index * 1000,
			).toISOString(),
			tokenSource: "manual",
		};
	});

	const state = {
		version: 1,
		...(args.select ? { lastUsedProvider: args.select } : {}),
		providers,
	};

	const settingsDir = join(args.dir, "settings");
	mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
	const filePath = join(settingsDir, "providers.json");
	writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, {
		mode: 0o600,
	});

	console.log(`Wrote ${filePath}`);
	console.log(`  configured: ${selected.map(([id]) => id).join(", ")}`);
	console.log(`  selected  : ${args.select ?? "(none — pick one in the UI)"}`);
	if (skipped.length > 0) {
		console.log(
			`  no credential, skipped: ${skipped.map(([id]) => id).join(", ")}`,
		);
	}
	console.log(`\nLaunch with: CLINE_DATA_DIR=${args.dir}`);
}

main();
