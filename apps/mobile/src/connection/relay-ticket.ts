import { z } from "zod";
import { formatCloudCredential } from "@/cloud/auth/credential";
import {
	type FetchLike,
	readJson,
	resolveFetch,
	timeoutSignal,
} from "@/cloud/http";
import { errorDetail } from "@/error-message";

const relayTicketEnvelopeSchema = z.looseObject({
	success: z.literal(true),
	data: z.looseObject({
		token: z.string().min(1),
		expiresAt: z.string().min(1),
	}),
});

export class RelayTicketError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "RelayTicketError";
	}
}

export interface RequestRelayTicketOptions {
	apiBaseUrl: string;
	getAccessToken(): Promise<string | null>;
	machineId: string;
	role: "host" | "client";
	fetchImpl?: FetchLike;
	requestTimeoutMs?: number;
}

/**
 * Exchanges the user's account credential for a one-use, machine/role-scoped
 * relay ticket. The broad WorkOS credential stops at Cloud API and is never
 * presented to the blind relay.
 */
export async function requestRelayTicket(
	options: RequestRelayTicketOptions,
): Promise<string> {
	const accessToken = await options.getAccessToken();
	if (!accessToken) {
		throw new RelayTicketError("Sign in to Cline to reach this computer.", 401);
	}
	const response = await resolveFetch(options.fetchImpl)(
		`${options.apiBaseUrl}/api/v1/machines/${encodeURIComponent(options.machineId)}/relay-ticket`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${formatCloudCredential(accessToken)}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ role: options.role }),
			signal: timeoutSignal(options.requestTimeoutMs ?? 15_000),
		},
	);
	const json = await readJson(response);
	if (!response.ok) {
		const detail =
			json && typeof json === "object" && "error" in json
				? errorDetail((json as { error?: unknown }).error)
				: undefined;
		throw new RelayTicketError(
			`Cline could not authorize this computer${detail ? `: ${detail}` : "."}`,
			response.status,
		);
	}
	const parsed = relayTicketEnvelopeSchema.safeParse(json);
	if (!parsed.success) {
		throw new RelayTicketError(
			"Cline returned an unreadable relay authorization.",
			response.status,
		);
	}
	return parsed.data.data.token;
}
