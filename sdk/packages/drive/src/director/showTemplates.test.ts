import { describe, expect, it } from "vitest";
import {
	getShowTemplate,
	mediaClassForArtifactKind,
	SHOW_TEMPLATE_KIT,
	showItemFromTemplate,
} from "./showTemplates.js";

describe("SHOW_TEMPLATE_KIT", () => {
	it("includes architecture and walkthrough templates", () => {
		expect(SHOW_TEMPLATE_KIT.length).toBeGreaterThanOrEqual(5);
		expect(getShowTemplate("arch.overview")?.artifactKind).toBe(
			"diagram.architecture",
		);
		expect(getShowTemplate("walk.code")?.artifactKind).toBe(
			"walkthrough.code",
		);
	});

	it("builds a ready show item linked to a Do id", () => {
		const item = showItemFromTemplate({
			templateId: "arch.overview",
			ownerParticipantId: "agent-1",
			linkedDoItemId: "do-42",
		});
		expect(item).toMatchObject({
			artifactKind: "diagram.architecture",
			mediaClass: "still",
			status: "ready",
			linkedDoItemId: "do-42",
			produce: { tool: "render_mermaid", templateId: "arch.overview" },
		});
		expect(typeof item?.produce.args.mermaidSource).toBe("string");
		expect(String(item?.produce.args.mermaidSource)).toContain("HubDaemon");
		expect(mediaClassForArtifactKind("work.card")).toBe("work");
	});
});
