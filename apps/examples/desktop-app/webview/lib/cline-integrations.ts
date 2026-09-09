import { isClineAccountNotAuthenticatedResult } from "@/lib/cline-account-state";
import type {
	ClineGitHubRepository,
	ClineIntegration,
} from "@/lib/cline-integrations-types";
import { desktopClient } from "@/lib/desktop-client";

export * from "@/lib/cline-integrations-types";

export type ClineIntegrationsListResult =
	| { status: "ok"; integrations: ClineIntegration[] }
	| { status: "not-authenticated" };

export async function listClineIntegrations(): Promise<ClineIntegrationsListResult> {
	const result = await desktopClient.invoke("cline_integrations", {
		operation: "list",
	});
	if (isClineAccountNotAuthenticatedResult(result)) {
		return { status: "not-authenticated" };
	}
	return {
		status: "ok",
		integrations: Array.isArray(result) ? (result as ClineIntegration[]) : [],
	};
}

export async function listClineGitHubRepositories(): Promise<
	ClineGitHubRepository[]
> {
	const result = await desktopClient.invoke("cline_integrations", {
		operation: "listGitHubRepositories",
	});
	return Array.isArray(result) ? (result as ClineGitHubRepository[]) : [];
}

export async function fetchGitHubInstallUrl(): Promise<string> {
	const result = await desktopClient.invoke("cline_integrations", {
		operation: "githubInstallUrl",
	});
	if (isClineAccountNotAuthenticatedResult(result)) {
		throw new Error("sign in to your Cline account first");
	}
	const url = (result as { url?: unknown } | null)?.url;
	if (typeof url !== "string" || !url.trim()) {
		throw new Error("no GitHub install URL was returned");
	}
	return url;
}
