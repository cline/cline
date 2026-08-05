import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentAttachments } from "../components/index.js";

describe("AgentAttachments", () => {
	it("renders host-neutral image attachments and remove controls", () => {
		const markup = renderToStaticMarkup(
			<AgentAttachments
				attachments={[
					{
						id: "diagram",
						label: "diagram.png",
						mediaType: "image/png",
						src: "data:image/png;base64,AAAA",
					},
				]}
				onRemove={() => undefined}
			/>,
		);

		expect(markup).toContain('aria-label="Attachments"');
		expect(markup).toContain('alt="diagram.png"');
		expect(markup).toContain('aria-label="Remove diagram.png"');
	});

	it("renders attachment labels in the inline variant", () => {
		const markup = renderToStaticMarkup(
			<AgentAttachments
				attachments={[{ id: "notes", label: "notes.txt" }]}
				variant="inline"
			/>,
		);

		expect(markup).toContain("notes.txt");
		expect(markup).not.toContain('aria-label="Remove notes.txt"');
	});
});
