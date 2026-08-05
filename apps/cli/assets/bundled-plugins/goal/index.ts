import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type AgentPlugin,
	type AgentToolContext,
	createTool,
} from "@cline/sdk";

const PLUGIN_NAME = "goal";
const CLINE_DATA_DIR =
	process.env.CLINE_DATA_DIR || join(homedir(), ".cline", "data");
const STATE_PATH = join(CLINE_DATA_DIR, "plugins", PLUGIN_NAME, "goals.json");

type GoalRecord = {
	goal: string;
	createdAt: string;
	sessionId?: string;
	completedAt?: string;
	summary?: string;
	awaitingVerification?: boolean;
};

type GoalState = {
	version: 1;
	pendingGoal?: GoalRecord;
	activeGoals: Record<string, GoalRecord>;
};

interface ClinePluginHost {
	emitEvent?: (name: string, payload?: unknown) => void;
}

declare global {
	var __clinePluginHost: ClinePluginHost | undefined;
}

let setupSessionId: string | undefined;

function emptyState(): GoalState {
	return {
		version: 1,
		activeGoals: {},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asGoalRecord(value: unknown): GoalRecord | undefined {
	if (!isRecord(value) || typeof value.goal !== "string") {
		return undefined;
	}
	const goal = value.goal.trim();
	if (!goal) {
		return undefined;
	}
	const createdAt =
		typeof value.createdAt === "string" && value.createdAt.trim()
			? value.createdAt
			: new Date().toISOString();
	const sessionId =
		typeof value.sessionId === "string" && value.sessionId.trim()
			? value.sessionId.trim()
			: undefined;
	const completedAt =
		typeof value.completedAt === "string" && value.completedAt.trim()
			? value.completedAt
			: undefined;
	const summary =
		typeof value.summary === "string" && value.summary.trim()
			? value.summary.trim()
			: undefined;
	const awaitingVerification = value.awaitingVerification === true;
	return {
		goal,
		createdAt,
		...(sessionId ? { sessionId } : {}),
		...(completedAt ? { completedAt } : {}),
		...(summary ? { summary } : {}),
		...(awaitingVerification ? { awaitingVerification } : {}),
	};
}

function readState(): GoalState {
	if (!existsSync(STATE_PATH)) {
		return emptyState();
	}
	try {
		const parsed: unknown = JSON.parse(readFileSync(STATE_PATH, "utf8"));
		if (!isRecord(parsed)) {
			return emptyState();
		}
		const pendingGoal = asGoalRecord(parsed.pendingGoal);
		const activeGoals: Record<string, GoalRecord> = {};
		if (isRecord(parsed.activeGoals)) {
			for (const [sessionId, value] of Object.entries(parsed.activeGoals)) {
				const goal = asGoalRecord(value);
				if (sessionId.trim() && goal && !goal.completedAt) {
					activeGoals[sessionId] = {
						...goal,
						sessionId,
					};
				}
			}
		}
		return {
			version: 1,
			...(pendingGoal && !pendingGoal.completedAt ? { pendingGoal } : {}),
			activeGoals,
		};
	} catch {
		return emptyState();
	}
}

function writeState(state: GoalState): void {
	mkdirSync(dirname(STATE_PATH), { recursive: true });
	writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function setPendingGoal(goal: string): void {
	const state = readState();
	state.pendingGoal = {
		goal,
		createdAt: new Date().toISOString(),
	};
	writeState(state);
}

function clearAllGoals(): void {
	writeState(emptyState());
}

function claimPendingGoal(
	sessionId: string | undefined,
): GoalRecord | undefined {
	if (!sessionId) {
		return undefined;
	}
	const state = readState();
	const active = state.activeGoals[sessionId];
	if (active && !active.completedAt) {
		return active;
	}
	if (!state.pendingGoal || state.pendingGoal.completedAt) {
		return undefined;
	}
	const claimed = {
		...state.pendingGoal,
		sessionId,
	};
	state.activeGoals[sessionId] = claimed;
	delete state.pendingGoal;
	writeState(state);
	return claimed;
}

function readActiveGoal(sessionId: string | undefined): GoalRecord | undefined {
	const state = readState();
	if (sessionId) {
		const active = state.activeGoals[sessionId];
		if (active && !active.completedAt) {
			return active;
		}
	}
	const pending = state.pendingGoal;
	return pending && !pending.completedAt ? pending : undefined;
}

function completeGoal(
	sessionId: string | undefined,
	summary: string | undefined,
): { completed: GoalRecord } | { blocked: "missing" | "not_ready" } {
	if (!sessionId) {
		return { blocked: "missing" };
	}
	const state = readState();
	const active = state.activeGoals[sessionId];
	if (!active || active.completedAt) {
		return { blocked: "missing" };
	}
	if (active.awaitingVerification !== true) {
		return { blocked: "not_ready" };
	}
	const completed = {
		...active,
		completedAt: new Date().toISOString(),
		...(summary ? { summary } : {}),
	};
	delete state.activeGoals[sessionId];
	writeState(state);
	return { completed };
}

function markAwaitingVerification(
	sessionId: string | undefined,
): GoalRecord | undefined {
	if (!sessionId) {
		return undefined;
	}
	const state = readState();
	const active = state.activeGoals[sessionId];
	if (!active || active.completedAt) {
		return undefined;
	}
	const updated = {
		...active,
		awaitingVerification: true,
	};
	state.activeGoals[sessionId] = updated;
	writeState(state);
	return updated;
}

function formatStatus(): string {
	const state = readState();
	const lines: string[] = [];
	if (state.pendingGoal) {
		lines.push(`pending goal: ${state.pendingGoal.goal}`);
	}
	const active = Object.entries(state.activeGoals).filter(
		([, goal]) => !goal.completedAt,
	);
	if (active.length > 0) {
		lines.push("active goals:");
		for (const [sessionId, goal] of active) {
			const suffix = goal.awaitingVerification
				? " (awaiting verification)"
				: "";
			lines.push(`- ${sessionId}: ${goal.goal}${suffix}`);
		}
	}
	return lines.length > 0 ? lines.join("\n") : "No goal is active.";
}

function parseToolInput(input: unknown): { summary?: string } {
	if (!isRecord(input)) {
		return {};
	}
	const summary =
		typeof input.summary === "string" && input.summary.trim()
			? input.summary.trim()
			: undefined;
	return summary ? { summary } : {};
}

function resolveToolSessionId(context: AgentToolContext): string | undefined {
	return context.sessionId?.trim() || setupSessionId;
}

function emitQueueMessage(sessionId: string | undefined, prompt: string): void {
	if (!sessionId || !prompt.trim()) {
		return;
	}
	globalThis.__clinePluginHost?.emitEvent?.("queue_message", {
		sessionId,
		prompt,
	});
}

function verificationPrompt(goal: string): string {
	return [
		`Are you sure you've completed the goal: ${goal}`,
		"",
		"This verification prompt is the only time you may call mark_goal_complete.",
		"If yes, call mark_goal_complete with a concise summary.",
		"If not, continue the remaining work before calling mark_goal_complete.",
	].join("\n");
}

function activeGoalRule(): string {
	const active = readActiveGoal(setupSessionId);
	if (!active) {
		return "";
	}
	return [
		"Goal is active.",
		`Current goal: ${active.goal}`,
		"Do not consider this goal complete until the requested work is actually done.",
		"Do not call mark_goal_complete during the initial work run.",
		"Only call mark_goal_complete after a follow-up verification prompt explicitly asks whether the goal is complete.",
		"If the goal is complete when that verification prompt arrives, call mark_goal_complete with a concise summary.",
		"If the goal is not complete when that verification prompt arrives, continue the remaining work instead of claiming completion.",
	].join("\n");
}

const plugin: AgentPlugin = {
	name: PLUGIN_NAME,
	manifest: {
		capabilities: ["commands", "tools", "hooks", "rules"],
	},

	setup(api, ctx) {
		setupSessionId = ctx.session?.sessionId?.trim() || undefined;

		api.registerCommand({
			name: "goal",
			description: "Set or clear a goal completion guard.",
			handler: (input) => {
				const trimmed = input.trim();
				const command = trimmed.toLowerCase();
				if (!trimmed || command === "status") {
					return formatStatus();
				}
				if (
					command === "off" ||
					command === "clear" ||
					command === "stop" ||
					command === "disable"
				) {
					clearAllGoals();
					return "Goal disabled. Cleared pending and active goals.";
				}
				setPendingGoal(trimmed);
				return {
					reply: `Goal set: ${trimmed}`,
					submitPrompt: trimmed,
				};
			},
		});

		api.registerRule({
			id: "goal:active-goal",
			source: PLUGIN_NAME,
			content: activeGoalRule,
		});

		api.registerTool(
			createTool<unknown, Record<string, unknown>>({
				name: "mark_goal_complete",
				description:
					"Mark the active goal complete only after the follow-up verification prompt explicitly asks whether the goal is complete.",
				inputSchema: {
					type: "object",
					properties: {
						summary: {
							type: "string",
							description:
								"Concise summary of what was completed for the active goal. Only provide this after the verification prompt asks you to confirm completion.",
						},
					},
					additionalProperties: false,
				},
				retryable: false,
				async execute(input, context) {
					const { summary } = parseToolInput(input);
					const result = completeGoal(resolveToolSessionId(context), summary);
					if ("blocked" in result) {
						return {
							completed: false,
							message:
								result.blocked === "not_ready"
									? "Do not call mark_goal_complete until the follow-up verification prompt asks whether the goal is complete."
									: "No active goal was found for this session.",
						};
					}
					return {
						completed: true,
						goal: result.completed.goal,
						summary: result.completed.summary ?? "",
					};
				},
			}),
		);
	},

	hooks: {
		beforeRun() {
			claimPendingGoal(setupSessionId);
			return undefined;
		},

		afterRun({ result }) {
			if (result.status !== "completed") {
				return;
			}
			const active = readActiveGoal(setupSessionId);
			if (!active) {
				return;
			}
			markAwaitingVerification(setupSessionId);
			emitQueueMessage(setupSessionId, verificationPrompt(active.goal));
		},
	},
};

export default plugin;
