import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type RunUsage = {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	totalCost?: number;
	cost?: number;
};

type RunSummary = {
	sessionId: string;
	stdoutPath: string;
	stderrPath: string;
	messagesPath: string;
	usageFromCli: RunUsage;
	usageFromMessages?: RunUsage;
};

const LIVE_TEST_ENABLED = process.env.CLI_LIVE_TESTS === "1";

function parseNdjsonUsage(stdout: string): RunUsage {
	const lines = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	let usage: RunUsage = {};
	for (const line of lines) {
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			if (parsed.type === "run_result" && parsed.usage) {
				usage = parsed.usage as RunUsage;
			}
		} catch {
			// ignore non-json lines
		}
	}
	return usage;
}

function listSessionIds(sessionsDir: string): Set<string> {
	try {
		return new Set(
			readdirSync(sessionsDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name),
		);
	} catch {
		return new Set();
	}
}

function diffNewSessionIds(before: Set<string>, after: Set<string>): string[] {
	return [...after].filter((id) => !before.has(id));
}

function pickNewestSessionId(
	sessionsDir: string,
	candidates: string[],
): string {
	let newest = candidates[0];
	let newestMs = -1;
	for (const id of candidates) {
		const manifestPath = join(sessionsDir, id, `${id}.json`);
		try {
			const mtimeMs = statSync(manifestPath).mtimeMs;
			if (mtimeMs > newestMs) {
				newest = id;
				newestMs = mtimeMs;
			}
		} catch {
			// ignore unreadable candidate
		}
	}
	return newest;
}

function parseLatestAssistantUsage(messagesPath: string): RunUsage | undefined {
	try {
		const raw = JSON.parse(readFileSync(messagesPath, "utf8")) as {
			messages?: Array<{
				role?: string;
				metrics?: RunUsage;
			}>;
		};
		const messages = raw.messages ?? [];
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i];
			if (message?.role === "assistant" && message.metrics) {
				return message.metrics;
			}
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function buildLargePrompt(): string {
	const lines: string[] = [];
	for (let i = 0; i < 500; i++) {
		lines.push(
			`CACHE_REPRO_LINE_${String(i).padStart(4, "0")}: The quick brown fox jumps over the lazy dog.`,
		);
	}
	return `${lines.join("\n")}\n\nRespond with exactly: OK`;
}

function runCliOnce(options: {
	repoRoot: string;
	cliDir: string;
	cliEntry: string;
	env: NodeJS.ProcessEnv;
	prompt: string;
	runIndex: number;
	logDir: string;
}): RunSummary {
	const sessionsDir = join(options.env.CLINE_DATA_DIR ?? "", "sessions");
	const before = listSessionIds(sessionsDir);
	const args = [
		options.cliEntry,
		"--json",
		"--no-tools",
		"--no-spawn",
		"--no-teams",
		"--provider",
		"openrouter",
		"--model",
		"anthropic/claude-sonnet-4.6",
		"--key",
		options.env.OPENROUTER_API_KEY ?? "",
		options.prompt,
	];

	const result = spawnSync("bun", args, {
		cwd: options.repoRoot,
		env: options.env,
		encoding: "utf8",
		maxBuffer: 20 * 1024 * 1024,
	});

	const stdoutPath = join(
		options.logDir,
		`run-${options.runIndex}.stdout.ndjson`,
	);
	const stderrPath = join(options.logDir, `run-${options.runIndex}.stderr.log`);
	writeFileSync(stdoutPath, result.stdout ?? "", "utf8");
	writeFileSync(stderrPath, result.stderr ?? "", "utf8");

	expect(
		result.status,
		`CLI run ${options.runIndex} failed. stderr: ${stderrPath}`,
	).toBe(0);

	const after = listSessionIds(sessionsDir);
	const newIds = diffNewSessionIds(before, after);
	expect(
		newIds.length,
		`Run ${options.runIndex} did not create a new session in ${sessionsDir}`,
	).toBeGreaterThan(0);

	const sessionId =
		newIds.length === 1 ? newIds[0] : pickNewestSessionId(sessionsDir, newIds);
	const messagesPath = join(
		sessionsDir,
		sessionId,
		`${sessionId}.messages.json`,
	);
	const usageFromCli = parseNdjsonUsage(result.stdout ?? "");
	const usageFromMessages = parseLatestAssistantUsage(messagesPath);

	return {
		sessionId,
		stdoutPath,
		stderrPath,
		messagesPath,
		usageFromCli,
		usageFromMessages,
	};
}

function metric(usage: RunUsage | undefined, key: keyof RunUsage): number {
	const value = usage?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

describe("live cache repro (openrouter anthropic)", () => {
	it("demonstrates non-caching behavior and records persisted session history", async () => {
		if (!LIVE_TEST_ENABLED) {
			return;
		}

		const apiKey = process.env.OPENROUTER_API_KEY?.trim();
		expect(
			apiKey,
			"Set OPENROUTER_API_KEY to run live cache repro",
		).toBeTruthy();

		const fileDir = dirname(fileURLToPath(import.meta.url));
		const repoRoot = resolve(fileDir, "../../../../../");
		const cliDir = resolve(fileDir, "../../../");
		const cliEntry = join(cliDir, "dist", "index.js");
		expect(
			existsSync(cliEntry),
			`Built CLI not found at ${cliEntry}. Run "bun run build" first.`,
		).toBe(true);

		const tempRoot = mkdtempSync(join(tmpdir(), "clite-live-cache-repro-"));
		const dataDir = join(tempRoot, "data");
		const logDir = join(tempRoot, "logs");
		await mkdir(dataDir, { recursive: true });
		await mkdir(logDir, { recursive: true });

		const env: NodeJS.ProcessEnv = {
			...process.env,
			OPENROUTER_API_KEY: apiKey,
			CLINE_DATA_DIR: dataDir,
			CLINE_SESSION_BACKEND_MODE: "local",
			CLINE_RPC_ADDRESS: "",
		};

		const prompt = buildLargePrompt();
		const run1 = runCliOnce({
			repoRoot,
			cliDir,
			cliEntry,
			env,
			prompt,
			runIndex: 1,
			logDir,
		});
		const run2 = runCliOnce({
			repoRoot,
			cliDir,
			cliEntry,
			env,
			prompt,
			runIndex: 2,
			logDir,
		});

		expect(existsSync(run1.messagesPath)).toBe(true);
		expect(existsSync(run2.messagesPath)).toBe(true);

		const run1Read = metric(run1.usageFromCli, "cacheReadTokens");
		const run1Write = metric(run1.usageFromCli, "cacheWriteTokens");
		const run2Read = metric(run2.usageFromCli, "cacheReadTokens");
		const run2Write = metric(run2.usageFromCli, "cacheWriteTokens");

		console.log(
			JSON.stringify(
				{
					dataDir,
					logDir,
					run1,
					run2,
					observed: {
						run1Read,
						run1Write,
						run2Read,
						run2Write,
					},
				},
				null,
				2,
			),
		);

		// Expected correct behavior:
		// - First run should create cache entries.
		// - Second run (same large prompt) should read cached prompt tokens.
		expect(run1Write).toBeGreaterThan(0);
		expect(run2Read).toBeGreaterThan(0);
	}, 240_000);
});
