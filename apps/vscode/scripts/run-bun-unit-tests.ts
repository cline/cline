#!/usr/bin/env bun

import path from "node:path"
/**
 * Runner for the node-side `bun test` unit suites.
 *
 * A test file belongs to this runner iff it imports from "bun:test" (files that
 * need the real VS Code extension host import from "mocha" and run under
 * @vscode/test-cli instead). We glob all `*.test.ts` and keep only the
 * bun:test ones; the SDK/model-catalog suites listed in IGNORED run through
 * `run-bun-tests.ts`, so they're skipped here to avoid double-running.
 *
 * Why one process per file: `bun test --parallel <allFiles>` reuses a pool of
 * worker processes, and `mock.module(...)` registrations accumulate across files
 * sharing a worker. Suites that mock the same specifier with different shapes
 * (e.g. `@core/storage/disk`, `@cline/core`, `fs/promises`, `os`) then clobber
 * each other and fail only at scale. Spawning one `bun test` process per file
 * (bounded by a small concurrency pool, via `Bun.spawn`) gives each file a fresh
 * module registry.
 *
 * Usage:
 *   bun scripts/run-bun-unit-tests.ts            # run the suite, isolated
 *   bun scripts/run-bun-unit-tests.ts --list     # print the resolved file list
 *   bun scripts/run-bun-unit-tests.ts --all      # include ELECTRON_HOST_ONLY
 *   bun scripts/run-bun-unit-tests.ts -c 6       # concurrency (default 4)
 */
import { Glob } from "bun"

const projectRoot = path.resolve(import.meta.dir, "..")

// A file runs under `bun test` iff it imports "bun:test"; mocha-owned files are
// skipped by the import filter in resolveFiles().
const INCLUDE_PATTERNS = ["src/**/*.test.ts"]
const BUN_TEST_IMPORT = /from\s+["']bun:test["']/

// SDK + model-catalog suites run through `run-bun-tests.ts`; skip them here so
// they aren't run twice.
const IGNORED = new Set<string>([
	"src/core/controller/models/__tests__/providerCatalogHandlers.test.ts",
	"src/core/controller/models/__tests__/providerCatalogSmoke.test.ts",
	"src/core/controller/models/__tests__/providerSwitchNormalization.test.ts",
	"src/core/controller/models/__tests__/resolveModelInfo.test.ts",
	"src/core/controller/models/__tests__/refreshClineRecommendedModels.test.ts",
])

// Files that require the real VSCode Electron host (@vscode/test-cli). Excluded
// by default; they continue to run under @vscode/test-cli.
const ELECTRON_HOST_ONLY = new Set<string>([])

async function resolveFiles(includeHostOnly: boolean): Promise<string[]> {
	const seen = new Set<string>()
	for (const pattern of INCLUDE_PATTERNS) {
		const glob = new Glob(pattern)
		for await (const match of glob.scan({ cwd: projectRoot, onlyFiles: true })) {
			const normalized = match.split(path.sep).join("/")
			if (IGNORED.has(normalized)) {
				continue
			}
			if (!includeHostOnly && ELECTRON_HOST_ONLY.has(normalized)) {
				continue
			}
			// Only bun-runner-owned files (those importing "bun:test"). Files still on
			// the @vscode/test-cli Electron host import from "mocha" and are skipped.
			const source = await Bun.file(path.join(projectRoot, normalized)).text()
			if (!BUN_TEST_IMPORT.test(source)) {
				continue
			}
			seen.add(normalized)
		}
	}
	return [...seen].sort()
}

type FileResult = {
	file: string
	code: number
	pass: number
	fail: number
	output: string
}

// `bun test` prints its summary as e.g. " 12 pass\n  0 fail".
function parseCounts(output: string): { pass: number; fail: number } {
	let pass = 0
	let fail = 0
	for (const m of output.matchAll(/^\s*(\d+)\s+pass\b/gm)) {
		pass += Number(m[1])
	}
	for (const m of output.matchAll(/^\s*(\d+)\s+fail\b/gm)) {
		fail += Number(m[1])
	}
	return { pass, fail }
}

const PER_FILE_TIMEOUT_MS = 120_000

async function runOne(file: string): Promise<FileResult> {
	const proc = Bun.spawn(["bun", "test", file], {
		cwd: projectRoot,
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, FORCE_COLOR: "0" },
	})
	// Guard against a single hung file stalling the whole pool: kill it after a
	// generous per-file budget and surface it as a failure.
	let timedOut = false
	const timer = setTimeout(() => {
		timedOut = true
		proc.kill()
	}, PER_FILE_TIMEOUT_MS)
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	])
	clearTimeout(timer)
	const output = stdout + stderr + (timedOut ? `\n[runner] TIMEOUT after ${PER_FILE_TIMEOUT_MS}ms — killed\n` : "")
	const { pass, fail } = parseCounts(output)
	// A nonzero exit with no parsed counts (load/parse error, timeout) must count
	// as a failure so the gate cannot pass silently.
	const effectiveFail = timedOut && fail === 0 ? Math.max(fail, 1) : fail
	return { file, code, pass, fail: effectiveFail, output }
}

