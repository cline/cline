// @vitest-environment jsdom
import type { FactoryArtifact } from "@cline/shared";
import type { FactoryVisualProof } from "@cline/shared/browser";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FactoryVisualProofStrip } from "./factory-visual-proof";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(async (_command: string, _args: Record<string, unknown>) => ({
		dataUrl: "data:image/jpeg;base64,AAAA",
	})),
}));
vi.mock("@/lib/desktop-client", () => ({ desktopClient: mocks }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	vi.clearAllMocks();
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

const recording: FactoryArtifact = {
	label: "Recording",
	path: "/store/session.webm",
	mimeType: "video/webm",
	caption: "Search a note by title",
	thumbnailPath: "/store/session.jpg",
	durationMs: 83_000,
	steps: [{ atMs: 12_000, text: "Typed the query" }],
};
const screenshot: FactoryArtifact = {
	label: "Results",
	path: "/store/results.png",
	mimeType: "image/png",
	caption: "Results list",
	thumbnailPath: "/store/results.jpg",
};
const render = (proof: FactoryVisualProof) =>
	act(async () =>
		root.render(
			<FactoryVisualProofStrip taskId="task" runId="run" proof={proof} />,
		),
	);

describe("FactoryVisualProofStrip", () => {
	it("renders nothing when proof is not required", async () => {
		await render({ status: "not_required" });
		expect(container.innerHTML).toBe("");
	});

	it("shows the recording first, then screenshots, as named buttons with alt text", async () => {
		await render({
			status: "shown",
			screenshots: [screenshot],
			recordings: [recording],
		});
		const tiles = [...container.querySelectorAll("button")];
		expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual([
			"Open Search a note by title",
			"Open Results list",
		]);
		expect(tiles.every((tile) => tile.type === "button")).toBe(true);
		expect(
			[...container.querySelectorAll("img")].map((img) => img.alt),
		).toEqual(["Search a note by title", "Results list"]);
		expect(tiles[0]?.textContent).toBe("1:23");
		expect(mocks.invoke).toHaveBeenCalledWith("factory_read_artifact", {
			taskId: "task",
			runId: "run",
			path: recording.path,
			variant: "thumbnail",
		});
	});

	it("opens a recording in the dialog without autoplay, with steps that seek", async () => {
		await render({
			status: "shown",
			screenshots: [],
			recordings: [{ ...recording, thumbnailPath: undefined }],
		});
		mocks.invoke.mockResolvedValueOnce({
			dataUrl: "data:video/webm;base64,AAAA",
		});
		await act(async () =>
			container.querySelector<HTMLButtonElement>("button")?.click(),
		);
		const video = document.querySelector("video");
		expect(video).not.toBeNull();
		expect(video?.hasAttribute("autoplay")).toBe(false);
		expect(video?.getAttribute("preload")).toBe("metadata");
		expect(video?.hasAttribute("controls")).toBe(true);
		const step = [...document.querySelectorAll("button")].find((item) =>
			item.textContent?.includes("Typed the query"),
		);
		expect(step?.textContent).toContain("0:12");
		// The steps are the recording's captions: listed open, not folded away.
		expect(
			document
				.querySelector('[aria-label="What the tester did"]')
				?.contains(step ?? null),
		).toBe(true);
		expect(step?.closest("details")).toBeNull();
		if (!video) throw new Error("No video");
		await act(async () => step?.click());
		expect(video.currentTime).toBe(12);
	});

	it("falls back to a neutral clickable tile when the thumbnail fails", async () => {
		mocks.invoke.mockRejectedValueOnce(new Error("too large"));
		await render({
			status: "shown",
			screenshots: [{ ...screenshot, path: "/store/broken.png" }],
			recordings: [],
		});
		expect(container.querySelector("img")).toBeNull();
		expect(container.querySelector("button")?.textContent).toBe("");
		expect(container.textContent).toContain("Results list");
	});

	it("says proof is missing in a static pill with the reason, and keeps existing tiles", async () => {
		await render({
			status: "missing",
			screenshots: [{ ...screenshot, path: "/store/other.png" }],
			recordings: [],
			reason: "The change touches the UI and no recording was captured.",
		});
		const text = container.textContent ?? "";
		expect(text).toContain("Not visually verified");
		expect(text).toContain("no recording was captured");
		const pill = [...container.querySelectorAll("span")].find(
			(item) => item.textContent === "Not visually verified",
		);
		expect(pill?.closest("button")).toBeNull();
		expect(container.querySelectorAll("button")).toHaveLength(1);
	});
});
