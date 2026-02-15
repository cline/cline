import { describe, expect, it } from "vitest"
import { isBunGlobalInstallPath, normalizeScriptPath } from "./bun-install"

describe("bun-install", () => {
	describe("normalizeScriptPath", () => {
		it("returns empty string for empty input", () => {
			expect(normalizeScriptPath("")).toBe("")
		})

		it("resolves and normalizes path separators", () => {
			const resolved = normalizeScriptPath("C:\\Users\\pcstyle\\.bun\\bin\\cline", (path) => path)
			expect(resolved).toBe("C:/Users/pcstyle/.bun/bin/cline")
		})

		it("falls back to raw path normalization when resolver throws", () => {
			const resolved = normalizeScriptPath("/Users/pcstyle/.bun/bin/cline", () => {
				throw new Error("resolve failed")
			})
			expect(resolved).toBe("/Users/pcstyle/.bun/bin/cline")
		})
	})

	describe("isBunGlobalInstallPath", () => {
		it("detects direct Bun bin invocation paths", () => {
			expect(isBunGlobalInstallPath("/Users/pcstyle/.bun/bin/cline", (path) => path)).toBe(true)
		})

		it("detects resolved Bun global node_modules paths", () => {
			expect(
				isBunGlobalInstallPath("/Users/pcstyle/.bun/bin/cline", () => {
					return "/Users/pcstyle/.bun/install/global/node_modules/cline/dist/cli.mjs"
				}),
			).toBe(true)
		})

		it("returns false for non-Bun paths", () => {
			expect(isBunGlobalInstallPath("/usr/local/lib/node_modules/cline/dist/cli.mjs", (path) => path)).toBe(false)
		})
	})
})
