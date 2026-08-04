/**
 * Types for hub-owned connector supervision.
 *
 * A connector is a separate process holding third-party credentials (a Slack
 * socket, a Telegram poll loop). The hub supervises those processes: it is the
 * single authority on which instances may run, it reaps their state when they
 * die, and it restarts them with backoff. These records are what it reports
 * about that work.
 */

/** How a supervised connector process came under the hub's watch. */
export type SupervisedConnectorOrigin =
	/** The current hub spawned it, so it has a live child handle. */
	| "spawned"
	/** It predates the current hub, which adopted it by pid from its state file. */
	| "adopted";

export type SupervisedConnectorState =
	/** Process is alive as far as the hub can tell. */
	| "running"
	/** Died and is waiting out its restart backoff. */
	| "backoff"
	/** Died too many times in a row; the hub has given up restarting it. */
	| "failed"
	/** Stopped on request; the hub will not restart it. */
	| "stopped";

export type SupervisedConnectorRecord = {
	channel: string;
	instanceId: string;
	state: SupervisedConnectorState;
	origin: SupervisedConnectorOrigin;
	pid?: number;
	startedAt?: string;
	/** Consecutive restarts that have not yet been cleared by a stable run. */
	restarts: number;
	/** When the next restart attempt is due, while in "backoff". */
	nextRestartAt?: string;
	lastExitCode?: number;
	lastExitSignal?: string;
	lastError?: string;
};

export type ConnectorStartRequest = {
	channel: string;
	instanceId: string;
	/** Connector CLI arguments, excluding the channel name itself. */
	args: string[];
	/**
	 * Replace a running instance instead of reporting it as already running.
	 * Used by `connect --restart`.
	 */
	restart?: boolean;
};

export type ConnectorStartResult = {
	/** False when an instance was already running and `restart` was not set. */
	started: boolean;
	record: SupervisedConnectorRecord;
	/** Why `started` is false, when it is. */
	reason?: "already_running";
};

export type ConnectorStopRequest = {
	channel: string;
	instanceId: string;
	/** Stop auto-restarting this instance as well. Defaults to true. */
	disableAutostart?: boolean;
};

export type ConnectorStopResultPayload = {
	stopped: boolean;
	channel: string;
	instanceId: string;
};
