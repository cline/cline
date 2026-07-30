import type { MediaClass, ShowArtifactKind, ShowBacklogItem } from "@cline/shared";

export type ShowTemplate = {
	templateId: string;
	artifactKind: ShowArtifactKind;
	title: string;
	intent: string;
	produceTool: string;
	defaultArgs: Record<string, unknown>;
};

/**
 * Convention-stable Mermaid for diagram.* kit entries.
 * Prefer these (and nest living fences) over free-form invent.
 * Names match `.claude/diagram-conventions.md` / diagram-first skill.
 */
export const KIT_MERMAID_ARCH_OVERVIEW = `flowchart LR
  HubDaemon --> StatusPlane
  HubDaemon --> RoomPlane
  RoomPlane --> DriveLive
  DriveLive --> ShowBacklog
  ShowBacklog --> MermaidProduce
  MermaidProduce --> StickyStagePane`;

export const KIT_MERMAID_FLOW_DATA = `flowchart LR
  ShowPlanner -->|"ShowBacklogItem"| ShowBacklog
  DoBacklog -->|"ForkPromote"| ShowBacklog
  ShowBacklog -->|"rank"| MermaidProduce
  MermaidProduce --> StickyStagePane`;

export const KIT_MERMAID_SEC_NETWORK = `flowchart TB
  subgraph localhostTrust["localhost trust boundary"]
    HubDaemon
    StickyStagePane
  end
  HubDaemon -.->|"no remoteBridge by default"| RemoteClients["remote clients"]`;

/** MVP kit for planner/screen-manager produce steps. */
export const SHOW_TEMPLATE_KIT: readonly ShowTemplate[] = [
	{
		templateId: "arch.overview",
		artifactKind: "diagram.architecture",
		title: "Architecture overview",
		intent: "Explain system layout before coding",
		produceTool: "render_mermaid",
		defaultArgs: {
			diagramType: "architecture",
			mermaidSource: KIT_MERMAID_ARCH_OVERVIEW,
			source: "SHOW_TEMPLATE_KIT",
		},
	},
	{
		templateId: "flow.data",
		artifactKind: "diagram.data_flow",
		title: "Data flow",
		intent: "Show how data moves across boundaries",
		produceTool: "render_mermaid",
		defaultArgs: {
			diagramType: "data_flow",
			mermaidSource: KIT_MERMAID_FLOW_DATA,
			source: "SHOW_TEMPLATE_KIT",
		},
	},
	{
		templateId: "sec.network",
		artifactKind: "diagram.network_security",
		title: "Network / security boundaries",
		intent: "Explain trust boundaries and egress",
		produceTool: "render_mermaid",
		defaultArgs: {
			diagramType: "network_security",
			mermaidSource: KIT_MERMAID_SEC_NETWORK,
			source: "SHOW_TEMPLATE_KIT",
		},
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

export function mediaClassForArtifactKind(
	kind: ShowArtifactKind,
): MediaClass {
	switch (kind) {
		case "diagram.architecture":
		case "diagram.data_flow":
		case "diagram.network_security":
		case "diagram.sequence":
		case "capture.screenshot":
			return "still";
		case "walkthrough.animation":
			return "animation";
		case "capture.demo_clip":
			return "video";
		case "doc.plan":
		case "doc.review":
		case "walkthrough.code":
			return "document";
		case "share.structured":
			return "structured";
		case "work.card":
			return "work";
		default: {
			const _exhaustive: never = kind;
			return _exhaustive;
		}
	}
}

export function showItemIdForTemplate(
	templateId: string,
	doItemId: string,
): string {
	return `show_${templateId.replace(/[^a-zA-Z0-9._-]+/g, "_")}_${doItemId}`;
}

/**
 * Build a ready ShowBacklogItem from SHOW_TEMPLATE_KIT (or null if unknown).
 * Diagram templates include convention-stable mermaidSource in produce.args.
 */
export function showItemFromTemplate(input: {
	templateId: string;
	ownerParticipantId: string;
	linkedDoItemId: string;
	showItemId?: string;
	priority?: number;
	args?: Record<string, unknown>;
}): ShowBacklogItem | null {
	const template = getShowTemplate(input.templateId);
	if (!template) {
		return null;
	}
	return {
		id:
			input.showItemId ??
			showItemIdForTemplate(template.templateId, input.linkedDoItemId),
		ownerParticipantId: input.ownerParticipantId,
		title: template.title,
		intent: template.intent,
		artifactKind: template.artifactKind,
		mediaClass: mediaClassForArtifactKind(template.artifactKind),
		caption: template.intent,
		produce: {
			tool: template.produceTool,
			templateId: template.templateId,
			args: { ...template.defaultArgs, ...(input.args ?? {}) },
		},
		priority: input.priority ?? 10,
		status: "ready",
		linkedDoItemId: input.linkedDoItemId,
		scoreReasons: ["promote_template"],
	};
}
