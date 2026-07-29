import { describe, expect, it } from "vitest";
import { producePlanCardShowArtifact } from "./producePlanCard";
import { produceCodeWalkthroughShowArtifact } from "./produceCodeWalkthrough";
import { produceBrowserSnapshotShowArtifact } from "./produceBrowserSnapshot";

describe("drive producers", () => {
	it("producePlanCard fills an SVG data URI", () => {
		const result = producePlanCardShowArtifact({
			ownerParticipantId: "agent-1",
			planTitle: "Ship slice 6",
			steps: ["Write producers", "Wire materialize", "Test"],
		});
		expect(result.item.uri).toMatch(/^data:image\/svg\+xml/);
		expect(result.item.artifactKind).toBe("doc.plan");
		expect(result.item.status).toBe("ready");
		expect(result.svg).toContain("Ship slice 6");
	});

	it("produceCodeWalkthrough fills an SVG data URI", () => {
		const result = produceCodeWalkthroughShowArtifact({
			ownerParticipantId: "agent-1",
			path: "src/foo.ts",
			startLine: 10,
			endLine: 20,
			snippet: "export const x = 1",
		});
		expect(result.item.uri).toMatch(/^data:image\/svg\+xml/);
		expect(result.item.caption).toContain("src/foo.ts:10-20");
		expect(result.svg).toContain("export const x = 1");
	});

	it("produceBrowserSnapshot fails closed without demoCapture", () => {
		const denied = produceBrowserSnapshotShowArtifact({
			ownerParticipantId: "agent-1",
			demoCapture: false,
			url: "http://localhost:3000",
		});
		expect(denied.ok).toBe(false);
		if (denied.ok) {
			return;
		}
		expect(denied.item.uri).toBeUndefined();
		expect(denied.item.status).toBe("planned");
		expect(denied.item.scoreReasons).toContain(
			"capability:demo_capture_unavailable",
		);

		const allowed = produceBrowserSnapshotShowArtifact({
			ownerParticipantId: "agent-1",
			demoCapture: true,
			url: "http://localhost:3000",
		});
		expect(allowed.ok).toBe(true);
		if (!allowed.ok) {
			return;
		}
		expect(allowed.item.uri).toMatch(/^data:image\/svg\+xml/);
	});
});
