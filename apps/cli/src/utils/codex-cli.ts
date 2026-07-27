import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const OPENAI_CODEX_CLI_PROVIDER_ID = "openai-codex-cli";
export const CODEX_CLI_INSTALL_URL = "https://developers.openai.com/codex/cli";

export type CodexCliStatus =
	| {
			installed: true;
			version: string;
	  }
	| {
			installed: false;
			reason: string;
	  };

export function isOpenAICodexCliProvider(providerId: string): boolean {
	return providerId.trim().toLowerCase() === OPENAI_CODEX_CLI_PROVIDER_ID;
}

export async function checkCodexCliInstalled(): Promise<CodexCliStatus> {
	try {
		const result = await execFileAsync("codex", ["--version"], {
			timeout: 3000,
			windowsHide: true,
		});
		const version = (result.stdout || result.stderr).trim();
		return {
			installed: true,
			version: version || "codex",
		};
	} catch (error) {
		const details =
			error && typeof error === "object"
				? (error as { code?: unknown; message?: unknown })
				: undefined;
		const code = typeof details?.code === "string" ? details.code : "";
		if (code === "ENOENT") {
			return {
				installed: false,
				reason: "The codex executable was not found on PATH.",
			};
		}
		const message =
			typeof details?.message === "string"
				? details.message
				: "Could not run codex --version.";
		return {
			installed: false,
			reason: message,
		};
	}
}
