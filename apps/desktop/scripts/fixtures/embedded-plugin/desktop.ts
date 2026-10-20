import type { AgentPlugin } from "@cline/sdk";
import { CLINE_DEFAULT_MODEL_ID } from "@cline/shared/browser";

export default {
	name: "packaged-backend-smoke",
	manifest: { capabilities: ["commands"] },
	setup(api) {
		if (typeof CLINE_DEFAULT_MODEL_ID !== "string")
			throw new Error("Missing SDK browser exports");
		api.registerCommand({ name: "packaged-ping", handler: () => "pong" });
	},
} satisfies AgentPlugin;
