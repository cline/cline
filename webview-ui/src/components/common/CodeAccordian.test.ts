import { describe, expect, it } from "vitest"
import { cleanPathPrefix } from "./CodeAccordian"

describe("cleanPathPrefix", () => {
	it("removes leading non-letter, non-digit characters from Latin paths", () => {
		expect(cleanPathPrefix("/test.md")).toBe("test.md")
		expect(cleanPathPrefix("./src/index.ts")).toBe("src/index.ts")
	})

	it("preserves Korean (Hangul) characters", () => {
		expect(cleanPathPrefix("/한글_test.md")).toBe("한글_test.md")
	})

	it("preserves Japanese characters", () => {
		expect(cleanPathPrefix("/テスト.md")).toBe("テスト.md")
		expect(cleanPathPrefix("/日本語.md")).toBe("日本語.md")
	})

	it("preserves Chinese characters", () => {
		expect(cleanPathPrefix("/中文.md")).toBe("中文.md")
	})

	it("preserves Arabic characters", () => {
		expect(cleanPathPrefix("/ملف.md")).toBe("ملف.md")
	})

	it("preserves Thai characters", () => {
		expect(cleanPathPrefix("/ไฟล์.md")).toBe("ไฟล์.md")
	})

	it("handles mixed scripts with leading symbols", () => {
		expect(cleanPathPrefix("/._한글test.md")).toBe("한글test.md")
	})

	it("returns the string unchanged if it starts with a letter or digit", () => {
		expect(cleanPathPrefix("test.md")).toBe("test.md")
		expect(cleanPathPrefix("123.md")).toBe("123.md")
	})
})
