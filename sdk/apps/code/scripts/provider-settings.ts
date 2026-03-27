import { readFileSync } from "node:fs";
import type { RpcProviderActionRequest } from "@clinebot/core";
import {
	addLocalProvider,
	ensureCustomProvidersLoaded,
	getLocalProviderModels,
	listLocalProviders,
	ProviderSettingsManager,
	saveLocalProviderSettings,
} from "@clinebot/core";

function readStdin(): string {
	return readFileSync(0, "utf8");
}

async function main() {
	const parsed = JSON.parse(readStdin()) as RpcProviderActionRequest;
	const manager = new ProviderSettingsManager();
	await ensureCustomProvidersLoaded(manager);

	if (parsed.action === "listProviders") {
		process.stdout.write(
			`${JSON.stringify(await listLocalProviders(manager))}\n`,
		);
		return;
	}
	if (parsed.action === "getProviderModels") {
		process.stdout.write(
			`${JSON.stringify(await getLocalProviderModels(parsed.providerId))}\n`,
		);
		return;
	}
	if (parsed.action === "addProvider") {
		process.stdout.write(
			`${JSON.stringify(await addLocalProvider(manager, parsed))}\n`,
		);
		return;
	}
	if (parsed.action === "saveProviderSettings") {
		process.stdout.write(
			`${JSON.stringify(saveLocalProviderSettings(manager, parsed))}\n`,
		);
		return;
	}
	throw new Error(`unsupported provider action: ${String(parsed.action)}`);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
