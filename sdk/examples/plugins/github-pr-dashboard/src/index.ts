import type { AgentPlugin, BasicLogger } from "@cline/core";
import { makeDashboardHandoffMessage } from "./format";
import { runGitHubPrDashboardGate } from "./gate";

let setupLogger: BasicLogger | undefined;
let pendingDashboardHandoff: string | undefined;
let handoffInjected = false;

const plugin: AgentPlugin = {
	name: "github-pr-dashboard-gate",
	manifest: {
		capabilities: ["hooks"],
	},

	setup(_api, ctx) {
		setupLogger = ctx.logger;
	},

	hooks: {
		async beforeRun() {
			const result = await runGitHubPrDashboardGate({ logger: setupLogger });
			if (result.stop) {
				pendingDashboardHandoff = undefined;
				handoffInjected = false;
				return { stop: true, reason: result.reason };
			}
			pendingDashboardHandoff = result.handoffText;
			handoffInjected = false;
			return { reason: result.reason };
		},

		beforeModel({ request }) {
			if (!pendingDashboardHandoff || handoffInjected) return undefined;
			handoffInjected = true;
			return {
				messages: [
					...request.messages,
					makeDashboardHandoffMessage(pendingDashboardHandoff),
				],
			};
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
	GitHubPrDashboardGateOptions,
	GitHubPrDashboardGateResult,
} from "./gate";
export { runGitHubPrDashboardGate } from "./gate";
export {
	fetchGitHubPrDashboardData,
	normalizePullRequest,
	normalizeReview,
} from "./github";
export { buildDashboardSnapshot, hashDashboardSnapshot } from "./metrics";
export type { GitHubPrDashboardRun, GitHubPrDashboardSnapshot } from "./schema";
export type { GitHubPrDashboardState } from "./state";
