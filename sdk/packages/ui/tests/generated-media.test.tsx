import type { GeneratedMedia } from "@cline/shared/browser";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneratedMediaContent } from "../components/index.js";

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
	] as const)("renders %s media as <%s>", (modality, mediaType, tag) => {
		const markup = renderToStaticMarkup(
			<GeneratedMediaContent
				className="consumer-class"
				media={media(modality, mediaType)}
			/>,
		);

		expect(markup).toContain(`<${tag}`);
		expect(markup).toContain("consumer-class");
		expect(markup).toContain(`data-media-id="generated-${modality}"`);
	});

	it("renders artifact-backed media without inventing a URL", () => {
		const markup = renderToStaticMarkup(
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

		expect(markup).toContain("artifact-card");
		expect(markup).toContain("artifact-123");
		expect(markup).not.toContain("src=");
	});
});
