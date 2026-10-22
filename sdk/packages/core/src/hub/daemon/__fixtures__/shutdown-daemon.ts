import { join } from "node:path";
import type { HubScheduleRuntimeHandlers } from "../../../cron/service/schedule-service";
import type { RuntimeHost } from "../../../runtime/host/runtime-host";
import { startHubWebSocketServer } from "../../server";
import {
	createHubDaemonShutdownCoordinator,
	HUB_DAEMON_SHUTDOWN_DEADLINE_MS,
} from "../shutdown-coordinator";

const discoveryPath = process.env.CLINE_HUB_DISCOVERY_PATH?.trim();
const dataDir = process.env.CLINE_DATA_DIR?.trim();
const port = Number(process.env.CLINE_HUB_TEST_PORT);
const bunVersion = (process.versions as { bun?: string }).bun;

if (
	!discoveryPath ||
	!dataDir ||
	!Number.isInteger(port) ||
	port < 0 ||
	!bunVersion
) {
	throw new Error("Invalid shutdown daemon fixture environment");
}

const unusedRuntimeMethod = async (): Promise<never> => {
	throw new Error("The shutdown fixture does not execute sessions");
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

let requestShutdown: (() => void) | undefined;
let shutdownPending = false;
const server = await startHubWebSocketServer({
	host: "127.0.0.1",
	port,
	pathname: "/hub",
	owner: { ownerId: "shutdown-e2e-fixture", discoveryPath },
	sessionHost,
	runtimeHandlers,
	scheduleOptions: { dbPath: join(dataDir, "schedules.db") },
	onShutdownRequested: () => {
		if (requestShutdown) {
			requestShutdown();
			return;
		}
		shutdownPending = true;
	},
});
process.stderr.write(`[shutdown-fixture] runtime: bun ${bunVersion}\n`);

const coordinator = createHubDaemonShutdownCoordinator({
	deadlineMs: HUB_DAEMON_SHUTDOWN_DEADLINE_MS,
	cleanup: () => server.close(),
	exit: (code) => process.exit(code),
	onForcedExit: ({ reason }) => {
		process.stderr.write(`[shutdown-fixture] forced exit: ${reason}\n`);
	},
});
requestShutdown = () => {
	void coordinator.request({
		reason: "authenticated HTTP shutdown request",
		exitCode: 0,
	});
};
if (shutdownPending) {
	requestShutdown();
}

let signalCount = 0;
const handleSignal = (signal: "SIGINT" | "SIGTERM"): void => {
	signalCount += 1;
	if (signalCount > 1) {
		coordinator.force({
			reason: `second termination signal (${signal})`,
			exitCode: 0,
		});
		return;
	}
	void coordinator.request({ reason: signal, exitCode: 0 });
};
process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));

await new Promise<void>(() => undefined);
