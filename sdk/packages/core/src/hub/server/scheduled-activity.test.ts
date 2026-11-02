import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentModel, HubCommandEnvelope } from "@cline/shared";
import { resolveClineDir, setClineDir } from "@cline/shared/storage";
import { expect, it, vi } from "vitest";
import { createLocalHubScheduleRuntimeHandlers } from "../daemon/runtime-handlers";
import { HubServerTransport } from "./hub-server-transport";

const provider = vi.hoisted(() => {
	let release!: () => void;
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { release, waiting, entered: false };
});
vi.mock("../../services/llms/handler-factory", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../../services/llms/handler-factory")
	>()),
	createAgentModelFromConfig: (): AgentModel => ({
		async *stream() {
			provider.entered = true;
			await provider.waiting;
			yield { type: "finish", reason: "stop" };
		},
	}),
}));

it("reports a scheduled turn from the daemon's separate runtime host", async () => {
	const root = mkdtempSync(join(tmpdir(), "scheduled-activity-"));
	const previousClineDir = resolveClineDir();
	setClineDir(join(root, ".cline"));
	const network = vi
		.spyOn(globalThis, "fetch")
		.mockRejectedValue(new Error("Unexpected network request"));
	const handlers = createLocalHubScheduleRuntimeHandlers();
	const hub = new HubServerTransport({
		workspaceRoot: root,
		runtimeHandlers: handlers,
		scheduleOptions: {
			dbPath: join(root, "cron.db"),
			specs: { cronSpecsDir: join(root, "cron") },
		},
		taskOptions: {
			dbPath: join(root, "tasks.db"),
			globalSpecsDir: join(root, "tasks"),
			watchFiles: false,
		},
		sessionSearchOptions: { dbPath: join(root, "search.db") },
		eventLog: false,
		runQueue: { dbPath: join(root, "runs.db") },
	});
	const command = (
		command: HubCommandEnvelope["command"],
		payload?: Record<string, unknown>,
	) =>
		hub.handleCommand({
			version: "v1",
			clientId: "test-client",
			command,
			payload,
		});
	try {
		await hub.start();
		const created = await command("schedule.create", {
			name: "Scheduled work",
			cronPattern: "0 0 1 1 *",
			prompt: "Synthetic work",
			workspaceRoot: root,
			modelSelection: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-20250514",
			},
			runtimeOptions: {
				enableTools: false,
				enableSpawn: false,
				enableTeams: false,
			},
			maxIterations: 1,
		});
		expect(created.ok).toBe(true);
		const schedule = created.payload?.schedule;
		if (
			!schedule ||
			typeof schedule !== "object" ||
			!("scheduleId" in schedule)
		)
			throw new Error("Missing created schedule");
		expect((await command("hub.status")).payload).toMatchObject({
			activity: { busy: false },
		});
		expect(
			(
				await command("schedule.trigger", {
					scheduleId: schedule.scheduleId,
					wait: false,
				})
			).ok,
		).toBe(true);
		await vi.waitFor(() => expect(provider.entered).toBe(true));
		expect((await command("hub.status")).payload).toMatchObject({
			activity: { busy: true },
			pendingRuns: 0,
			activeRpcTurns: 0,
		});
		provider.release();
		await vi.waitFor(async () =>
			expect((await command("hub.status")).payload).toMatchObject({
				activity: { busy: false },
			}),
		);
	} finally {
		provider.release();
		await hub.stop();
		network.mockRestore();
		setClineDir(previousClineDir);
	}
});