async function runPool(files: string[], concurrency: number): Promise<FileResult[]> {
	const results: FileResult[] = []
	let next = 0
	const launch = async (): Promise<void> => {
		while (next < files.length) {
			const file = files[next++]
			const result = await runOne(file)
			results.push(result)
			const failed = result.fail > 0 || result.code !== 0
			const status = failed ? "FAIL" : "ok"
			const counts = `${result.pass} pass / ${result.fail} fail`
			process.stdout.write(`[${results.length}/${files.length}] ${status.padEnd(4)} ${counts.padEnd(20)} ${file}\n`)
			if (failed) {
				process.stdout.write(result.output.trimEnd() + "\n")
			}
		}
	}
	const workers: Promise<void>[] = []
	for (let i = 0; i < Math.min(concurrency, files.length); i++) {
		workers.push(launch())
	}
	await Promise.all(workers)
	return results
}

function parseConcurrency(argv: string[]): number {
	const flagIdx = argv.findIndex((a) => a === "-c" || a === "--concurrency")
	if (flagIdx !== -1 && argv[flagIdx + 1]) {
		const n = Number(argv[flagIdx + 1])
		if (Number.isFinite(n) && n > 0) {
			return Math.floor(n)
		}
	}
	return 4
}

async function main(): Promise<void> {
	const passthrough = process.argv.slice(2)
	const includeHostOnly = passthrough.includes("--all")
	const files = await resolveFiles(includeHostOnly)
	if (files.length === 0) {
		console.error("run-bun-unit-tests: no test files matched")
		process.exit(1)
	}

	if (passthrough.includes("--list")) {
		console.log(files.join("\n"))
		return
	}

	const concurrency = parseConcurrency(passthrough)
	const started = Date.now()
	console.log(`Running ${files.length} unit test files, isolated (concurrency ${concurrency})…\n`)

	const results = await runPool(files, concurrency)

	const totalPass = results.reduce((sum, r) => sum + r.pass, 0)
	const totalFail = results.reduce((sum, r) => sum + r.fail, 0)
	const failedFiles = results.filter((r) => r.fail > 0 || r.code !== 0).sort((a, b) => a.file.localeCompare(b.file))
	const elapsed = ((Date.now() - started) / 1000).toFixed(1)

	console.log("\n──────────────────────────────────────────────")
	console.log(`Files: ${results.length}   Pass: ${totalPass}   Fail: ${totalFail}   Time: ${elapsed}s`)
	if (failedFiles.length > 0) {
		console.log(`\nFailing files (${failedFiles.length}):`)
		for (const r of failedFiles) {
			console.log(`  ${r.file}  (${r.pass} pass / ${r.fail} fail, exit ${r.code})`)
		}
		process.exit(1)
	}
	console.log("All unit test files passed.")
}

void main()
