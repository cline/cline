import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import {
	createDesktopMarkdownPlugins,
	MemoizedMarkdown,
	ThirdPartyMarkdown,
} from "./markdown";

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

	test("shows a repository-relative link as its text, without a blocked marker", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown content="See [Delta](delta.md) for details." />,
		);
		expect(html).toContain("Delta");
		expect(html).not.toContain("[blocked]");
		expect(html).not.toContain('href="delta.md"');
		const thirdParty = renderToStaticMarkup(
			<ThirdPartyMarkdown>
				<MemoizedMarkdown content="See [Delta](delta.md) for details." />
			</ThirdPartyMarkdown>,
		);
		expect(thirdParty).toContain("[blocked]");
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

	test("loads nothing without a click from HTML a message carries", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown
				content={[
					'<picture><source srcset="https://attacker.example/p.png"><img src="/x.png"></picture>',
					'<video src="https://attacker.example/v" poster="https://attacker.example/i"><track src="https://attacker.example/t"></video>',
					'<audio src="https://attacker.example/a"></audio>',
					'<iframe src="https://attacker.example/f"></iframe>',
					'<object data="https://attacker.example/o"></object><embed src="https://attacker.example/e">',
					'<link rel="stylesheet" href="https://attacker.example/l.css">',
					"<style>body{background:url(https://attacker.example/s)}</style>",
					'<div style="background:url(https://attacker.example/d)" background="https://attacker.example/b">x</div>',
					'<svg><image href="https://attacker.example/g"/><use href="https://attacker.example/u#a"/></svg>',
					'<img srcset="https://attacker.example/i2 2x" src="https://attacker.example/i1">',
				].join("\n\n")}
			/>,
		);

		// The style sheet's text is left as text; no attribute points anywhere.
		expect(html).not.toMatch(/="[^"]*attacker\.example/);
		expect(html).not.toMatch(/srcset|<(?:style|link|source|video|svg)\b/i);
	});

	test("loads no image at all in a third party's Markdown", () => {
		const html = renderToStaticMarkup(
			<ThirdPartyMarkdown>
				<MemoizedMarkdown
					content={
						"![local](/images/local.png) ![remote](https://example.com/r.png)\n\n```mermaid\nflowchart LR\n  A --> B\n```"
					}
				/>
			</ThirdPartyMarkdown>,
		);

		expect(html).not.toContain("<img");
		expect(html).toContain("Image not shown: local");
		expect(html).toMatch(
			/<a [^>]*href="https:\/\/example\.com\/r\.png"[^>]*>remote<\/a>/,
		);
		expect(html).not.toContain('data-streamdown="mermaid-block"');
	});

	test("recognizes Mermaid fences as the owned diagram block instead of plain code", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown
				content={"```mermaid\nflowchart LR\n  A[Text] --> B[SVG]\n```"}
			/>,
		);

		// Diagrams render in the browser, so SSR emits the owned block's shell:
		// a filename header (derived here from the diagram) and a skeleton, never
		// Streamdown's literal "mermaid" label or a plain code-block.
		expect(html).toContain('data-streamdown="mermaid-block"');
		expect(html).toContain("flowchart-text-svg.mmd");
		expect(html).toContain("cline-mermaid__skeleton");
		expect(html).not.toContain('data-streamdown="code-block"');
		expect(html).not.toContain("flowchart LR");
	});

	test("names the diagram from the fence title", () => {
		const html = renderToStaticMarkup(
			<MemoizedMarkdown
				content={
					'```mermaid title="app-infrastructure-architecture"\nflowchart LR\n  A --> B\n```'
				}
			/>,
		);

		expect(html).toContain("app-infrastructure-architecture.mmd");
	});

	test("owns the Mermaid block through a lazy custom renderer", () => {
		const loader = vi.fn(async () => ({
			default: { initialize: vi.fn(), render: vi.fn() },
		}));
		const plugins = createDesktopMarkdownPlugins(loader);

		// Streamdown checks `renderers` before its built-in Mermaid block, so the
		// diagram plugin must not be registered (it would only be dead config).
		expect(plugins).not.toHaveProperty("mermaid");
		expect(plugins.renderers).toHaveLength(1);
		expect(plugins.renderers[0]?.language).toBe("mermaid");
		expect(loader).not.toHaveBeenCalled();
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
		expect(html).not.toContain("example.com/path");
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
