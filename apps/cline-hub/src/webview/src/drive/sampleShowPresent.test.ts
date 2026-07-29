import { describe, expect, it, vi, beforeEach } from "vitest";
import {
	SAMPLE_ARCHITECTURE_MERMAID,
	SAMPLE_ARCHITECTURE_SHOW_ID,
	buildSampleArchitectureShowItem,
	presentSampleArchitectureShow,
} from "./sampleShowPresent";

vi.mock("../vscode", () => ({
	postToHost: vi.fn(),
}));

describe("sampleShowPresent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("builds a mermaid ShowBacklogItem with materializable args", () => {
		const item = buildSampleArchitectureShowItem();
		expect(item.id).toBe(SAMPLE_ARCHITECTURE_SHOW_ID);
		expect(item.produce.tool).toBe("render_mermaid");
		expect(item.produce.args.mermaidSource).toBe(SAMPLE_ARCHITECTURE_MERMAID);
		expect(item.artifactKind).toBe("diagram.architecture");
		expect(item.caption).toMatch(/Sample \/ dev/);
	});

	it("posts drive.show.present with roomId and showItem", async () => {
		const { postToHost } = await import("../vscode");
		presentSampleArchitectureShow("room-a");
		expect(postToHost).toHaveBeenCalledWith({
			type: "driveCommand",
			command: "drive.show.present",
			payload: {
				roomId: "room-a",
				showItem: buildSampleArchitectureShowItem(),
			},
		});
	});

	it("falls back to default room id when roomId is empty", async () => {
		const { postToHost } = await import("../vscode");
		presentSampleArchitectureShow(null);
		expect(postToHost).toHaveBeenCalledWith(
			expect.objectContaining({
				payload: expect.objectContaining({ roomId: "default" }),
			}),
		);
	});

	it("enqueues and ticks via drive commands", async () => {
		const { postToHost } = await import("../vscode");
		const {
			enqueueSampleArchitectureShow,
			tickShowDirector,
		} = await import("./sampleShowPresent");
		enqueueSampleArchitectureShow("room-b");
		expect(postToHost).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "drive.show.enqueue",
				payload: expect.objectContaining({ roomId: "room-b" }),
			}),
		);
		tickShowDirector("room-b");
		expect(postToHost).toHaveBeenCalledWith({
			type: "driveCommand",
			command: "drive.show.tick",
			payload: { roomId: "room-b" },
		});
	});
});
