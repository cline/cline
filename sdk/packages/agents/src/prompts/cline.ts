import { basename, resolve } from "node:path";
import { buildClineSystemPrompt } from "@clinebot/shared";

export function getClineDefaultSystemPrompt(
	ide: string,
	cwd: string,
	providerId: string,
	metadata = "",
	rules = "",
	platform = (typeof process !== "undefined" && process?.platform) || "unknown",
) {
	return buildClineSystemPrompt({
		ide,
		platform,
		workspaceRoot: resolve(cwd),
		workspaceName: basename(cwd),
		metadata,
		rules,
		providerId,
	});
}
