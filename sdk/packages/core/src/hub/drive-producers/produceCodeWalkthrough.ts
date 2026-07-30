import type { ShowBacklogItem } from "@cline/shared";
import { getShowTemplate } from "@cline/drive";
import { buildCardSvg, svgDataUri } from "./svgStub";

export type ProduceCodeWalkthroughInput = {
	ownerParticipantId: string;
	title?: string;
	caption?: string;
	templateId?: string;
	path: string;
	startLine?: number;
	endLine?: number;
	/** Optional snippet text; when absent, stub shows path range only. */
	snippet?: string;
};

export type ProduceCodeWalkthroughResult = {
	item: ShowBacklogItem;
	svg: string;
};

/**
 * Produce a code walkthrough panel as an SVG data URI.
 */
export function produceCodeWalkthroughShowArtifact(
	input: ProduceCodeWalkthroughInput,
): ProduceCodeWalkthroughResult {
	const template = input.templateId
		? getShowTemplate(input.templateId)
		: getShowTemplate("walk.code");
	const start = input.startLine ?? 1;
	const end = input.endLine ?? start;
	const range = `${input.path}:${start}-${end}`;
	const body = [
		range,
		"",
		input.snippet?.trim() ||
			"(Walkthrough stub — pass produce.args.snippet for file text.)",
	].join("\n");
	const title = input.title ?? template?.title ?? "Code walkthrough";
	const svg = buildCardSvg({ title, body });
	const uri = svgDataUri(svg);
	const item: ShowBacklogItem = {
		id: `show-walk-${input.path.replace(/[^\w.-]+/g, "_").slice(0, 40)}`,
		ownerParticipantId: input.ownerParticipantId,
		title,
		intent: template?.intent ?? "Rubber-duck a file or function",
		artifactKind: "walkthrough.code",
		mediaClass: "document",
		uri,
		caption: input.caption ?? range,
		produce: {
			tool: "render_code_walkthrough",
			templateId: input.templateId ?? "walk.code",
			args: {
				path: input.path,
				startLine: start,
				endLine: end,
				snippet: input.snippet,
			},
		},
		priority: 10,
		status: "ready",
		scoreReasons: ["produced"],
	};
	return { item, svg };
}
