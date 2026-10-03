import { describe, expect, it } from "vitest";
import { htmlToText } from "./web-fetch";

describe("htmlToText", () => {
	it("keeps the block structure it converts to newlines", () => {
		// `\s` matches a newline, so collapsing whitespace with it undid the
		// newlines the block-element step had just inserted and the page arrived
		// as one unbroken line.
		const text = htmlToText(
			`<h1>Title</h1><p>First paragraph.</p><p>Second paragraph.</p><ul><li>Item one</li><li>Item two</li></ul>`,
		);

		expect(text).toBe(
			"Title\nFirst paragraph.\nSecond paragraph.\nItem one\nItem two",
		);
	});

	it("keeps the blank line a source newline between blocks produces", () => {
		const text = htmlToText(
			`<h1>Title</h1>\n<p>First paragraph.</p>\n<p>Second paragraph.</p>`,
		);

		expect(text).toBe("Title\n\nFirst paragraph.\n\nSecond paragraph.");
	});

	it("collapses runs of spaces and tabs within a line", () => {
		expect(htmlToText("<p>a   \t  b</p>")).toBe("a b");
	});

	it("leaves no more than one blank line between blocks", () => {
		expect(htmlToText("<p>a</p><div></div><div></div><p>b</p>")).toBe("a\n\nb");
	});

	it("drops script and style contents", () => {
		const text = htmlToText(
			`<style>body{color:red}</style><script>var a = 1</script><p>Body</p>`,
		);

		expect(text).toBe("Body");
	});

	it("decodes decimal and hexadecimal character references", () => {
		expect(htmlToText("<p>It&#8217;s &amp; it&#x2019;s</p>")).toBe(
			"It’s & it’s",
		);
	});

	it("decodes a reference above U+FFFF without truncating it", () => {
		expect(htmlToText("<p>&#128512;</p>")).toBe("😀");
	});

	it("decodes the named references it supports", () => {
		expect(htmlToText("<p>a&nbsp;b &lt;tag&gt; &quot;q&quot;</p>")).toBe(
			'a b <tag> "q"',
		);
	});
});
