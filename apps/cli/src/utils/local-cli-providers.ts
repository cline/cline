import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as LlmsModels from "@cline/llms";

const execFileAsync = promisify(execFile);

/**
 * A provider whose transport is a locally installed CLI, which authenticates
 * from that CLI's own credential store so Cline never stores or sends an API
 * key. Setup is a readiness check on the executable rather than a credential
 * form.
 *
 * Everything here is read from the provider spec in `@cline/llms` — the CLI
 * keeps no list of its own, so a new local-auth provider needs no change on
 * this side.
 */
export interface LocalCliProvider {
	providerId: string;
	/** Provider name, used in setup copy. */
	cliName: string;
	/** Executable probed on PATH with `--version`. */
	executable: string;
	/** Where to install the CLI, shown when the probe finds nothing. */
	installUrl?: string;
}

export type LocalCliStatus =
	| {
			installed: true;
			version: string;
	  }
	| {
			installed: false;
			reason: string;
	  };

function toLocalCliProvider(
	collection: LlmsModels.ModelCollection | undefined,
): LocalCliProvider | undefined {
	const provider = collection?.provider;
	// Both are required to run setup at all: the capability decides that this
	// provider authenticates locally, the executable is what we probe for.
	if (!provider?.capabilities?.includes("local-auth")) return undefined;
	if (!provider.executable) return undefined;
	return {
		providerId: provider.id,
		cliName: provider.name,
		executable: provider.executable,
		installUrl: provider.docsUrl,
	};
}

export function getLocalCliProvider(
	providerId: string,
): LocalCliProvider | undefined {
	const id = LlmsModels.normalizeProviderId(providerId);
	return toLocalCliProvider(LlmsModels.MODEL_COLLECTIONS_BY_PROVIDER_ID[id]);
}

export function listLocalCliProviders(): readonly LocalCliProvider[] {
	return Object.values(LlmsModels.MODEL_COLLECTIONS_BY_PROVIDER_ID)
		.map(toLocalCliProvider)
		.filter((provider): provider is LocalCliProvider => provider !== undefined);
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
		const details = error as NodeJS.ErrnoException | undefined;
		if (details?.code === "ENOENT") {
			return {
				installed: false,
				reason: `The ${provider.executable} executable was not found on PATH.`,
			};
		}
		return {
			installed: false,
			reason:
				error instanceof Error
					? error.message
					: `Could not run ${provider.executable} --version.`,
		};
	}
}
