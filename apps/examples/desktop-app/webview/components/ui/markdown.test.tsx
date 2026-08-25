import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { createDesktopMarkdownPlugins, MemoizedMarkdown } from "./markdown";

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

	test("recognizes Mermaid fences as lazy diagrams instead of plain code", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown
				content={"```mermaid\nflowchart LR\n  A[Text] --> B[SVG]\n```"}
			/>,
		);

		// Streamdown defers diagram rendering to the browser and emits its diagram
		// loading shell during SSR. A normal fence would use data-streamdown=code-block.
		expect(html).toContain("animate-spin");
		expect(html).not.toContain('data-streamdown="code-block"');
		expect(html).not.toContain("flowchart LR");
	});

	test("keeps the Desktop Mermaid renderer lazy and host-owned", async () => {
		const renderer = {
			initialize: vi.fn(),
			render: vi.fn(async () => ({ svg: '<svg data-testid="diagram" />' })),
		};
		const loader = vi.fn(async () => ({ default: renderer }));
		const plugins = createDesktopMarkdownPlugins(loader);

		expect(loader).not.toHaveBeenCalled();
		const instance = plugins.mermaid.getMermaid();
		await expect(
			instance.render("desktop-diagram", "flowchart LR\nA --> B"),
		).resolves.toEqual({
			svg: '<svg data-testid="diagram" />',
		});
		expect(loader).toHaveBeenCalledOnce();
		expect(renderer.initialize).toHaveBeenCalledWith(
			expect.objectContaining({ securityLevel: "strict" }),
		);
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

	test("repairs an incomplete streaming Mermaid fence into a diagram shell", () => {
		const streaming = renderToStaticMarkup(
			<MemoizedMarkdown
				content={"```mermaid\nflowchart LR\n  A[Streaming] -->"}
				streaming
			/>,
		);
		const completed = renderToStaticMarkup(
			<MemoizedMarkdown
				content={
					"```mermaid\nflowchart LR\n  A[Streaming] --> B[Complete]\n```"
				}
			/>,
		);

		expect(streaming).toContain("animate-spin");
		expect(streaming).not.toContain('data-streamdown="code-block"');
		expect(completed).toContain("animate-spin");
		expect(completed).not.toContain('data-streamdown="code-block"');
	});

	test("renders honest external links with their real destination", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown content="[Review](https://example.com/review)" />,
		);

		expect(html).toContain('data-streamdown="link"');
		expect(html).toContain("Review");
		expect(html).toContain('href="https://example.com/review"');
		expect(html).not.toContain('aria-haspopup="dialog"');
	});

	test("keeps external links whose URL text matches the destination direct", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown content="[example.com/review](https://www.example.com/review)" />,
		);

		expect(html).toContain('href="https://www.example.com/review"');
		expect(html).not.toContain('aria-haspopup="dialog"');
	});

	test("routes deceptive URL-text links through confirmation controls", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown content="[github.com/cline](https://evil.example/payload)" />,
		);

		expect(html).toContain('data-streamdown="link"');
		expect(html).toContain('href="#confirm-external-link"');
		expect(html).toContain('aria-haspopup="dialog"');
		expect(html).not.toContain('href="https://evil.example/payload"');
	});

	test("treats fully qualified trailing-dot hostnames like their plain form", () => {
		const deceptiveHtml = renderToStaticMarkup(
			<MemoizedMarkdown content="[github.com.](https://evil.example/payload)" />,
		);
		expect(deceptiveHtml).toContain('href="#confirm-external-link"');
		expect(deceptiveHtml).not.toContain('href="https://evil.example/payload"');

		const honestHtml = renderToStaticMarkup(
			<MemoizedMarkdown content="[github.com.](https://github.com/cline)" />,
		);
		expect(honestHtml).toContain('href="https://github.com/cline"');
		expect(honestHtml).not.toContain('aria-haspopup="dialog"');
	});

	test("treats protocol-relative labels like their https form", () => {
		const deceptiveHtml = renderToStaticMarkup(
			<MemoizedMarkdown content="[//github.com](https://evil.example/payload)" />,
		);
		expect(deceptiveHtml).toContain('href="#confirm-external-link"');
		expect(deceptiveHtml).not.toContain('href="https://evil.example/payload"');

		const honestHtml = renderToStaticMarkup(
			<MemoizedMarkdown content="[//github.com](https://github.com/cline)" />,
		);
		expect(honestHtml).toContain('href="https://github.com/cline"');
		expect(honestHtml).not.toContain('aria-haspopup="dialog"');
	});

	test("sees through inline formatting inside deceptive URL text", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown content="[**github.com**/cline](https://evil.example/payload)" />,
		);

		expect(html).toContain('href="#confirm-external-link"');
		expect(html).not.toContain('href="https://evil.example/payload"');
	});

	test("treats scheme and port mismatches as deceptive", () => {
		const schemeHtml = renderToStaticMarkup(
			<MemoizedMarkdown content="[https://example.com](http://example.com/login)" />,
		);
		expect(schemeHtml).toContain('href="#confirm-external-link"');
		expect(schemeHtml).not.toContain('href="http://example.com/login"');

		const portHtml = renderToStaticMarkup(
			<MemoizedMarkdown content="[example.com](https://example.com:8080/admin)" />,
		);
		expect(portHtml).toContain('href="#confirm-external-link"');
		expect(portHtml).not.toContain('href="https://example.com:8080/admin"');
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
