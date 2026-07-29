import type { ShowBacklogItem } from "@cline/shared";
import { getShowTemplate } from "@cline/drive";
import { buildCardSvg, svgDataUri } from "./svgStub";

export type ProduceBrowserSnapshotInput = {
	ownerParticipantId: string;
	title?: string;
	caption?: string;
	templateId?: string;
	url?: string;
	/** When false, fail closed — no URI, status stays planned. */
	demoCapture: boolean;
};

export type ProduceBrowserSnapshotResult =
	| {
			ok: true;
			item: ShowBacklogItem;
			svg: string;
	  }
	| {
			ok: false;
			item: ShowBacklogItem;
			reason: "demo_capture_unavailable";
	  };

/**
 * Browser snapshot producer. Fail-closed when demoCapture is false
 * (no inline media bytes; privacy-safe stub only when capability is on).
 */
export function produceBrowserSnapshotShowArtifact(
	input: ProduceBrowserSnapshotInput,
): ProduceBrowserSnapshotResult {
	const template = input.templateId
		? getShowTemplate(input.templateId)
		: getShowTemplate("capture.shot");
	const title = input.title ?? template?.title ?? "UI screenshot";
	const base: Omit<ShowBacklogItem, "uri" | "status" | "scoreReasons"> = {
		id: `show-shot-${(input.url ?? "local").slice(0, 24).replace(/\W+/g, "_")}`,
		ownerParticipantId: input.ownerParticipantId,
		title,
		intent: template?.intent ?? "Show running UI proof",
		artifactKind: "capture.screenshot",
		mediaClass: "still",
		caption: input.caption ?? input.url ?? title,
		produce: {
			tool: "drive_browser_snapshot",
			templateId: input.templateId ?? "capture.shot",
			args: { url: input.url },
		},
		priority: 10,
	};

	if (!input.demoCapture) {
		return {
			ok: false,
			reason: "demo_capture_unavailable",
			item: {
				...base,
				status: "planned",
				scoreReasons: ["capability:demo_capture_unavailable"],
			},
		};
	}

	const body = [
		input.url ?? "(local UI)",
		"",
		"Demo capture stub — host capability demoCapture enabled.",
	].join("\n");
	const svg = buildCardSvg({ title, body });
	return {
		ok: true,
		svg,
		item: {
			...base,
			uri: svgDataUri(svg),
			status: "ready",
			scoreReasons: ["produced", "demo_capture"],
		},
	};
}
