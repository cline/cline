#!/usr/bin/env bun

import { spawn } from "node:child_process"
import path from "node:path"
/**
 * Bun-test runner for the vitest-native unit suites (SDK adapter + model
 * catalog). This is the `bun test` counterpart of `test:vitest`.
 *
 * Why a script instead of a bare `bun test <globs>`:
 *
 *  1. Curated include set. `vitest.config.ts` runs a specific list of globs +
 *     explicit files — NOT the whole tree. We mirror that exact list here (see
 *     INCLUDE_PATTERNS) so the bun run covers the same files vitest does, no
 *     more (don't pull in mocha/@vscode/test-cli suites) and no less.
 *     `bun test`'s positional args do not expand `**` globs the way we need, so
 *     we resolve them ourselves with bun's `Glob`.
 *
 *  2. Per-file isolation (the parity-critical bit). vitest's default `forks`
 *     pool runs each test file in its own process, so module mocks
 *     (`vi.mock(...)` / `mock.module(...)`) are file-local. `bun test` runs all
 *     files in ONE process by default, so several suites that mock the same
 *     specifier with different shapes (e.g. `@/core/storage/StateManager`,
 *     `@cline/core`) clobber each other and produce false failures. `--parallel`
 *     runs each file in a separate worker process, restoring vitest's isolation
 *     and full pass parity (582/582 at time of writing).
 *
 * Usage:
 *   bun scripts/run-bun-tests.ts            # run the curated set, isolated
 *   bun scripts/run-bun-tests.ts --list     # print the resolved file list only
 */
import { Glob } from "bun"

// Mirror of vitest.config.ts `test.include`. Keep these in sync.
const INCLUDE_PATTERNS = [
	"src/sdk/**/*.test.ts",
	"src/shared/vsCodeSelectorUtils.test.ts",
	"src/core/storage/remote-config/**/*.test.ts",
	"src/shared/model-catalog/provider-helpers.test.ts",
	"src/core/controller/models/__tests__/providerCatalogHandlers.test.ts",
	"src/core/controller/models/__tests__/providerSwitchNormalization.test.ts",
	"src/core/controller/models/__tests__/resolveModelInfo.test.ts",
	"src/core/controller/models/__tests__/providerCatalogSmoke.test.ts",
	"src/core/controller/models/__tests__/refreshClineRecommendedModels.test.ts",
]

const projectRoot = path.resolve(import.meta.dir, "..")

async function resolveFiles(): Promise<string[]> {
	const seen = new Set<string>()
	for (const pattern of INCLUDE_PATTERNS) {
		const glob = new Glob(pattern)
		for await (const match of glob.scan({ cwd: projectRoot, onlyFiles: true })) {
			seen.add(match)
		}
	}
	return [...seen].sort()
}

async function main(): Promise<void> {
	const files = await resolveFiles()
	if (files.length === 0) {
		console.error("run-bun-tests: no test files matched the include patterns")
		process.exit(1)
	}

	const passthrough = process.argv.slice(2)
	if (passthrough.includes("--list")) {
		console.log(files.join("\n"))
		return
	}

	const args = ["test", "--parallel", ...passthrough.filter((arg) => arg !== "--list"), ...files]
	const child = spawn("bun", args, { cwd: projectRoot, stdio: "inherit" })
	child.on("exit", (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal)
			return
		}
		process.exit(code ?? 1)
	})
}

void main()
