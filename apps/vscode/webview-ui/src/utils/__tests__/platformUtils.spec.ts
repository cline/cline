import { describe, expect, it } from "vitest"
import { detectMetaKeyChar } from "../platformUtils"

describe("detectMetaKeyChar", () => {
	it("should return ⌘ Command for darwin platform", () => {
		const result = detectMetaKeyChar("darwin")
		expect(result).toBe("CMD")
	})

	it("should return Ctrl for win32 platform", () => {
		const result = detectMetaKeyChar("win32")
		expect(result).toBe("Ctrl")
	})

	it("should return Ctrl for linux platform", () => {
		const result = detectMetaKeyChar("linux")
		expect(result).toBe("Ctrl")
	})

	it("should return Ctrl for unknown platform", () => {
		const result = detectMetaKeyChar("somethingelse")
		expect(result).toBe("Ctrl")
	})
})
