import { ensureDetachedHubServer, HubUIClient } from "@cline/core";
import { type ClineDeepLinkAction, parseClineDeepLink } from "@cline/shared";
import { resolveWorkspaceRoot } from "../utils/helpers";

export interface DeepLinkCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

export interface HandleDeepLinkOptions {
	url: string;
	cwd?: string;
	io: DeepLinkCommandIo;
	openInHub?: (
		url: string,
		workspaceRoot: string,
	) => Promise<ClineDeepLinkAction>;
}

async function openInDefaultHub(
	url: string,
	workspaceRoot: string,
): Promise<ClineDeepLinkAction> {
	const hub = await ensureDetachedHubServer(workspaceRoot);
	const client = new HubUIClient({
		address: hub.url,
		authToken: hub.authToken,
		clientType: "cline-deep-link",
		displayName: "Cline URL Handler",
	});
	try {
		await client.connect();
		return await client.openDeepLink(url);
	} finally {
		await client.dispose();
	}
}

export async function handleDeepLink(
	options: HandleDeepLinkOptions,
): Promise<number> {
	const url = options.url.trim();
	if (!parseClineDeepLink(url)) {
		options.io.writeErr("Unsupported or invalid cline:// link.");
		return 1;
	}
	const cwd = options.cwd?.trim() || process.cwd();
	const workspaceRoot = resolveWorkspaceRoot(cwd);
	try {
		const action = await (options.openInHub ?? openInDefaultHub)(
			url,
			workspaceRoot,
		);
		options.io.writeln(`Forwarded Cline link to Hub (${action.type}).`);
		return 0;
	} catch (error) {
		options.io.writeErr(
			`Failed to forward Cline link to Hub: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		return 1;
	}
}
