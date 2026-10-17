import { describe, expect, test } from "bun:test";
import {
	createInMemoryHubOwnerContext,
	createLocalHubScheduleRuntimeHandlers,
	startHubWebSocketServer,
} from "@cline/core/hub";
import { setClineDir } from "@cline/shared/storage";
import { useTempDirs } from "../test-support/temp-dirs";
import { HubCommandFailed, HubLink } from "./link";
import { nodeHubLinkDeps } from "./node-deps";

const tempDir = useTempDirs("next-turn-link-", { restoreClineDir: true });

describe("the real link against a @cline/core hub", () => {
	test("a reply resolves to its payload, and a hub error rejects as HubCommandFailed with its code", async () => {
		const workspaceRoot = tempDir("workspace-");
		setClineDir(tempDir("cline-"));
		const server = await startHubWebSocketServer({
			host: "127.0.0.1",
			port: 0,
			workspaceRoot,
			owner: createInMemoryHubOwnerContext("next-turn-link-test"),
			runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
		});
		const link = new HubLink(
			{
				...nodeHubLinkDeps(),
				resolveEndpoint: async () => ({
					url: server.url,
					authToken: server.authToken,
				}),
			},
			{ workspaceRoot, cwd: workspaceRoot },
		);
		try {
			await link.start();
			expect(link.availability()).toBe("present");
			expect(await link.command("task.list", {})).toEqual({ tasks: [] });
			const failure = await link
				.command("task.get", { taskId: "task_missing" })
				.catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(HubCommandFailed);
			expect((failure as HubCommandFailed).code).toBe("task_command_failed");
		} finally {
			await link.dispose().catch(() => {});
			await Promise.race([server.close().catch(() => {}), Bun.sleep(1_000)]);
		}
	}, 15_000);
});
