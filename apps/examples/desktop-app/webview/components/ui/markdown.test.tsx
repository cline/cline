import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MemoizedMarkdown } from "./markdown";

describe("MemoizedMarkdown", () => {
	test("renders structured GFM content and blocks remote images", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown
				content={`# Review

| Surface | Status |
| --- | --- |
| Code | Ready |

\`\`\`typescript
const ready = true;
\`\`\`

![remote image](https://example.com/tracker.png)`}
			/>,
		);

		expect(html).toContain('data-streamdown="heading-1"');
		expect(html).toContain('data-streamdown="table-wrapper"');
		expect(html).toContain('data-streamdown="code-block"');
		expect(html).toContain('data-streamdown="blocked-image"');
		expect(html).toContain("External image blocked for privacy");
		expect(html).not.toContain("<img");
	});

	test("renders app-local images", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown
				content={`![local](/images/local.png)

![second local](/images/second-local.png)`}
			/>,
		);

		expect(html.match(/<img/g)).toHaveLength(2);
		expect(html).toContain('src="/images/local.png"');
		expect(html).toContain('src="/images/second-local.png"');
		expect(html).not.toContain('data-streamdown="blocked-image"');
	});

	test("repairs an unfinished code fence while streaming", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown
				content={"```typescript\nconst stillStreaming = true;"}
				streaming
			/>,
		);

		expect(html).toContain('data-streamdown="code-block"');
		expect(html).toContain("stillStreaming");
	});

	test("routes external links through confirmation controls", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown content="[Review](https://example.com/review)" />,
		);

		expect(html).toContain('data-streamdown="link"');
		expect(html).toContain("Review");
		expect(html).toContain('href="#confirm-external-link"');
		expect(html).toContain('aria-haspopup="dialog"');
		expect(html).not.toContain('href="https://example.com/review"');
	});

	test("leaves app-local and fragment links navigable", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown content="[Details](#details) [Home](/)" />,
		);

		expect(html).toContain('href="#details"');
		expect(html).toContain('href="/"');
		expect(html).not.toContain('aria-haspopup="dialog"');
	});

	test("blocks scheme-less hostnames before they reach link rendering", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown content="[Review](example.com/path)" />,
		);

		expect(html).toContain("Review");
		expect(html).toContain("blocked");
		expect(html).not.toContain("<a");
		expect(html).not.toContain('data-streamdown="link"');
	});

	test("does not expose unsafe script URLs or raw scripts", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown
				content={
					'[unsafe](javascript:alert("no"))\n\n![embedded](data:image/png;base64,iVBORw0KGgo=)\n\n![file](file:///etc/passwd)\n\n<script>window.pwned = true</script>'
				}
			/>,
		);

		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("data:image");
		expect(html).not.toContain("file:///etc/passwd");
		expect(html).not.toContain("<script");
	});
});
