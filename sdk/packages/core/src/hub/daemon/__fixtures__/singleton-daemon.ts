/**
 * E2E fixture for the OS-backed singleton lock: starts a minimal hub server
 * for the owner context named by the environment and, like the production
 * daemon entry, exits with code 3 when a live Hub already holds the lock —
 * never touching the incumbent.
 */

import { join } from "node:path";
import type { HubScheduleRuntimeHandlers } from "../../../cron/service/schedule-service";
import type { RuntimeHost } from "../../../runtime/host/runtime-host";
import {
	HUB_LOCK_HELD_EXIT_CODE,
	isHubLockHeldError,
} from "../../discovery/instance-lock";
import { startHubWebSocketServer } from "../../server";

const discoveryPath = process.env.CLINE_HUB_DISCOVERY_PATH?.trim();
const dataDir = process.env.CLINE_DATA_DIR?.trim();
const port = Number(process.env.CLINE_HUB_TEST_PORT);

if (!discoveryPath || !dataDir || !Number.isInteger(port) || port < 0) {
	throw new Error("Invalid singleton daemon fixture environment");
}

const unusedRuntimeMethod = async (): Promise<never> => {
	throw new Error("The singleton fixture does not execute sessions");
};

const sessionHost = {
	subscribe: () => () => undefined,
	dispose: async () => undefined,
	startSession: unusedRuntimeMethod,
	runTurn: unusedRuntimeMethod,
	restoreSession: unusedRuntimeMethod,
	abort: unusedRuntimeMethod,
	stopSession: unusedRuntimeMethod,
	getSession: unusedRuntimeMethod,
	listSessions: unusedRuntimeMethod,
	deleteSession: unusedRuntimeMethod,
	updateSession: unusedRuntimeMethod,
	updateSessionCompactionState: unusedRuntimeMethod,
	readSessionCompactionState: unusedRuntimeMethod,
	readSessionMessages: unusedRuntimeMethod,
	dispatchHookEvent: unusedRuntimeMethod,
} as unknown as RuntimeHost;

const runtimeHandlers: HubScheduleRuntimeHandlers = {
	startSession: unusedRuntimeMethod,
	sendSession: unusedRuntimeMethod,
	abortSession: unusedRuntimeMethod,
	stopSession: unusedRuntimeMethod,
};

try {
	await startHubWebSocketServer({
		host: "127.0.0.1",
		port,
		pathname: "/hub",
		owner: { ownerId: "singleton-e2e-fixture", discoveryPath },
		sessionHost,
		runtimeHandlers,
		scheduleOptions: { dbPath: join(dataDir, "schedules.db") },
		eventLog: { dbPath: join(dataDir, "hub-events.db") },
		runQueue: { dbPath: join(dataDir, "hub-runs.db") },
	});
	process.stderr.write("[singleton-fixture] serving\n");
} catch (error) {
	if (isHubLockHeldError(error)) {
		process.stderr.write("[singleton-fixture] lock held by a live hub\n");
		process.exit(HUB_LOCK_HELD_EXIT_CODE);
	}
	throw error;
}

await new Promise<void>(() => undefined);
