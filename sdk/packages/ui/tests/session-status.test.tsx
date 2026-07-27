import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionStatus } from "../components/index.js";

describe("SessionStatus", () => {
	it("renders an accessible dot-only status", () => {
		const markup = renderToStaticMarkup(
			<SessionStatus label="Running" showLabel={false} tone="running" />,
		);

		expect(markup).toContain("<output");
		expect(markup).toContain('aria-label="Running"');
		expect(markup).toContain("cline-ui-session-status--running");
		expect(markup).toContain("cline-ui-sr-only");
		expect(markup).toContain(">Running</span>");
	});

	it("shows the label by default", () => {
		const markup = renderToStaticMarkup(
			<SessionStatus label="Ready" tone="neutral" />,
		);

		expect(markup).not.toContain("cline-ui-sr-only");
		expect(markup).toContain(">Ready</span>");
	});
});
