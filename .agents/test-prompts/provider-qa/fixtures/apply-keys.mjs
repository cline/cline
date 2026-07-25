#!/usr/bin/env node
/**
 * Materializes a QA key file into a Cline data directory.
 *
 * Reads the flat `/tmp/qa-keys.json` shape used by the provider QA runs and
 * writes `<dir>/settings/providers.json`, which is the single source of truth
 * both the CLI and the VS Code extension read.
 *
 *   node apply-keys.mjs --keys /tmp/qa-keys.json --list
 *   node apply-keys.mjs --keys /tmp/qa-keys.json --dir /tmp/cline-qa/x/data --select anthropic
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
	const out = { keys: "/tmp/qa-keys.json", dir: undefined, select: undefined, list: false, json: false };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--keys") out.keys = argv[++i];
		else if (arg === "--dir") out.dir = argv[++i];
		else if (arg === "--select") out.select = argv[++i];
		else if (arg === "--list") out.list = true;
		else if (arg === "--json") out.json = true;
		else {
			process.stderr.write(`unknown argument: ${arg}\n`);
			process.exit(2);
		}
	}
	return out;
}

const OPTS = parseArgs(process.argv.slice(2));

/**
 * How each provider's credentials are considered complete, and how the flat QA
 * entry maps onto the `ProviderSettings` schema.
 */
const REQUIREMENTS = {
	ollama: ["baseUrl"],
	bedrock: ["awsAccessKey", "awsSecretKey"],
	vertex: ["vertexProjectId"],
	"openai-compatible": ["apiKey", "baseUrl"],
	litellm: ["apiKey", "baseUrl"],
};

function requiredFields(providerId) {
	return REQUIREMENTS[providerId] ?? ["apiKey"];
}

function nonEmpty(value) {
	return typeof value === "string" && value.trim().length > 0;
}

function classify(providerId, entry) {
	const required = requiredFields(providerId);
	const missing = required.filter((field) => !nonEmpty(entry?.[field]));
	if (missing.length > 0) {
		return { state: "notProvided", missing };
	}
	if (!nonEmpty(entry?.model)) {
		return { state: "needsModel", missing: ["model"] };
	}
	return { state: "configured", missing: [] };
}

function toSettings(providerId, entry) {
	const settings = { provider: providerId };
	if (nonEmpty(entry.apiKey)) settings.apiKey = entry.apiKey.trim();
	if (nonEmpty(entry.model)) settings.model = entry.model.trim();
	if (nonEmpty(entry.baseUrl)) settings.baseUrl = entry.baseUrl.trim();
	if (nonEmpty(entry.protocol)) settings.protocol = entry.protocol.trim();
	if (nonEmpty(entry.client)) settings.client = entry.client.trim();

	const aws = {};
	if (nonEmpty(entry.awsAccessKey)) aws.accessKey = entry.awsAccessKey.trim();
	if (nonEmpty(entry.awsSecretKey)) aws.secretKey = entry.awsSecretKey.trim();
	if (nonEmpty(entry.awsSessionToken)) aws.sessionToken = entry.awsSessionToken.trim();
	if (nonEmpty(entry.awsRegion)) aws.region = entry.awsRegion.trim();
	if (Object.keys(aws).length > 0) settings.aws = aws;

	const gcp = {};
	if (nonEmpty(entry.vertexProjectId)) gcp.projectId = entry.vertexProjectId.trim();
	if (nonEmpty(entry.vertexRegion)) gcp.region = entry.vertexRegion.trim();
	if (Object.keys(gcp).length > 0) settings.gcp = gcp;

	return settings;
}

let keys;
try {
	keys = JSON.parse(readFileSync(OPTS.keys, "utf8"));
} catch (error) {
	process.stderr.write(`cannot read keys file ${OPTS.keys}: ${error.message}\n`);
	process.exit(1);
}

const classified = Object.entries(keys).map(([providerId, entry]) => ({
	providerId,
	entry: entry ?? {},
	...classify(providerId, entry ?? {}),
}));

if (OPTS.list) {
	const grouped = { configured: [], needsModel: [], notProvided: [] };
	for (const row of classified) grouped[row.state].push(row);
	if (OPTS.json) {
		process.stdout.write(
			`${JSON.stringify(
				{
					configured: grouped.configured.map((r) => ({ provider: r.providerId, model: r.entry.model })),
					needsModel: grouped.needsModel.map((r) => r.providerId),
					notProvided: grouped.notProvided.map((r) => ({ provider: r.providerId, missing: r.missing })),
				},
				null,
				2,
			)}\n`,
		);
	} else {
		process.stdout.write(`keys file: ${OPTS.keys}\n\n`);
		process.stdout.write("configured (credential + model present):\n");
		for (const row of grouped.configured) {
			process.stdout.write(`  ${row.providerId.padEnd(20)} model=${row.entry.model}\n`);
		}
		process.stdout.write("\nneeds a model id (credential present, model blank):\n");
		for (const row of grouped.needsModel) process.stdout.write(`  ${row.providerId}\n`);
		process.stdout.write("\nno credential supplied:\n");
		for (const row of grouped.notProvided) {
			process.stdout.write(`  ${row.providerId.padEnd(20)} missing=${row.missing.join(",")}\n`);
		}
	}
	if (!OPTS.dir) process.exit(0);
}

if (!OPTS.dir) {
	process.stderr.write("--dir is required unless --list is used alone\n");
	process.exit(2);
}

const writable = classified.filter((row) => row.state === "configured");
if (OPTS.select) {
	const selected = writable.find((row) => row.providerId === OPTS.select);
	if (!selected) {
		const reason = classified.find((row) => row.providerId === OPTS.select);
		process.stderr.write(
			`cannot select ${OPTS.select}: ${
				reason ? `${reason.state} (missing ${reason.missing.join(",") || "nothing"})` : "not present in keys file"
			}\n`,
		);
		process.exit(1);
	}
}

const providers = {};
const updatedAt = new Date().toISOString();
for (const row of writable) {
	providers[row.providerId] = {
		settings: toSettings(row.providerId, row.entry),
		updatedAt,
		tokenSource: "manual",
	};
}

const settingsDir = join(OPTS.dir, "settings");
mkdirSync(settingsDir, { recursive: true });
const target = join(settingsDir, "providers.json");
const payload = { version: 1, providers };
if (OPTS.select) payload.lastUsedProvider = OPTS.select;
writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);

process.stdout.write(
	`wrote ${target}\n  providers: ${Object.keys(providers).join(", ") || "(none)"}\n` +
		`  lastUsedProvider: ${payload.lastUsedProvider ?? "(unset)"}\n`,
);
