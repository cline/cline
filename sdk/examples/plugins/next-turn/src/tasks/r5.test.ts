import { describe, expect, test } from "bun:test";
import {
	createInMemoryHubOwnerContext,
	createLocalHubScheduleRuntimeHandlers,
	NodeHubClient,
	startHubWebSocketServer,
} from "@cline/core/hub";
import { setClineDir } from "@cline/shared/storage";
import { useTempDirs } from "../test-support";
import { proposeTask, workspaceTaskSpecsDir } from "./tasks";

const tempDir = useTempDirs("next-turn-r5-", { restoreClineDir: true });

describe("proposeTask against a real @cline/core hub", () => {
	test("writing a proposal spec file reconciles into a pending_approval task created by file_reconciler, emits task.created to subscribers, and approves with its revision", async () => {
		const clineDir = tempDir("cline-");
		const workspaceRoot = tempDir("workspace-");
		setClineDir(clineDir);

		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			workspaceRoot,
			owner: createInMemoryHubOwnerContext("r5-test"),
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});

		const clientA = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "next-turn-r5-a",
			displayName: "Client A",
			workspaceRoot,
			cwd: workspaceRoot,
		});
		const clientB = new NodeHubClient({
			url: server.url,
			authToken: server.authToken,
			clientType: "next-turn-r5-b",
			displayName: "Client B",
			workspaceRoot,
			cwd: workspaceRoot,
		});

		try {
			await clientA.connect();
			await clientB.connect();

			const created = Promise.withResolvers<Record<string, unknown>>();
			const unsubscribe = clientB.subscribe((event) => {
				if (event.event === "task.created") {
					const payload = (event.payload ?? {}) as {
						task?: Record<string, unknown>;
					};
					if (payload.task) created.resolve(payload.task);
				}
			});

			const specsDir = workspaceTaskSpecsDir(workspaceRoot);
			const linkA = {
				async command(name: string, payload?: Record<string, unknown>) {
					const reply = await clientA.command(
						name as Parameters<typeof clientA.command>[0],
						payload,
					);
					return (reply.payload ?? {}) as Record<string, unknown>;
				},
			};

			const proposed = await proposeTask(linkA, specsDir, {
				title: "Add 405 Method Not Allowed check",
				instructions:
					"Verify POST /users returns 405 when method is unsupported.",
			});

			const reconciledTask = await Promise.race([
				created.promise,
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("timed out waiting for task.created")),
						1_000,
					),
				),
			]);
			unsubscribe();

			expect(reconciledTask.taskId).toBe(proposed.taskId);
			expect(reconciledTask.status).toBe("pending_approval");
			expect(reconciledTask.automationEligible).toBe(false);
			expect(reconciledTask.createdBy).toMatchObject({
				kind: "system",
				id: "file_reconciler",
			});

			const approveReply = await clientA.command("task.approve", {
				taskId: proposed.taskId,
				expectedRevision: reconciledTask.revision as number,
			});
			expect(approveReply.ok).toBe(true);
			const approvedTask = (
				approveReply.payload as { task?: Record<string, unknown> }
			)?.task;
			expect(approvedTask?.status).toBe("approved");
		} finally {
			await clientA.dispose().catch(() => {});
			await clientB.dispose().catch(() => {});
			await Promise.race([server.close().catch(() => {}), Bun.sleep(1_000)]);
		}
	});
});
