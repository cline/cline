import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionStatus } from "../components/index.js";

describe("SessionStatus", () => {
	it("uses hidden content as dot-only status text without duplicating it", () => {
		const markup = renderToStaticMarkup(
			<SessionStatus label="Running" showLabel={false} tone="running" />,
		);

		expect(markup).toContain("<output");
		expect(markup).not.toContain("aria-label");
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
