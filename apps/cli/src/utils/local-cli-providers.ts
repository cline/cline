import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const OPENAI_CODEX_CLI_PROVIDER_ID = "openai-codex-cli";
const CLAUDE_CODE_PROVIDER_ID = "claude-code";

/**
 * A provider that runs a locally installed CLI and authenticates from that
 * CLI's own credential store, so Cline never stores or sends an API key.
 * These are the providers carrying the `local-auth` capability; setup is a
 * readiness check on the executable rather than a credential form.
 */
export interface LocalCliProvider {
	providerId: string;
	/** Name of the CLI the user installs, used in setup copy. */
	cliName: string;
	/** Executable probed on PATH with `--version`. */
	executable: string;
	installUrl: string;
}

const LOCAL_CLI_PROVIDERS: LocalCliProvider[] = [
	{
		providerId: OPENAI_CODEX_CLI_PROVIDER_ID,
		cliName: "Codex CLI",
		executable: "codex",
		installUrl: "https://developers.openai.com/codex/cli",
	},
	{
		providerId: CLAUDE_CODE_PROVIDER_ID,
		cliName: "Claude Code",
		executable: "claude",
		installUrl: "https://code.claude.com/docs/en/setup",
	},
];

export type LocalCliStatus =
	| {
			installed: true;
			version: string;
	  }
	| {
			installed: false;
			reason: string;
	  };

export function getLocalCliProvider(
	providerId: string,
): LocalCliProvider | undefined {
	const normalized = providerId.trim().toLowerCase();
	return LOCAL_CLI_PROVIDERS.find((p) => p.providerId === normalized);
}

export function isLocalCliProvider(providerId: string): boolean {
	return getLocalCliProvider(providerId) !== undefined;
}

export function listLocalCliProviders(): readonly LocalCliProvider[] {
	return LOCAL_CLI_PROVIDERS;
}

export async function checkLocalCliInstalled(
	provider: LocalCliProvider,
): Promise<LocalCliStatus> {
	try {
		const result = await execFileAsync(provider.executable, ["--version"], {
			timeout: 3000,
			windowsHide: true,
		});
		const version = (result.stdout || result.stderr).trim();
		return {
			installed: true,
			version: version || provider.executable,
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
				reason: `The ${provider.executable} executable was not found on PATH.`,
			};
		}
		const message =
			typeof details?.message === "string"
				? details.message
				: `Could not run ${provider.executable} --version.`;
		return {
			installed: false,
			reason: message,
		};
	}
}
