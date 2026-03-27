import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import type { RpcProviderOAuthLoginResponse } from "@clinebot/core";
import {
	loginLocalProvider,
	normalizeOAuthProvider,
	ProviderSettingsManager,
	saveLocalProviderOAuthCredentials,
} from "@clinebot/core";

type RequestBody = {
	provider: string;
};

function readStdin(): string {
	return readFileSync(0, "utf8");
}

async function main() {
	const parsed = JSON.parse(readStdin()) as RequestBody;
	const provider = parsed.provider?.trim();
	if (!provider) {
		throw new Error("provider is required");
	}
	const providerId = normalizeOAuthProvider(provider);
	const manager = new ProviderSettingsManager();
	const existing = manager.getProviderSettings(providerId);
	const credentials = await loginLocalProvider(providerId, existing, (url) => {
		const platform = process.platform;
		const command =
			platform === "darwin"
				? "open"
				: platform === "win32"
					? "cmd"
					: "xdg-open";
		const args =
			platform === "darwin"
				? [url]
				: platform === "win32"
					? ["/c", "start", "", url]
					: [url];
		const child = spawn(command, args, {
			stdio: "ignore",
			detached: true,
		});
		child.unref();
	});
	const saved = saveLocalProviderOAuthCredentials(
		manager,
		providerId,
		existing,
		credentials,
	);
	const response: RpcProviderOAuthLoginResponse = {
		provider: providerId,
		accessToken: saved.auth?.accessToken ?? saved.apiKey ?? "",
	};
	process.stdout.write(
		`${JSON.stringify({ provider: response.provider, accessToken: response.accessToken })}\n`,
	);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
