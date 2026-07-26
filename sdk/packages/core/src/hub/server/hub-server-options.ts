import type { BasicLogger } from "@bedrock-coder/shared";
import type {
	PendingPromptsRuntimeService,
	RuntimeHost,
} from "../../runtime/host/runtime-host";
import type { CoreSettingsService } from "../../settings";
import type { HubOwnerContext } from "../discovery";

export interface HubWebSocketServerOptions {
	host?: string;
	port?: number;
	pathname?: string;
	owner?: HubOwnerContext;
	sessionHost?: RuntimeHost & Partial<PendingPromptsRuntimeService>;
	settingsService?: CoreSettingsService;
	/**
	 * Custom `fetch` implementation forwarded to the internally-constructed
	 * `LocalRuntimeHost` that executes incoming `session.create` traffic.
	 * Used by the AI gateway providers for every session that runs inside
	 * this hub process.
	 *
	 * Ignored when `sessionHost` is supplied — in that case the caller owns
	 * runtime construction and is responsible for wiring its own fetch.
	 */
	/**
	 * Structured logger forwarded to the internally-constructed local runtime.
	 * Ignored when `sessionHost` is supplied.
	 */
	logger?: BasicLogger;
}

export interface HubWebSocketServer {
	host: string;
	port: number;
	url: string;
	authToken: string;
	close(): Promise<void>;
}

export interface EnsureHubWebSocketServerOptions
	extends HubWebSocketServerOptions {
	allowPortFallback?: boolean;
}

export interface EnsuredHubWebSocketServerResult {
	server?: HubWebSocketServer;
	url: string;
	authToken?: string;
	action: "reuse" | "started";
}
