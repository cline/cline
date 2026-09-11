import type { AgentPlugin, BasicLogger } from "@cline/core";
import { makeDashboardHandoffMessage } from "./format";
import {
	markGitHubPrDashboardSnapshotApplied,
	runGitHubPrDashboardGate,
} from "./gate";

let setupLogger: BasicLogger | undefined;

interface PendingDashboardHandoff {
	text: string;
	snapshotHash: string;
	statePath: string;
	injected: boolean;
}

const pendingDashboardHandoffs = new Map<string, PendingDashboardHandoff>();

export function resolveDashboardHandoffKey(snapshot: {
	runId?: string;
	conversationId?: string;
	agentId: string;
}): string {
	return snapshot.runId ?? snapshot.conversationId ?? snapshot.agentId;
}

const plugin: AgentPlugin = {
	name: "github-pr-dashboard-gate",
	manifest: {
		capabilities: ["hooks"],
	},

	setup(_api, ctx) {
		setupLogger = ctx.logger;
	},

	hooks: {
		async beforeRun({ snapshot }) {
			const result = await runGitHubPrDashboardGate({ logger: setupLogger });
			const key = resolveDashboardHandoffKey(snapshot);
			if (result.stop) {
				pendingDashboardHandoffs.delete(key);
				return { stop: true, reason: result.reason };
			}
			if (result.handoffText) {
				pendingDashboardHandoffs.set(key, {
					text: result.handoffText,
					snapshotHash: result.snapshotHash ?? "",
					statePath: result.statePath ?? "",
					injected: false,
				});
			} else {
				pendingDashboardHandoffs.delete(key);
			}
			return { reason: result.reason };
		},

		beforeModel({ request, snapshot }) {
			const key = resolveDashboardHandoffKey(snapshot);
			const pending = pendingDashboardHandoffs.get(key);
			if (!pending || pending.injected) return undefined;
			pending.injected = true;
			return {
				messages: [
					...request.messages,
					makeDashboardHandoffMessage(pending.text),
				],
			};
		},

		afterRun({ result, snapshot }) {
			const key = resolveDashboardHandoffKey(snapshot);
			const pending = pendingDashboardHandoffs.get(key);
			if (result.status !== "completed") {
				pendingDashboardHandoffs.delete(key);
				return;
			}
			if (!pending?.snapshotHash || !pending.statePath) return;
			markGitHubPrDashboardSnapshotApplied({
				snapshotHash: pending.snapshotHash,
				statePath: pending.statePath,
			});
			pendingDashboardHandoffs.delete(key);
		},
	},
};

export { plugin };
export default plugin;
export {
	formatDashboardHandoff,
	renderDashboardHtml,
	renderDashboardMarkdown,
} from "./format";
export type {
	ApplyGitHubPrDashboardSnapshotOptions,
	GitHubPrDashboardGateOptions,
	GitHubPrDashboardGateResult,
} from "./gate";
export {
	markGitHubPrDashboardSnapshotApplied,
	runGitHubPrDashboardGate,
} from "./gate";
export {
	fetchGitHubPrDashboardData,
	normalizePullRequest,
	normalizeReview,
} from "./github";
export { buildDashboardSnapshot, hashDashboardSnapshot } from "./metrics";
export type { GitHubPrDashboardRun, GitHubPrDashboardSnapshot } from "./schema";
export type { GitHubPrDashboardState } from "./state";
