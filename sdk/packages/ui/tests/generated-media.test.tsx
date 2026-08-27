// @vitest-environment jsdom

import type { GeneratedMedia } from "@cline/shared/browser";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneratedMediaContent } from "../components/index.js";

let container: HTMLDivElement;
let root: Root;
const createObjectURL = vi.fn(() => "blob:cline-generated-media");
const revokeObjectURL = vi.fn();

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	Object.defineProperties(URL, {
		createObjectURL: { configurable: true, value: createObjectURL },
		revokeObjectURL: { configurable: true, value: revokeObjectURL },
	});
	createObjectURL.mockClear();
	revokeObjectURL.mockClear();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

function media(
	modality: GeneratedMedia["modality"],
	mediaType: string,
): GeneratedMedia {
	return {
		id: `generated-${modality}`,
		modality,
		mediaType,
		source: { type: "base64", data: "aGVsbG8=" },
	};
}

describe("GeneratedMediaContent", () => {
	it.each([
		["image", "image/png", "img"],
		["audio", "audio/mpeg", "audio"],
		["video", "video/mp4", "video"],
		["file", "application/pdf", "a"],
	] as const)("renders %s media as <%s>", async (modality, mediaType, tag) => {
		await render(
			<GeneratedMediaContent
				className="consumer-class"
				media={media(modality, mediaType)}
			/>,
		);

		const element = container.querySelector(tag);
		expect(element?.className).toContain("consumer-class");
		expect(element?.getAttribute("data-media-id")).toBe(
			`generated-${modality}`,
		);
		expect(element?.getAttribute(modality === "file" ? "href" : "src")).toBe(
			"blob:cline-generated-media",
		);
		expect(createObjectURL).toHaveBeenCalledOnce();
	});

	it("renders image collections as an interactive carousel", async () => {
		const first = {
			...media("image", "image/png"),
			id: "generated-image-1",
		};
		const second = {
			...media("image", "image/png"),
			id: "generated-image-2",
		};
		const onImageClick = vi.fn();

		await render(
			<GeneratedMediaContent
				classNames={{
					image: "image-content",
					imageFrame: "image-frame",
					imageTrigger: "image-trigger",
				}}
				media={[first, second]}
				onImageClick={onImageClick}
			/>,
		);

		let image = container.querySelector<HTMLImageElement>(
			'img[alt="Generated result 1"]',
		);
		expect(image?.getAttribute("data-media-id")).toBe("generated-image-1");
		expect(image?.className).toContain("image-content");
		expect(image?.closest(".image-frame")).not.toBeNull();
		expect(image?.closest("button")?.className).toContain("image-trigger");
		expect(container.textContent).toContain("1 / 2");

		const previous = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Previous generated image"]',
		);
		const next = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Next generated image"]',
		);
		expect(previous?.disabled).toBe(true);
		await act(async () => next?.click());

		image = container.querySelector<HTMLImageElement>(
			'img[alt="Generated result 2"]',
		);
		expect(image?.getAttribute("data-media-id")).toBe("generated-image-2");
		expect(container.textContent).toContain("2 / 2");
		expect(next?.disabled).toBe(true);

		await act(async () => image?.closest("button")?.click());
		expect(onImageClick).toHaveBeenCalledWith(second);
	});

	it("renders image collections as a grid when requested", async () => {
		await render(
			<GeneratedMediaContent
				classNames={{ container: "image-grid" }}
				getImageAlt={(_, index) => `Attachment ${index + 1}`}
				imageLayout="grid"
				media={[
					{ ...media("image", "image/png"), id: "attachment-1" },
					{ ...media("image", "image/png"), id: "attachment-2" },
				]}
			/>,
		);

		expect(container.querySelector(".image-grid")).not.toBeNull();
		expect(container.querySelector('img[alt="Attachment 1"]')).not.toBeNull();
		expect(container.querySelector('img[alt="Attachment 2"]')).not.toBeNull();
		expect(
			container.querySelector('button[aria-label="Next generated image"]'),
		).toBeNull();
	});

	it("renders artifact-backed media without inventing a URL", async () => {
		await render(
			<GeneratedMediaContent
				classNames={{ unavailable: "artifact-card" }}
				media={{
					id: "generated-artifact",
					modality: "video",
					mediaType: "video/mp4",
					source: { type: "artifact", artifactId: "artifact-123" },
				}}
			/>,
		);

		expect(container.textContent).toContain("artifact-123");
		expect(
			container.querySelector("[data-testid='generated-media-unavailable']")
				?.className,
		).toContain("artifact-card");
		expect(container.querySelector("[src], [href]")).toBeNull();
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it("does not bind provider-supplied remote URLs to DOM sinks", async () => {
		await render(
			<GeneratedMediaContent
				media={{
					id: "generated-remote",
					modality: "audio",
					mediaType: "audio/mpeg",
					source: { type: "url", url: "https://media.example/result.mp3" },
				}}
			/>,
		);

		expect(container.textContent).toContain("trusted remote-media resolver");
		expect(container.querySelector("[src], [href]")).toBeNull();
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it("rejects active image types and malformed inline data", async () => {
		await render(
			<GeneratedMediaContent
				media={{
					id: "generated-svg",
					modality: "image",
					mediaType: "image/svg+xml",
					source: { type: "base64", data: "PHN2Zz48L3N2Zz4=" },
				}}
			/>,
		);
		expect(container.querySelector("[src], [href]")).toBeNull();

		await render(
			<GeneratedMediaContent
				media={{
					id: "generated-invalid",
					modality: "image",
					mediaType: "image/png",
					source: { type: "base64", data: "not-base64" },
				}}
			/>,
		);
		expect(container.querySelector("[src], [href]")).toBeNull();
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it("revokes browser-owned URLs when the media changes", async () => {
		await render(<GeneratedMediaContent media={media("image", "image/png")} />);
		await render(
			<GeneratedMediaContent media={media("audio", "audio/mpeg")} />,
		);

		expect(revokeObjectURL).toHaveBeenCalledWith("blob:cline-generated-media");
	});
});
