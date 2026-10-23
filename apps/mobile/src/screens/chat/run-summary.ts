/**
 * "What happened while I was away" — the aggregation behind the run-outcome
 * card. Derived entirely from the transcript the reducer already built: the
 * blocks after the last user message are the run the outcome describes.
 *
 * Pure and defensive: a run with no tool activity summarizes to `undefined`
 * (the card would only restate the status chip), and file totals come from the
 * same diff parser the tool cards render with, so the card can never disagree
 * with the transcript above it.
 */

import type { MessageBlock, SessionMessageView } from "@/session";
import { parseToolDiff } from "./diff";
import { diffCounts } from "./tools";

export interface RunFileSummary {
	path: string;
	additions: number;
	deletions: number;
}

export interface RunSummary {
	toolCount: number;
	failedCount: number;
	files: RunFileSummary[];
	additions: number;
	deletions: number;
}

type ToolBlock = Extract<MessageBlock, { kind: "tool" }>;

export function summarizeLastRun(
	messages: readonly SessionMessageView[],
): RunSummary | undefined {
	const tools: ToolBlock[] = [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!message || message.role === "user") {
			break;
		}
		for (const block of message.blocks) {
			if (block.kind === "tool") {
				tools.push(block);
			}
		}
	}
	if (tools.length === 0) {
		return undefined;
	}

	const byPath = new Map<string, RunFileSummary>();
	let untrackedAdditions = 0;
	let untrackedDeletions = 0;
	for (const tool of tools) {
		// Input describes what the model attempted, not what reached disk. Without a
		// successful tool result it must not contribute to "files changed".
		if (tool.state !== "completed") continue;
		const files = parseToolDiff(tool.name, tool.input, tool.output);
		if (files.length > 0) {
			for (const file of files) {
				const existing = byPath.get(file.path);
				if (existing) {
					existing.additions += file.additions;
					existing.deletions += file.deletions;
				} else {
					byPath.set(file.path, {
						path: file.path,
						additions: file.additions,
						deletions: file.deletions,
					});
				}
			}
			continue;
		}
		// Edit-shaped tools whose payload we could not parse still count toward
		// the totals when they carried explicit counts.
		const counts = diffCounts(tool.name, tool.input, tool.output);
		if (counts) {
			untrackedAdditions += counts.additions;
			untrackedDeletions += counts.deletions;
		}
	}

	const files = [...byPath.values()];
	return {
		toolCount: tools.length,
		failedCount: tools.filter((tool) => tool.state === "failed").length,
		files,
		additions:
			files.reduce((sum, file) => sum + file.additions, 0) + untrackedAdditions,
		deletions:
			files.reduce((sum, file) => sum + file.deletions, 0) + untrackedDeletions,
	};
}

/** "2m 14s" / "45s"; undefined when either endpoint was never observed. */
export function formatRunDuration(
	startedAt?: number,
	endedAt?: number,
): string | undefined {
	if (
		startedAt === undefined ||
		endedAt === undefined ||
		!Number.isFinite(startedAt) ||
		!Number.isFinite(endedAt) ||
		endedAt < startedAt
	) {
		return undefined;
	}
	const totalSeconds = Math.max(1, Math.round((endedAt - startedAt) / 1_000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
