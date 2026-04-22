import {
	type EnsuredHubWebSocketServerResult,
	type EnsureHubWebSocketServerOptions,
	ensureHubWebSocketServer,
	type HubWebSocketServer,
	type HubWebSocketServerOptions,
	resolveSharedHubOwnerContext,
	startHubWebSocketServer,
} from "@clinebot/core/hub";
import { resolveHubEndpointOptions } from "./defaults";

export type HubServer = HubWebSocketServer;
export type EnsureHubServerResult = EnsuredHubWebSocketServerResult;

export interface StartHubServerOptions
	extends Omit<HubWebSocketServerOptions, "owner"> {}

export interface EnsureHubServerOptions
	extends Omit<EnsureHubWebSocketServerOptions, "owner"> {}

export async function startHubServer(
	options: StartHubServerOptions,
): Promise<HubServer> {
	const endpoint = resolveHubEndpointOptions({
		host: options.host,
		port: options.port,
		pathname: options.pathname,
	});
	return await startHubWebSocketServer({
		...options,
		...endpoint,
		owner: resolveSharedHubOwnerContext(),
	});
}

export async function ensureHubServer(
	options: EnsureHubServerOptions,
): Promise<EnsureHubServerResult> {
	const endpoint = resolveHubEndpointOptions({
		host: options.host,
		port: options.port,
		pathname: options.pathname,
	});
	return await ensureHubWebSocketServer({
		...options,
		...endpoint,
		owner: resolveSharedHubOwnerContext(),
	});
}
