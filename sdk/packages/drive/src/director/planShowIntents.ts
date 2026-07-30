import type { ShowBacklogItem } from "@cline/shared";
import { showItemFromTemplate, showItemIdForTemplate } from "./showTemplates.js";

export type ShowPlannerMode = "off" | "heuristic";

export type PlanShowWorkCategory =
	| "edit"
	| "command"
	| "test"
	| "plan"
	| "decision";

export type PlanShowSignal =
	| { kind: "plan_mode" }
	| { kind: "first_act" }
	| { kind: "work"; category: PlanShowWorkCategory };

export const DEFAULT_SHOW_PLANNER_COOLDOWN_MS = 30_000;

export type PlanShowIntentsInput = {
	signal: PlanShowSignal;
	ownerParticipantId: string;
	existingShowBacklog: readonly ShowBacklogItem[];
	nowMs: number;
	lastEnqueuedAtByTemplate?: Readonly<Record<string, string>>;
	cooldownMs?: number;
	mode?: ShowPlannerMode;
	/** Optional linked Do for created shows. */
	linkedDoItemId?: string;
};

export type PlanShowIntentsResult = {
	items: ShowBacklogItem[];
	/** Human-readable planner reasons (also mirrored into scoreReasons). */
	reasons: string[];
	/** Template ids that were skipped due to cooldown or dedupe. */
	skippedTemplateIds: string[];
};

function templatesForSignal(signal: PlanShowSignal): string[] {
	switch (signal.kind) {
		case "plan_mode":
		case "first_act":
			return ["arch.overview"];
		case "work":
			switch (signal.category) {
				case "plan":
					return ["arch.overview", "doc.plan"];
				case "test":
					return ["doc.plan"];
				case "edit":
					return ["walk.code"];
				case "command":
				case "decision":
					return [];
				default: {
					const _exhaustive: never = signal.category;
					return _exhaustive;
				}
			}
		default: {
			const _exhaustive: never = signal;
			return _exhaustive;
		}
	}
}

function backlogHasTemplate(
	backlog: readonly ShowBacklogItem[],
	templateId: string,
): boolean {
	return backlog.some(
		(item) =>
			item.produce.templateId === templateId &&
			item.status !== "cancelled",
	);
}

function withinCooldown(
	lastAt: string | undefined,
	nowMs: number,
	cooldownMs: number,
): boolean {
	if (!lastAt || cooldownMs <= 0) {
		return false;
	}
	const then = Date.parse(lastAt);
	if (Number.isNaN(then)) {
		return false;
	}
	return nowMs - then < cooldownMs;
}

/**
 * Heuristic MVP show planner — no LLM. Maps work/plan signals to template
 * intents, deduping by templateId and respecting per-template cooldown.
 *
 * Diagram templates carry convention-stable mermaidSource from SHOW_TEMPLATE_KIT
 * (see diagram-first / diagram-show Cline skills). Do not invent Mermaid here.
 */
export function planShowIntents(
	input: PlanShowIntentsInput,
): PlanShowIntentsResult {
	const mode = input.mode ?? "heuristic";
	if (mode === "off") {
		return { items: [], reasons: ["planner_off"], skippedTemplateIds: [] };
	}

	const cooldownMs = input.cooldownMs ?? DEFAULT_SHOW_PLANNER_COOLDOWN_MS;
	const lastAt = input.lastEnqueuedAtByTemplate ?? {};
	const linkedDoItemId = input.linkedDoItemId ?? "planner";
	const templates = templatesForSignal(input.signal);
	const items: ShowBacklogItem[] = [];
	const reasons: string[] = [];
	const skippedTemplateIds: string[] = [];

	for (const templateId of templates) {
		if (backlogHasTemplate(input.existingShowBacklog, templateId)) {
			skippedTemplateIds.push(templateId);
			continue;
		}
		if (withinCooldown(lastAt[templateId], input.nowMs, cooldownMs)) {
			skippedTemplateIds.push(templateId);
			continue;
		}
		const reason = `planner:${input.signal.kind}${
			input.signal.kind === "work" ? `:${input.signal.category}` : ""
		}:${templateId}`;
		const created = showItemFromTemplate({
			templateId,
			ownerParticipantId: input.ownerParticipantId,
			linkedDoItemId,
			showItemId: showItemIdForTemplate(templateId, linkedDoItemId),
			priority: 20,
		});
		if (!created) {
			skippedTemplateIds.push(templateId);
			continue;
		}
		items.push({
			...created,
			status: "ready",
			scoreReasons: [...created.scoreReasons, reason],
		});
		reasons.push(reason);
	}

	return { items, reasons, skippedTemplateIds };
}

export function workCategoryFromKind(
	kind: "edit" | "command" | "test_result" | "plan" | "decision",
): PlanShowWorkCategory {
	switch (kind) {
		case "edit":
			return "edit";
		case "command":
			return "command";
		case "test_result":
			return "test";
		case "plan":
			return "plan";
		case "decision":
			return "decision";
		default: {
			const _exhaustive: never = kind;
			return _exhaustive;
		}
	}
}
