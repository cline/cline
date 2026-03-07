import { describe, expect, it, vi } from "vitest"

vi.mock("@/utils/platformUtils", () => ({
	getCurrentPlatform: vi.fn(),
}))

import { getCurrentPlatform } from "@/utils/platformUtils"
import { getPlanActShortcut } from "../MarkdownBlock"

const mockedGetCurrentPlatform = vi.mocked(getCurrentPlatform)

describe("getPlanActShortcut", () => {
	it("should return Mac shortcut on macOS", () => {
		mockedGetCurrentPlatform.mockReturnValue("mac")
		expect(getPlanActShortcut()).toBe("⌘⇧A")
	})

	it("should return Windows shortcut on Windows", () => {
		mockedGetCurrentPlatform.mockReturnValue("windows")
		expect(getPlanActShortcut()).toBe("Win+Shift+A")
	})

	it("should return Linux shortcut on Linux", () => {
		mockedGetCurrentPlatform.mockReturnValue("linux")
		expect(getPlanActShortcut()).toBe("Alt+Shift+A")
	})
})
