/**
 * Owner-only provider credential files: 0700 directory, 0600 files,
 * loose modes refused, contents never echoed.
 */

import { chmodSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ensureGatewayDataDir, resolveGatewayPaths } from "./paths";
import { readSecretFile, SecretAccessError, writeSecretFile } from "./secrets";
import { tempDataRoot } from "./test-support";

function makePaths() {
	const paths = resolveGatewayPaths({
		dataRoot: tempDataRoot(),
		namespace: "default",
	});
	return paths;
}

describe("secret files", () => {
	it("round-trips a secret with owner-only permissions", () => {
		const paths = makePaths();
		const file = writeSecretFile(paths, "anthropic", "sk-test-abc123");
		expect(readSecretFile(paths, "anthropic")).toBe("sk-test-abc123");
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(statSync(paths.secretsDir).mode & 0o777).toBe(0o700);
	});

	it("ensureGatewayDataDir pre-creates the owner-only secrets directory", () => {
		const paths = makePaths();
		ensureGatewayDataDir(paths);
		expect(statSync(paths.secretsDir).mode & 0o777).toBe(0o700);
	});

	it("a missing secret reads as undefined (caller decides how to fail)", () => {
		const paths = makePaths();
		expect(readSecretFile(paths, "openai")).toBeUndefined();
	});

	it("refuses to read a secret readable by anyone but the owner", () => {
		const paths = makePaths();
		const file = writeSecretFile(paths, "openrouter", "sk-or-loose");
		chmodSync(file, 0o644);
		expect(() => readSecretFile(paths, "openrouter")).toThrow(
			SecretAccessError,
		);
	});

	it("overwriting a loose file tightens it back to 0600", () => {
		const paths = makePaths();
		const file = writeSecretFile(paths, "cline", "first");
		chmodSync(file, 0o644);
		writeSecretFile(paths, "cline", "second");
		expect(statSync(file).mode & 0o777).toBe(0o600);
		expect(readSecretFile(paths, "cline")).toBe("second");
	});

	it("rejects traversal-shaped or malformed secret names", () => {
		const paths = makePaths();
		for (const name of ["../evil", "a/b", "", ".hidden"]) {
			expect(() => paths.secretFile(name)).toThrow();
		}
		expect(() => paths.secretFile("anthropic")).not.toThrow();
		expect(() => paths.secretFile("my-provider.v2")).not.toThrow();
	});
});
