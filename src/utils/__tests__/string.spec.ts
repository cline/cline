import { describe, it, expect } from "vitest"
import { fixModelHtmlEscaping, removeInvalidChars } from "../string"

describe("fixModelHtmlEscaping", () => {
	it("should convert &gt; to >", () => {
		expect(fixModelHtmlEscaping("foo &gt; bar")).toBe("foo > bar")
	})

	it("should convert &lt; to <", () => {
		expect(fixModelHtmlEscaping("foo &lt; bar")).toBe("foo < bar")
	})

	it('should convert &quot; to "', () => {
		expect(fixModelHtmlEscaping("foo &quot;bar&quot;")).toBe('foo "bar"')
	})

	it("should convert &amp; to &", () => {
		expect(fixModelHtmlEscaping("foo &amp; bar")).toBe("foo & bar")
	})

	it("should convert &apos; to '", () => {
		expect(fixModelHtmlEscaping("foo &apos;bar&apos;")).toBe("foo 'bar'")
	})

	it("should handle multiple entities in the same string", () => {
		expect(fixModelHtmlEscaping("&lt;div&gt;Hello &quot;World&quot; &amp; &apos;Universe&apos;&lt;/div&gt;")).toBe(
			"<div>Hello \"World\" & 'Universe'</div>",
		)
	})

	it("should return unchanged string when no HTML entities are present", () => {
		expect(fixModelHtmlEscaping("normal string")).toBe("normal string")
	})
})

describe("removeInvalidChars", () => {
	it("should remove replacement characters", () => {
		expect(removeInvalidChars("hello\uFFFDworld")).toBe("helloworld")
	})

	it("should remove � characters", () => {
		expect(removeInvalidChars("hello�world")).toBe("helloworld")
	})

	it("should remove multiple replacement characters", () => {
		expect(removeInvalidChars("h\uFFFDe\uFFFDl\uFFFDl\uFFFDo")).toBe("hello")
	})

	it("should remove multiple � characters", () => {
		expect(removeInvalidChars("h�e�l�lo")).toBe("hello")
	})

	it("should return unchanged string when no replacement characters are present", () => {
		expect(removeInvalidChars("normal string")).toBe("normal string")
	})
})
