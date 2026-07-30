import type { ShowBacklogItem } from "@cline/shared";
import { getShowTemplate } from "@cline/drive";
import { buildCardSvg, svgDataUri } from "./svgStub";

export type ProducePlanCardInput = {
	ownerParticipantId: string;
	title?: string;
	caption?: string;
	templateId?: string;
	/** Plan steps or body lines. */
	steps?: string[];
	planTitle?: string;
};

export type ProducePlanCardResult = {
	item: ShowBacklogItem;
	svg: string;
};

/**
 * Produce a plan card as an SVG data URI for StickyStagePane.
 */
export function producePlanCardShowArtifact(
	input: ProducePlanCardInput,
): ProducePlanCardResult {
	const template = input.templateId
		? getShowTemplate(input.templateId)
		: getShowTemplate("doc.plan");
	const planTitle = input.planTitle ?? input.title ?? template?.title ?? "Plan";
	const steps =
		input.steps && input.steps.length > 0
			? input.steps
			: ["1. Review current work", "2. Execute next step", "3. Verify"];
	const body = [`# ${planTitle}`, "", ...steps.map((step) => `- ${step}`)].join(
		"\n",
	);
	const svg = buildCardSvg({
		title: planTitle,
		body,
	});
	const uri = svgDataUri(svg);
	const item: ShowBacklogItem = {
		id: `show-plan-${planTitle.slice(0, 24).replace(/\s+/g, "-").toLowerCase()}`,
		ownerParticipantId: input.ownerParticipantId,
		title: planTitle,
		intent: template?.intent ?? "Keep the active plan visible",
		artifactKind: "doc.plan",
		mediaClass: "document",
		uri,
		caption: input.caption ?? planTitle,
		produce: {
			tool: "render_plan_card",
			templateId: input.templateId ?? "doc.plan",
			args: {
				planTitle,
				steps,
			},
		},
		priority: 10,
		status: "ready",
		scoreReasons: ["produced"],
	};
	return { item, svg };
}
