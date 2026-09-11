import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSdkRuntimeBuildId } from "../../../scripts/runtime-build-id";

describe("SDK runtime build identity", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const directory of tempDirs.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	function createRuntimeFixture(): string {
		const root = mkdtempSync(join(tmpdir(), "cline-runtime-build-id-"));
		tempDirs.push(root);
		writeFileSync(join(root, "bun.lock"), "lockfile-v1\n");
		for (const packageName of ["shared", "llms", "agents", "core"]) {
			const packageRoot = join(root, "sdk", "packages", packageName);
			mkdirSync(join(packageRoot, "src"), { recursive: true });
			writeFileSync(
				join(packageRoot, "package.json"),
				`${JSON.stringify({ name: `@cline/${packageName}`, version: "0.0.1" })}\n`,
			);
			writeFileSync(
				join(packageRoot, "src", "index.ts"),
				`export const packageName = ${JSON.stringify(packageName)};\n`,
			);
		}
		return root;
	}

	it("is deterministic and changes with runtime source", () => {
		const root = createRuntimeFixture();
		const first = resolveSdkRuntimeBuildId(root);

		expect(resolveSdkRuntimeBuildId(root)).toBe(first);
		writeFileSync(
			join(root, "sdk", "packages", "core", "src", "index.ts"),
			"export const packageName = 'changed-core';\n",
		);
		expect(resolveSdkRuntimeBuildId(root)).not.toBe(first);
	});

	it("ignores test-only source changes", () => {
		const root = createRuntimeFixture();
		const first = resolveSdkRuntimeBuildId(root);
		writeFileSync(
			join(root, "sdk", "packages", "core", "src", "index.test.ts"),
			"throw new Error('test only');\n",
		);

		expect(resolveSdkRuntimeBuildId(root)).toBe(first);
	});
});
