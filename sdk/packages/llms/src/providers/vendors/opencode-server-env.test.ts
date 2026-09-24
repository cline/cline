import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regression coverage for the patched `@opencode-ai/sdk` (see
 * `patches/@opencode-ai%2Fsdk@1.18.23.patch`).
 *
 * The unpatched SDK always injected `OPENCODE_CONFIG_CONTENT` (serialized as
 * "{}" when no config was supplied) into the spawned `opencode serve`
 * environment. On Windows that env var makes the server print "listening" and
 * hold the port while refusing every HTTP connection, or exit with code 58
 * (cline/cline#14394) — while the same bare `opencode serve` works. Cline's
 * OpenCode provider never passes a server config, so the variable must be
 * omitted unless a caller explicitly provides one.
 *
 * The tests run the real `createOpencodeServer` against a stub `opencode`
 * executable planted on PATH that records its environment and prints the
 * "listening" line the SDK waits for.
 */

const isWindows = process.platform === "win32";

let stubDir: string;
let envDumpPath: string;

beforeAll(() => {
	stubDir = mkdtempSync(join(tmpdir(), "cline-opencode-stub-"));
	envDumpPath = join(stubDir, "env.json");
	const stubPath = join(stubDir, "opencode");
	writeFileSync(
		stubPath,
		[
			"#!/usr/bin/env node",
			`require("node:fs").writeFileSync(${JSON.stringify(envDumpPath)}, JSON.stringify(process.env));`,
			'console.log("opencode server listening on http://127.0.0.1:4096");',
			"setTimeout(() => {}, 30000);",
		].join("\n"),
	);
	chmodSync(stubPath, 0o755);
});

afterAll(() => {
	rmSync(stubDir, { recursive: true, force: true });
});

async function importOpencodeServerModule(): Promise<{
	createOpencodeServer: (options: {
		hostname: string;
		port: number;
		timeout: number;
		config?: Record<string, unknown>;
	}) => Promise<{ url: string; close(): void }>;
}> {
	// `@opencode-ai/sdk` is a transitive dependency (of
	// ai-sdk-provider-opencode-sdk) whose exports carry only an `import`
	// condition, so it cannot be require.resolve'd from here. Walk the
	// node_modules chain the provider itself would use and import the patched
	// server module directly.
	const require = createRequire(import.meta.url);
	const providerEntry = require.resolve("ai-sdk-provider-opencode-sdk");
	let dir = dirname(providerEntry);
	for (;;) {
		const candidate = join(dir, "node_modules", "@opencode-ai", "sdk");
		if (existsSync(join(candidate, "package.json"))) {
			return await import(
				pathToFileURL(join(candidate, "dist", "v2", "server.js")).href
			);
		}
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error(
				"could not locate @opencode-ai/sdk from ai-sdk-provider-opencode-sdk",
			);
		}
		dir = parent;
	}
}

async function launchAndCaptureEnv(options: {
	config?: Record<string, unknown>;
}): Promise<Record<string, string | undefined>> {
	const { createOpencodeServer } = await importOpencodeServerModule();
	rmSync(envDumpPath, { force: true });
	const previousPath = process.env.PATH;
	process.env.PATH = `${stubDir}:${previousPath ?? ""}`;
	let server: Awaited<ReturnType<typeof createOpencodeServer>> | undefined;
	try {
		server = await createOpencodeServer({
			hostname: "127.0.0.1",
			port: 4096,
			timeout: 10_000,
			...(options.config !== undefined ? { config: options.config } : {}),
		});
		return JSON.parse(readFileSync(envDumpPath, "utf8"));
	} finally {
		server?.close();
		process.env.PATH = previousPath;
	}
}

describe.skipIf(isWindows)("createOpencodeServer environment", () => {
	it("omits OPENCODE_CONFIG_CONTENT when no config is supplied", async () => {
		const env = await launchAndCaptureEnv({});
		expect(env.OPENCODE_CONFIG_CONTENT).toBeUndefined();
	}, 20_000);

	it("serializes an explicitly supplied config", async () => {
		const env = await launchAndCaptureEnv({
			config: { model: "opencode/some-model" },
		});
		expect(env.OPENCODE_CONFIG_CONTENT).toBe(
			JSON.stringify({ model: "opencode/some-model" }),
		);
	}, 20_000);
});
