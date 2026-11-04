import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
export type HubCommandOptions = {
	/** Whether transport recovery may resend a request after dispatch. */
	retryAfterDispatch?: boolean;
	timeoutMs?: number | null;
	/** Synchronous local guard, checked after connection before each dispatch. */
	beforeDispatch?: () => void;
	/** Observes this attempt's correlation id after the local guard, before sending.
	 * Dispatch alone does not confirm that the server accepted the command. */
	onDispatch?: (requestId: string) => void;
};

export class HubCommandError extends Error {
	constructor(
		readonly command: HubCommandEnvelope["command"],
		readonly code: string | undefined,
		message: string,
	) {
		super(message);
		this.name = "HubCommandError";
	}
}

export interface HubCommandClient {
	command(
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
		sessionId?: string,
		options?: HubCommandOptions,
	): Promise<HubReplyEnvelope>;
}
export interface HubBrowserConnection {
	url: string;
	authToken: string;
	workspaceRoot: string;
}
