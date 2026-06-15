import type { AgentPlugin, BasicLogger } from "@cline/core";
import { runGmailWorkGate } from "./gate";

let setupLogger: BasicLogger | undefined;

const plugin: AgentPlugin = {
	name: "gmail-work-to-do-gate",
	manifest: {
		capabilities: ["hooks"],
	},

	setup(_api, ctx) {
		setupLogger = ctx.logger;
	},

	hooks: {
		beforeRun() {
			return runGmailWorkGate({ logger: setupLogger });
		},
	},
};

export { plugin };
export default plugin;
export {
	advanceStateForProcessedMessages,
	selectNewMessages,
} from "./dedupe";
export { runGmailWorkGate } from "./gate";
export type { GmailFetchedMessage } from "./gmail";
export type { GmailWorkState } from "./state";
