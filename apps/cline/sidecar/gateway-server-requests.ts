import {
	type GatewayServerRequest,
	SERVER_REQUEST_METHODS,
} from "@cline/shared/gateway";
import { type HostCommandResult, handleHostCommand } from "./host-commands";
import type { SidecarContext } from "./types";

type HostCommandHandler = (
	ctx: Pick<SidecarContext, "client" | "workspaceRoot" | "workspaceRootLocked">,
	command: string,
	args?: Record<string, unknown>,
) => Promise<HostCommandResult>;

export type ImmediateServerRequestResult =
	| { readonly handled: false }
	| { readonly handled: true; readonly result: { readonly opened: true } };

function oauthAuthorizationUrl(value: unknown): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error("The Gateway did not provide a Cline authorization URL");
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error("The Gateway provided an invalid Cline authorization URL");
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
		throw new Error(
			"Cline authorization URLs must use the http or https protocol",
		);
	}
	if (parsed.username || parsed.password) {
		throw new Error("Cline authorization URLs cannot contain credentials");
	}
	return parsed.toString();
}

/** Handle host-only Gateway requests without placing them in the UI queue. */
export async function handleImmediateGatewayServerRequest(
	ctx: Pick<SidecarContext, "client" | "workspaceRoot" | "workspaceRootLocked">,
	request: GatewayServerRequest,
	hostCommand: HostCommandHandler = handleHostCommand,
): Promise<ImmediateServerRequestResult> {
	if (request.method !== SERVER_REQUEST_METHODS.openExternalUrl) {
		return { handled: false };
	}
	const targetClientId = request.params?.targetClientId;
	if (
		typeof targetClientId !== "string" ||
		targetClientId !== ctx.client.hello.clientId
	) {
		throw new Error(
			"The Cline authorization request was not addressed to this desktop client",
		);
	}
	const result = await hostCommand(ctx, "open_external_url", {
		url: oauthAuthorizationUrl(request.params?.url),
	});
	if (
		!result.handled ||
		!result.result ||
		typeof result.result !== "object" ||
		(result.result as { opened?: unknown }).opened !== true
	) {
		throw new Error("The desktop host could not open the Cline sign-in page");
	}
	return { handled: true, result: { opened: true } };
}
