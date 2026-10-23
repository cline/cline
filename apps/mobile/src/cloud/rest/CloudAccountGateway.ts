import { z } from "zod";
import { formatCloudCredential } from "../auth/credential";
import { timeoutSignal } from "../http";
import { CloudSessionApiError } from "./CloudSessionGateway";

const accountSchema = z.object({
	data: z.object({
		organizations: z
			.array(
				z.object({
					organizationId: z.string().min(1),
					name: z.string().min(1),
					active: z.boolean(),
				}),
			)
			.default([]),
	}),
});

export type CloudAccount = {
	organizationId?: string;
	name: string;
	active: boolean;
};

/** Existing account APIs, shared with desktop. Never import the Node SDK in RN. */
export class CloudAccountGateway {
	constructor(
		private readonly options: {
			apiBaseUrl: string;
			getAccessToken(): Promise<string | null>;
			fetch?: typeof fetch;
		},
	) {}

	private async request(path: string, init?: RequestInit): Promise<Response> {
		const token = await this.options.getAccessToken();
		if (!token)
			throw new CloudSessionApiError(
				"Sign in to Cline Cloud to continue.",
				401,
			);
		const response = await (this.options.fetch ?? globalThis.fetch)(
			new URL(path, this.options.apiBaseUrl).toString(),
			{
				...init,
				headers: {
					Authorization: `Bearer ${formatCloudCredential(token)}`,
					"Content-Type": "application/json",
				},
				signal: timeoutSignal(30_000),
			},
		);
		if (!response.ok)
			throw new CloudSessionApiError(
				"Your Cline accounts could not be loaded or updated. Try again.",
				response.status,
			);
		return response;
	}

	async listAccounts(): Promise<CloudAccount[]> {
		const response = await this.request("/api/v1/users/me");
		const parsed = accountSchema.safeParse(await response.json());
		if (!parsed.success)
			throw new Error(
				"Cline returned account details this app could not read. Try again.",
			);
		const organizations = parsed.data.data.organizations;
		return [
			{ name: "Personal", active: !organizations.some((org) => org.active) },
			...organizations,
		];
	}

	async switchAccount(organizationId?: string): Promise<void> {
		await this.request("/api/v1/users/active-account", {
			method: "PUT",
			body: JSON.stringify({ organizationId: organizationId ?? null }),
		});
	}
}
