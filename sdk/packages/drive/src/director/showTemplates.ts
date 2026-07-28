import type { ShowArtifactKind } from "@cline/shared";

export type ShowTemplate = {
	templateId: string;
	artifactKind: ShowArtifactKind;
	title: string;
	intent: string;
	produceTool: string;
	defaultArgs: Record<string, unknown>;
};

/** MVP kit for planner/screen-manager produce steps. */
export const SHOW_TEMPLATE_KIT: readonly ShowTemplate[] = [
	{
		templateId: "arch.overview",
		artifactKind: "diagram.architecture",
		title: "Architecture overview",
		intent: "Explain system layout before coding",
		produceTool: "render_mermaid",
		defaultArgs: { diagramType: "architecture" },
	},
	{
		templateId: "flow.data",
		artifactKind: "diagram.data_flow",
		title: "Data flow",
		intent: "Show how data moves across boundaries",
		produceTool: "render_mermaid",
		defaultArgs: { diagramType: "data_flow" },
	},
	{
		templateId: "sec.network",
		artifactKind: "diagram.network_security",
		title: "Network / security boundaries",
		intent: "Explain trust boundaries and egress",
		produceTool: "render_mermaid",
		defaultArgs: { diagramType: "network_security" },
	},
	{
		templateId: "walk.code",
		artifactKind: "walkthrough.code",
		title: "Code walkthrough",
		intent: "Rubber-duck a file or function",
		produceTool: "render_code_walkthrough",
		defaultArgs: {},
	},
	{
		templateId: "doc.plan",
		artifactKind: "doc.plan",
		title: "Plan card",
		intent: "Keep the active plan visible while discussing",
		produceTool: "render_plan_card",
		defaultArgs: {},
	},
	{
		templateId: "capture.shot",
		artifactKind: "capture.screenshot",
		title: "UI screenshot",
		intent: "Show running UI proof",
		produceTool: "drive_browser_snapshot",
		defaultArgs: {},
	},
];

export function getShowTemplate(templateId: string): ShowTemplate | undefined {
	return SHOW_TEMPLATE_KIT.find((entry) => entry.templateId === templateId);
}
