import { describe, it } from "mocha"
import "should"
import { fixModelHtmlEscaping, removeInvalidChars } from "./string"

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

describe("sanitizeStringForJSON", () => {
	const { sanitizeStringForJSON } = require("./string") // Use require for conditional import if needed or ensure build step

	it("should replace multiplication sign × with x", () => {
		sanitizeStringForJSON("Error: 2 × 3").should.equal("Error: 2 x 3")
	})

	it("should remove Unicode replacement character �", () => {
		sanitizeStringForJSON("Hello\uFFFDWorld").should.equal("HelloWorld")
	})

	it("should remove multiple Unicode replacement characters", () => {
		sanitizeStringForJSON("H\uFFFDe\uFFFDl\uFFFDlo").should.equal("Hello")
	})

	it("should handle strings that are already clean", () => {
		sanitizeStringForJSON("This is a clean string.").should.equal("This is a clean string.")
	})

	it("should return non-string input as is", () => {
		const obj = { a: 1 }
		sanitizeStringForJSON(obj).should.equal(obj)
		sanitizeStringForJSON(null).should.be.null()
		sanitizeStringForJSON(undefined).should.be.undefined()
		sanitizeStringForJSON(123).should.equal(123)
	})

	it("should attempt to filter invalid UTF-8 sequences (basic test)", () => {
		// This is a simple test. Real invalid sequences are harder to inject directly in JS strings.
		// Buffer conversion often helps clean up some malformed sequences.
		const invalidSequenceAttempt = "test" + String.fromCharCode(0xD800) + "sequence" // High surrogate without low
		// The behavior of Buffer.from().toString() with isolated surrogates can be platform/Node version dependent.
		// It might replace them with � (which then gets removed) or handle them differently.
		// The goal is it doesn't crash and produces a string.
		const result = sanitizeStringForJSON(invalidSequenceAttempt)
		result.should.not.containEql(String.fromCharCode(0xD800)) // Expect the invalid part to be changed/removed
	})

	it("should handle empty string", () => {
		sanitizeStringForJSON("").should.equal("")
	})

	it("should handle mixed problematic characters", () => {
		sanitizeStringForJSON("Error × \uFFFD fixed").should.equal("Error x  fixed")
	})
})
