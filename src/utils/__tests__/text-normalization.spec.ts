import { normalizeString, unescapeHtmlEntities } from "../text-normalization"

describe("Text normalization utilities", () => {
	describe("normalizeString", () => {
		it("normalizes smart quotes by default", () => {
			expect(normalizeString("These are \u201Csmart quotes\u201D and \u2018single quotes\u2019")).toBe(
				"These are \"smart quotes\" and 'single quotes'",
			)
		})

		it("normalizes typographic characters by default", () => {
			expect(normalizeString("This has an em dash \u2014 and ellipsis\u2026")).toBe(
				"This has an em dash - and ellipsis...",
			)
		})

		it("normalizes whitespace by default", () => {
			expect(normalizeString("Multiple   spaces and\t\ttabs")).toBe("Multiple spaces and tabs")
		})

		it("can be configured to skip certain normalizations", () => {
			const input = "Keep \u201Csmart quotes\u201D but normalize   whitespace"
			expect(normalizeString(input, { smartQuotes: false })).toBe(
				"Keep \u201Csmart quotes\u201D but normalize whitespace",
			)
		})

		it("real-world example with mixed characters", () => {
			const input = "Let\u2019s test this\u2014with some \u201Cfancy\u201D punctuation\u2026 and   spaces"
			expect(normalizeString(input)).toBe('Let\'s test this-with some "fancy" punctuation... and spaces')
		})
	})

	describe("unescapeHtmlEntities", () => {
		it("unescapes basic HTML entities", () => {
			expect(unescapeHtmlEntities("&lt;div&gt;Hello&lt;/div&gt;")).toBe("<div>Hello</div>")
		})

		it("unescapes ampersand entity", () => {
			expect(unescapeHtmlEntities("This &amp; that")).toBe("This & that")
		})

		it("unescapes quote entities", () => {
			expect(unescapeHtmlEntities("&quot;quoted&quot; and &#39;single-quoted&#39;")).toBe(
				"\"quoted\" and 'single-quoted'",
			)
		})

		it("unescapes apostrophe entity", () => {
			expect(unescapeHtmlEntities("Don&apos;t worry")).toBe("Don't worry")
		})

		it("handles mixed content with multiple entity types", () => {
			expect(
				unescapeHtmlEntities(
					"&lt;a href=&quot;https://example.com?param1=value&amp;param2=value&quot;&gt;Link&lt;/a&gt;",
				),
			).toBe('<a href="https://example.com?param1=value&param2=value">Link</a>')
		})

		it("handles mixed content with apostrophe entities", () => {
			expect(
				unescapeHtmlEntities(
					"&lt;div&gt;Don&apos;t forget that Tom&amp;Jerry&apos;s show is at 3 o&apos;clock&lt;/div&gt;",
				),
			).toBe("<div>Don't forget that Tom&Jerry's show is at 3 o'clock</div>")
		})

		it("returns original string when no entities are present", () => {
			const original = "Plain text without entities"
			expect(unescapeHtmlEntities(original)).toBe(original)
		})

		it("handles empty or undefined input", () => {
			expect(unescapeHtmlEntities("")).toBe("")
			expect(unescapeHtmlEntities(undefined as unknown as string)).toBe(undefined)
		})

		it("unescapes square bracket entities (numeric)", () => {
			expect(unescapeHtmlEntities("string&#91;&#93;")).toBe("string[]")
			expect(unescapeHtmlEntities("array&#91;0&#93;")).toBe("array[0]")
			expect(unescapeHtmlEntities("matrix&#91;i&#93;&#91;j&#93;")).toBe("matrix[i][j]")
		})

		it("unescapes square bracket entities (named)", () => {
			expect(unescapeHtmlEntities("string&lsqb;&rsqb;")).toBe("string[]")
			expect(unescapeHtmlEntities("array&lsqb;0&rsqb;")).toBe("array[0]")
			expect(unescapeHtmlEntities("matrix&lsqb;i&rsqb;&lsqb;j&rsqb;")).toBe("matrix[i][j]")
		})

		it("handles C# array syntax with escaped square brackets", () => {
			// Test case based on the reported issue
			const input = "string&#91;&#93; myArray = new string&#91;5&#93;;\nmyArray&#91;2&#93; = &quot;hello&quot;;"
			const expected = 'string[] myArray = new string[5];\nmyArray[2] = "hello";'
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})

		it("handles mixed square bracket entities", () => {
			const input = "array&#91;0&rsqb; and &lsqb;1&#93;"
			const expected = "array[0] and [1]"
			expect(unescapeHtmlEntities(input)).toBe(expected)
		})
	})
})
