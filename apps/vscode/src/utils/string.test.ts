import { describe, it } from "mocha"
import "should"
import { fixModelHtmlEscaping, removeInvalidChars, truncateMiddle } from "./string"

describe("fixModelHtmlEscaping", () => {
	it("should convert &gt; to >", () => {
		fixModelHtmlEscaping("foo &gt; bar").should.equal("foo > bar")
	})

	it("should convert &lt; to <", () => {
		fixModelHtmlEscaping("foo &lt; bar").should.equal("foo < bar")
	})

	it('should convert &quot; to "', () => {
		fixModelHtmlEscaping("foo &quot;bar&quot;").should.equal('foo "bar"')
	})

	it("should convert &amp; to &", () => {
		fixModelHtmlEscaping("foo &amp; bar").should.equal("foo & bar")
	})

	it("should convert &apos; to '", () => {
		fixModelHtmlEscaping("foo &apos;bar&apos;").should.equal("foo 'bar'")
	})

	it("should handle multiple entities in the same string", () => {
		fixModelHtmlEscaping("&lt;div&gt;Hello &quot;World&quot; &amp; &apos;Universe&apos;&lt;/div&gt;").should.equal(
			"<div>Hello \"World\" & 'Universe'</div>",
		)
	})

	it("should return unchanged string when no HTML entities are present", () => {
		fixModelHtmlEscaping("normal string").should.equal("normal string")
	})
})

describe("removeInvalidChars", () => {
	it("should remove replacement characters", () => {
		removeInvalidChars("hello\uFFFDworld").should.equal("helloworld")
	})

	it("should remove � characters", () => {
		removeInvalidChars("hello�world").should.equal("helloworld")
	})

	it("should remove multiple replacement characters", () => {
		removeInvalidChars("h\uFFFDe\uFFFDl\uFFFDl\uFFFDo").should.equal("hello")
	})

	it("should remove multiple � characters", () => {
		removeInvalidChars("h�e�l�lo").should.equal("hello")
	})

	it("should return unchanged string when no replacement characters are present", () => {
		removeInvalidChars("normal string").should.equal("normal string")
	})
})

describe("truncateMiddle", () => {
	it("should return unchanged string when it is under the limit", () => {
		truncateMiddle("short", 10, (removed) => `[omitted ${removed}]`).should.equal("short")
	})

	it("should preserve the start and end with a generated marker", () => {
		const result = truncateMiddle(
			`${"a".repeat(50)}${"b".repeat(50)}`,
			40,
			(removed) => `[omitted ${removed}]`,
		)

		result.length.should.equal(40)
		result.should.startWith("a".repeat(14))
		result.should.containEql("[omitted 72]")
		result.should.endWith("b".repeat(14))
	})
})
