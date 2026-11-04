/**
 * E2E fixture for resuming a session over the real hub wire: starts a minimal
 * hub server whose session host holds a small stored history and records how
 * many messages `startSession` receives, so a test can tell whether the
 * transcript arrived inline or the hub loaded the stored one itself. It runs
 * under Bun, so Bun's inbound frame limit applies exactly as it does for the
 * shipped hub.
 */

import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { HubScheduleRuntimeHandlers } from "../../../cron/service/schedule-service";
import type {
	RuntimeHost,
	StartSessionInput,
} from "../../../runtime/host/runtime-host";
import { startHubWebSocketServer } from "../../server";

const discoveryPath = process.env.CLINE_HUB_DISCOVERY_PATH?.trim();
const dataDir = process.env.CLINE_DATA_DIR?.trim();
const port = Number(process.env.CLINE_HUB_TEST_PORT);

if (!discoveryPath || !dataDir || !Number.isInteger(port) || port < 0) {
	throw new Error("Invalid resume daemon fixture environment");
}

const startCallsPath = join(dataDir, "start-calls.jsonl");
const now = new Date().toISOString();

// What the hub has saved for every session. Three messages, so a test can tell
// it apart from any transcript a client holds.
const storedHistory = [
	{ role: "user", content: "stored prompt" },
	{ role: "assistant", content: "stored reply" },
	{ role: "user", content: "stored follow-up" },
];

const unusedRuntimeMethod = async (): Promise<never> => {
	throw new Error("The resume fixture does not execute sessions");
};

const sessionRecord = (sessionId: string) => ({
	sessionId,
	source: "desktop",
	startedAt: now,
	updatedAt: now,
	status: "idle",
	interactive: true,
	provider: "openai",
	model: "gpt-4.1",
	cwd: dataDir,
	workspaceRoot: dataDir,
	enableTools: false,
	enableSpawn: false,
	enableTeams: false,
});

const sessionHost = {
	subscribe: () => () => undefined,
	dispose: async () => undefined,
	startSession: async (input: StartSessionInput) => {
		const sessionId = input.config.sessionId ?? "resume-fixture-session";
		appendFileSync(
			startCallsPath,
			`${JSON.stringify({
				sessionId,
				initialMessages: input.initialMessages?.length ?? 0,
			})}\n`,
		);
		return {
			sessionId,
			manifest: sessionRecord(sessionId),
			manifestPath: join(dataDir, `${sessionId}.json`),
			messagesPath: join(dataDir, `${sessionId}.messages.json`),
		};
	},
	getSession: async (sessionId: string) => sessionRecord(sessionId),
	runTurn: unusedRuntimeMethod,
	restoreSession: unusedRuntimeMethod,
	abort: unusedRuntimeMethod,
	stopSession: unusedRuntimeMethod,
	listSessions: unusedRuntimeMethod,
	deleteSession: unusedRuntimeMethod,
	updateSession: unusedRuntimeMethod,
	updateSessionCompactionState: unusedRuntimeMethod,
	readSessionCompactionState: unusedRuntimeMethod,
	readSessionMessages: async () => storedHistory,
	dispatchHookEvent: unusedRuntimeMethod,
} as unknown as RuntimeHost;

const runtimeHandlers: HubScheduleRuntimeHandlers = {
	startSession: unusedRuntimeMethod,
	sendSession: unusedRuntimeMethod,
	abortSession: unusedRuntimeMethod,
	stopSession: unusedRuntimeMethod,
};

await startHubWebSocketServer({
	host: "127.0.0.1",
	port,
	pathname: "/hub",
	owner: { ownerId: "resume-e2e-fixture", discoveryPath },
	sessionHost,
	runtimeHandlers,
	scheduleOptions: { dbPath: join(dataDir, "schedules.db") },
	eventLog: { dbPath: join(dataDir, "hub-events.db") },
	runQueue: { dbPath: join(dataDir, "hub-runs.db") },
});
process.stderr.write("[resume-fixture] serving\n");

await new Promise<void>(() => undefined);
