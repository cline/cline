import { z } from "zod";
import { formatCloudCredential } from "../auth/credential";
import { type FetchLike, timeoutSignal } from "../http";

const integrationListSchema = z.object({
	success: z.literal(true),
	data: z.array(z.object({ provider: z.string() })),
});

const errorResponseSchema = z.object({
	error: z.string().optional(),
});

export type CloudGitHubAction = "connect" | "add-repositories";

export class CloudGitHubApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "CloudGitHubApiError";
	}
}

export interface CloudGitHubGatewayOptions {
	apiBaseUrl: string;
	getAccessToken(): Promise<string | null>;
	fetchImpl?: FetchLike;
}

/** Gets a signed GitHub redirect without following it inside native fetch. */
export class CloudGitHubGateway {
	constructor(private readonly options: CloudGitHubGatewayOptions) {}

	async resolveInstallUrl(
		organizationId?: string,
		action: CloudGitHubAction = "connect",
	): Promise<string> {
		const token = (await this.options.getAccessToken())?.trim();
		if (!token) {
			throw new CloudGitHubApiError(
				"Sign in to Cline Cloud to connect GitHub.",
				401,
			);
		}

		const organization = organizationId?.trim();
		if (organizationId !== undefined && !organization) {
			throw new CloudGitHubApiError("Choose an organization first.", 400);
		}

		let path: string;
		if (!organization) {
			path =
				action === "add-repositories"
					? "/api/v1/integrations/github/add-repositories"
					: "/api/v1/integrations/github/install";
		} else if (action === "add-repositories") {
			path = `/api/v1/organizations/${encodeURIComponent(organization)}/integrations/github/add-repositories`;
		} else {
			const integrations = await this.getOrganizationIntegrations(
				organization,
				token,
			);
			const hasGitHub = integrations.some(
				(integration) => integration.provider === "github",
			);
			path = `/api/v1/organizations/${encodeURIComponent(organization)}/integrations/github/${hasGitHub ? "connect" : "install"}`;
		}

		const response = await this.request(path, token);
		if (response.status === 403) {
			const detail = await this.errorDetail(response);
			const guidance =
				organization && path.endsWith("/github/install")
					? "Only an organization admin can install the Cline GitHub App. Ask an admin to connect GitHub for this organization."
					: organization && action === "add-repositories"
						? "Only an organization admin can change GitHub repository access. Ask an admin to add repositories for this organization."
						: organization
							? "You do not have permission to connect GitHub for this organization."
							: "Cline could not start the GitHub connection for your account.";
			throw new CloudGitHubApiError(
				detail ? `${guidance} ${detail}` : guidance,
				response.status,
			);
		}
		if (response.status !== 302) {
			const detail = await this.errorDetail(response);
			throw new CloudGitHubApiError(
				detail || "Cline could not prepare the GitHub connection. Try again.",
				response.status,
			);
		}

		const location = response.headers.get("location");
		if (!location) {
			throw new CloudGitHubApiError(
				"Cline returned no GitHub connection URL. Try again.",
				response.status,
			);
		}
		return this.validateGitHubUrl(location, response.status);
	}

	private async getOrganizationIntegrations(
		organizationId: string,
		token: string,
	): Promise<z.infer<typeof integrationListSchema>["data"]> {
		const response = await this.request(
			`/api/v1/organizations/${encodeURIComponent(organizationId)}/integrations`,
			token,
		);
		if (!response.ok) {
			const detail = await this.errorDetail(response);
			throw new CloudGitHubApiError(
				detail ||
					"Cline could not check this organization's GitHub connection.",
				response.status,
			);
		}
		const parsed = integrationListSchema.safeParse(await this.json(response));
		if (!parsed.success) {
			throw new CloudGitHubApiError(
				"Cline returned organization integrations this app could not read.",
				response.status,
			);
		}
		return parsed.data.data;
	}

	private async request(path: string, token: string): Promise<Response> {
		const fetchImpl = this.options.fetchImpl ?? (await this.nativeFetch());
		return fetchImpl(new URL(path, this.options.apiBaseUrl).toString(), {
			method: "GET",
			headers: { Authorization: `Bearer ${formatCloudCredential(token)}` },
			redirect: "manual",
			signal: timeoutSignal(30_000),
		});
	}

	private async nativeFetch(): Promise<FetchLike> {
		const { fetch } = await import("expo/fetch");
		return async (input, init) => fetch(input, init);
	}

	private async errorDetail(response: Response): Promise<string> {
		const parsed = errorResponseSchema.safeParse(await this.json(response));
		return parsed.success ? (parsed.data.error?.trim() ?? "") : "";
	}

	private async json(response: Response): Promise<unknown> {
		try {
			return await response.json();
		} catch {
			return undefined;
		}
	}

	private validateGitHubUrl(location: string, status: number): string {
		let url: URL;
		try {
			url = new URL(location);
		} catch {
			throw new CloudGitHubApiError(
				"Cline returned an invalid GitHub connection URL. Try again.",
				status,
			);
		}
		if (
			url.protocol !== "https:" ||
			url.hostname !== "github.com" ||
			url.origin !== "https://github.com" ||
			url.username ||
			url.password
		) {
			throw new CloudGitHubApiError(
				"Cline returned an unsafe GitHub connection URL. Try again.",
				status,
			);
		}
		return url.toString();
	}
}
