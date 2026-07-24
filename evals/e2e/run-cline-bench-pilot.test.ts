import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	type ExecutionProvenance,
	assertReusableFingerprint,
	fingerprintExecution,
	hashDirectoryTree,
	type PilotConfig,
} from "./run-cline-bench-pilot"

const temporaryDirectories: string[] = []

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true })
	}
})

function taskTree() {
	const root = mkdtempSync(join(tmpdir(), "cline-bench-fingerprint-"))
	temporaryDirectories.push(root)
	mkdirSync(join(root, "tests"))
	writeFileSync(join(root, "task.toml"), "[agent]\ntimeout_sec = 900\n")
	writeFileSync(join(root, "instruction.md"), "Fix the production bug.\n")
	writeFileSync(join(root, "tests", "test.sh"), "#!/bin/bash\nexit 0\n", { mode: 0o755 })
	return root
}

function config(): PilotConfig {
	return {
		routerProfile: "cline-router",
		provider: "cline",
		globalBudgetUsd: 10,
		maxRunsPerModel: 1,
		timeoutSeconds: 900,
		clineVersion: "3.0.46",
		models: [{ id: "openai/gpt-5.4", perTaskBudgetUsd: 2, perModelBudgetUsd: 2 }],
		tasks: ["task-a"],
	}
}

function provenance(contentHash: string, commit = "a".repeat(40)): ExecutionProvenance {
	return {
		schemaVersion: 2,
		clineBenchCommit: commit,
		tasks: [{ id: "task-a", effectiveContentSha256: contentHash }],
	}
}

describe("Cline benchmark execution fingerprints", () => {
	test("hashes effective verifier content and executable mode", () => {
		const root = taskTree()
		const original = hashDirectoryTree(root)

		writeFileSync(join(root, "tests", "test.sh"), "#!/bin/bash\nexit 1\n", { mode: 0o755 })
		expect(hashDirectoryTree(root)).not.toBe(original)

		writeFileSync(join(root, "tests", "test.sh"), "#!/bin/bash\nexit 0\n", { mode: 0o755 })
		expect(hashDirectoryTree(root)).toBe(original)

		chmodSync(join(root, "tests", "test.sh"), 0o644)
		expect(hashDirectoryTree(root)).not.toBe(original)
	})

	test("changes when the exact submodule commit changes", () => {
		const contentHash = hashDirectoryTree(taskTree())
		const first = fingerprintExecution(config(), provenance(contentHash))
		const second = fingerprintExecution(config(), provenance(contentHash, "b".repeat(40)))

		expect(second).not.toBe(first)
	})

	test("changes when any effective task tree changes", () => {
		const root = taskTree()
		const firstHash = hashDirectoryTree(root)
		const first = fingerprintExecution(config(), provenance(firstHash))

		writeFileSync(join(root, "instruction.md"), "Fix the production bug and add a regression test.\n")
		const secondHash = hashDirectoryTree(root)
		const second = fingerprintExecution(config(), provenance(secondHash))

		expect(secondHash).not.toBe(firstHash)
		expect(second).not.toBe(first)
	})

	test("rejects legacy and mismatched reports instead of blessing stale results", () => {
		expect(() => assertReusableFingerprint({}, "current")).toThrow(
			"predates content-addressed task fingerprints",
		)
		expect(() =>
			assertReusableFingerprint({ executionFingerprint: "old" }, "current"),
		).toThrow("different execution matrix")
		expect(() =>
			assertReusableFingerprint({ executionFingerprint: "current" }, "current"),
		).not.toThrow()
	})
})
