import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import * as LlmsProviders from "./providers";

type ProviderConfig = import("./providers").ProviderConfig;
type ProviderSettings = import("./providers").ProviderSettings;

interface StoredProviderSettingsEntryLike {
	settings?: unknown;
}

interface StoredProviderSettingsLike {
	providers?: Record<string, unknown>;
}

interface ProviderTarget {
	label: string;
	config: ProviderConfig;
}

const LIVE_TEST_ENABLED = process.env.LLMS_LIVE_TESTS === "1";
const PROVIDERS_FILE_ENV = "LLMS_LIVE_PROVIDERS_PATH";
const PROVIDER_TIMEOUT_MS = Number(
	process.env.LLMS_LIVE_PROVIDER_TIMEOUT_MS ?? "90000",
);

function requireProvidersFilePath(): string {
	const filePath = process.env[PROVIDERS_FILE_ENV];
	if (!filePath) {
		throw new Error(
			`Set ${PROVIDERS_FILE_ENV} to a LlmsProviders.json file path before running live provider tests.`,
		);
	}
	return path.resolve(filePath);
}

function toTargetsFromStoredFormat(
	json: StoredProviderSettingsLike,
): ProviderTarget[] {
	const entries = Object.entries(json.providers ?? {});
	return entries.map(([entryKey, entryValue]) => {
		const maybeEntry = entryValue as StoredProviderSettingsEntryLike;
		const rawSettings = maybeEntry.settings ?? entryValue;
		const parsed = LlmsProviders.ProviderSettingsSchema.parse(
			rawSettings,
		) as ProviderSettings;
		return {
			label: `${entryKey} (${parsed.provider})`,
			config: LlmsProviders.toProviderConfig(parsed),
		};
	});
}

function loadProviderTargets(filePath: string): ProviderTarget[] {
	const raw = readFileSync(filePath, "utf8");
	const parsed = JSON.parse(raw) as unknown;

	if (Array.isArray(parsed)) {
		return parsed.map((entry, index) => {
			const settings = LlmsProviders.ProviderSettingsSchema.parse(
				entry,
			) as ProviderSettings;
			return {
				label: `index:${index} (${settings.provider})`,
				config: LlmsProviders.toProviderConfig(settings),
			};
		});
	}

	const maybeStored = parsed as StoredProviderSettingsLike;
	return toTargetsFromStoredFormat(maybeStored);
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> {
	let timeout: NodeJS.Timeout | undefined;
	const timeoutPromise = new Promise<T>((_, reject) => {
		timeout = setTimeout(() => {
			reject(new Error(`Timed out after ${timeoutMs}ms: ${label}`));
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
	}
}

async function runPrompt(target: ProviderTarget): Promise<void> {
	const handler = await LlmsProviders.createHandlerAsync(target.config);
	const stream = handler.createMessage("You are a concise assistant.", [
		{ role: "user", content: "Reply with the single word OK." },
	]);

	for await (const chunk of stream) {
		if (chunk.type === "done" && !chunk.success) {
			throw new Error(chunk.error ?? "done chunk reported success=false");
		}
	}
}

describe("live provider smoke test", () => {
	it("reads configured providers from json and reports providers with failed responses", async () => {
		if (!LIVE_TEST_ENABLED) {
			return null;
		}
		const filePath = requireProvidersFilePath();
		const targets = loadProviderTargets(filePath);

		if (!targets.length) {
			throw new Error(`No providers found in ${filePath}.`);
		}

		const failures: string[] = [];

		for (const target of targets) {
			try {
				await withTimeout(runPrompt(target), PROVIDER_TIMEOUT_MS, target.label);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				failures.push(`${target.label}: ${message}`);
			}
		}

		if (failures.length > 0) {
			throw new Error(
				`Providers with error responses (${failures.length}):\n${failures.join("\n")}`,
			);
		}
	}, 300_000);
});
