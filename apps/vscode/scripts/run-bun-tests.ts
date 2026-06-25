#!/usr/bin/env bun

import { spawn } from "node:child_process"
import path from "node:path"
/**
 * Runner for the SDK-adapter + model-catalog `bun test` suites (the same set
 * `vitest.config.ts` covers; `test:vitest` runs them under vitest).
 *
 * Why a script instead of a bare `bun test <globs>`:
 *
 *  1. Curated include set. These suites are an explicit list (see
 *     INCLUDE_PATTERNS, kept in sync with `vitest.config.ts` `test.include`),
 *     not the whole tree, so the node-side unit and @vscode/test-cli suites are
 *     not pulled in. `bun test`'s positional args don't expand `**` the way we
 *     need, so we resolve the globs ourselves with bun's `Glob`.
 *
 *  2. One process per file. `bun test` runs all files in a single process by
 *     default, so `mock.module(...)` registrations leak between files — suites
 *     mocking the same specifier with different shapes (e.g.
 *     `@/core/storage/StateManager`, `@cline/core`) clobber each other.
 *     `--parallel` runs each file in its own worker process, giving each a fresh
 *     module registry.
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
