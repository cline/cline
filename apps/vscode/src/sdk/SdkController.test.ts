import { describe, expect, it } from "vitest"
import { isClineProvider } from "@/shared/utils/cline"
import { resolveWorkspaceRootPath } from "./workspace-root"

describe("isClineProvider", () => {
	it("treats both Cline account providers as Cline providers", () => {
		expect(isClineProvider("cline")).toBe(true)
		expect(isClineProvider("cline-pass")).toBe(true)
		expect(isClineProvider("anthropic")).toBe(false)
		expect(isClineProvider(undefined)).toBe(false)
	})
})

describe("resolveWorkspaceRootPath", () => {
	it("uses the first non-empty workspace path when available", () => {
		expect(resolveWorkspaceRootPath(["", "/workspace"], "/Users/tester/Desktop")).toBe("/workspace")
	})

	it("falls back to Desktop when no workspace folder is open", () => {
		expect(resolveWorkspaceRootPath([], "/Users/tester/Desktop")).toBe("/Users/tester/Desktop")
	})
})
