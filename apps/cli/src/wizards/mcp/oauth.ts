import * as p from "@clack/prompts";
import {
	authorizeMcpServerOAuth,
	resolveDefaultMcpSettingsPath,
} from "@cline/core";
import open from "open";

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const message = error.message.trim();
		if (message.length > 0) {
			return message;
		}
	}
	return String(error);
}

export async function authorizeMcpServerOAuthWithBrowser(
	name: string,
	options: { throwOnError?: boolean } = {},
): Promise<void> {
	p.log.info("Opening browser for MCP OAuth authorization");
	try {
		const result = await authorizeMcpServerOAuth({
			serverName: name,
			filePath: resolveDefaultMcpSettingsPath(),
			openUrl: async (url) => {
				p.log.message(`Authorization URL: ${url}`);
				await open(url, { wait: false });
			},
			onServerListening: (info) => {
				p.log.message(`Waiting for OAuth callback at ${info.callbackUrl}`);
			},
		});
		p.log.success(result.message);
	} catch (error) {
		if (options.throwOnError === true) {
			throw error instanceof Error ? error : new Error(toErrorMessage(error));
		}
		p.log.error(`OAuth authorization failed: ${toErrorMessage(error)}`);
		p.log.warn(
			`Server "${name}" is still saved. Choose "Authorize OAuth" to retry.`,
		);
	}
}
