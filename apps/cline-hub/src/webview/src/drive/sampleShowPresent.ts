import type { ShowBacklogItem } from "@cline/shared";
import { postToHost } from "../vscode";
import {
	DRIVE_DEFAULT_ROOM_ID,
	DRIVE_PARTICIPANT_PARTNER,
} from "./types";

/** Deterministic sample diagram for Slice 1 present-trigger smoke (no LLM). */
export const SAMPLE_ARCHITECTURE_MERMAID = `flowchart LR
  Human --> Hub
  Hub --> Agent
  Agent --> Stage`;

export const SAMPLE_ARCHITECTURE_SHOW_ID = "show-sample-arch-overview";

/**
 * Build a valid ShowBacklogItem for "Present sample diagram" (Sample / dev).
 * Includes mermaidSource so hub materializeShowItem can fill uri.
 */
export function buildSampleArchitectureShowItem(input?: {
	ownerParticipantId?: string;
	id?: string;
}): ShowBacklogItem {
	return {
		id: input?.id ?? SAMPLE_ARCHITECTURE_SHOW_ID,
		ownerParticipantId:
			input?.ownerParticipantId ?? DRIVE_PARTICIPANT_PARTNER,
		title: "Architecture overview",
		intent: "Explain system layout before coding",
		artifactKind: "diagram.architecture",
		mediaClass: "still",
		caption: "Sample / dev — architecture overview",
		produce: {
			tool: "render_mermaid",
			templateId: "arch.overview",
			args: { mermaidSource: SAMPLE_ARCHITECTURE_MERMAID },
		},
		priority: 10,
		status: "ready",
		scoreReasons: ["sample_dev"],
	};
}

/** Post drive.show.present for the sample architecture diagram. */
export function presentSampleArchitectureShow(roomId?: string | null): void {
	postToHost({
		type: "driveCommand",
		command: "drive.show.present",
		payload: {
			roomId: roomId?.trim() || DRIVE_DEFAULT_ROOM_ID,
			showItem: buildSampleArchitectureShowItem(),
		},
	});
}
