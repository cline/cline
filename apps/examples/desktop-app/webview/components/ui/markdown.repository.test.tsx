import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoizedMarkdown } from "./markdown";

const linkBaseUrl =
	"https://github.com/example/skills/blob/main/example/SKILL.md";

describe("Repository Markdown", () => {
	it("resolves relative, parent, fragment and root links against the source document", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown
				content="[Guide](references/guide.md) [Parent](../README.md) [Section](#section) [Root](/example)"
				linkBaseUrl={linkBaseUrl}
			/>,
		);
		expect(html).toContain(
			'href="https://github.com/example/skills/blob/main/example/references/guide.md"',
		);
		expect(html).toContain(
			'href="https://github.com/example/skills/blob/main/README.md"',
		);
		expect(html).toContain(`href="${linkBaseUrl}#section"`);
		expect(html).toContain('href="https://github.com/example"');
	});
	it("preserves hardened unsafe URL handling and blocks repository images", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown
				content={
					"[Script](javascript:alert(1)) [File](file:///etc/passwd)\n\n![Relative](./image.png) ![Root](/image.png) ![Remote](https://example.com/image.png)\n\n<script>window.pwned = true</script>"
				}
				linkBaseUrl={linkBaseUrl}
			/>,
		);
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("file:///etc/passwd");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<img");
		expect(html.match(/data-streamdown="blocked-image"/g)).toHaveLength(3);
	});
});
