import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"
import { $ } from "bun"

/**
 * Integration test for CLINE-2584: the plugin sandbox bootstrap
 * (`plugin-sandbox-bootstrap.js`) must be shipped with the VS Code extension.
 *
 * The bootstrap runs in an isolated child process spawned by
 * `SubprocessSandbox` — it cannot be inlined into `extension.js` because the
 * sandbox spawns it via `node <bootstrapFile>`. The CLI build copies this
 * file (`apps/cli/bun.mts`); the extension build (`esbuild.mjs`) must do the
 * same.
 *
 * The bootstrap also has external runtime dependencies that must be resolvable
 * from its on-disk location via Node's standard module resolution:
 * - jiti (TypeScript transpilation of .ts plugins)
 * - @cline/shared, @cline/sdk (host-provided SDK packages that plugins import)
 *
 * This test runs the real `bun esbuild.mjs` build and checks the real
 * `dist/` output, exercising the same build pipeline CI uses.
 */

const projectRoot = join(import.meta.dir, "..", "..")
const distDir = join(projectRoot, "dist")
const bootstrapPath = join(distDir, "extensions", "plugin-sandbox-bootstrap.js")

describe("plugin-sandbox bootstrap build artifact (CLINE-2584)", () => {
	it("esbuild.mjs emits plugin-sandbox-bootstrap.js into dist/", async () => {
		const result = await $`bun esbuild.mjs`.cwd(projectRoot).quiet()
		expect(result.exitCode).toBe(0)

		expect(existsSync(join(distDir, "extension.js"))).toBe(true)
		expect(existsSync(bootstrapPath)).toBe(true)
	}, 60_000)

	it("the bootstrap is a real executable script with IPC handling", async () => {
		expect(existsSync(bootstrapPath)).toBe(true)

		const content = await readFile(bootstrapPath, "utf8")
		expect(content.length).toBeGreaterThan(1000)
		expect(content).toMatch(/process\.on\(.process\.message|process\.send|type:\s*["']response["']/)
	}, 60_000)

	it("the bootstrap's runtime dependencies resolve from dist/", () => {
		expect(existsSync(bootstrapPath)).toBe(true)

		// The bootstrap is spawned as a standalone Node child process. It
		// imports jiti (for TypeScript transpilation) and @cline/shared as
		// external modules, and plugins import @cline/sdk. Node resolves
		// these by walking up from the bootstrap's directory. All must be
		// direct dependencies of the extension so they appear in
		// node_modules and are resolvable.
		const requireFromBootstrap = createRequire(bootstrapPath)
		expect(() => requireFromBootstrap.resolve("jiti")).not.toThrow()
		expect(() => requireFromBootstrap.resolve("@cline/shared")).not.toThrow()
		// @cline/sdk is a host-provided SDK specifier that plugins import.
		// The bootstrap's findHostPackageRoot walks up from dist/extensions/
		// looking for node_modules/@cline/sdk/package.json.
		expect(
			existsSync(join(projectRoot, "node_modules", "@cline", "sdk", "package.json")),
		).toBe(true)
	}, 60_000)
})
