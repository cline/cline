import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	createHubSupportTool,
	type HubSupportToolDeps,
	redactHubSecrets,
} from "./hub-support-tool";

const toolContext = {} as AgentToolContext;

function createDeps(
	overrides: Partial<HubSupportToolDeps> = {},
): HubSupportToolDeps {
	return {
		getStatus: vi.fn(() => ({ hubId: "hub_x", draining: false, idle: true })),
		describeConfig: vi.fn(() => ({ ownerId: "hub-production" })),
		listSessions: vi.fn(async () => [
			{
				sessionId: "s1",
				status: "running",
				interactive: true,
				provider: "cline",
				model: "m",
				workspaceRoot: "/w",
				startedAt: "t0",
				updatedAt: "t1",
				secretField: "should-not-pass-through",
			},
		]),
		listRuns: vi.fn(() => [{ runId: "hrun_1", state: "completed" }]),
		...overrides,
	};
}

describe("cline_hub_support tool", () => {
	it("answers status, config, sessions, and runs queries", async () => {
		const tool = createHubSupportTool(createDeps());
		const status = await tool.execute({ query: "status" }, toolContext);
		expect(status.ok).toBe(true);
		expect((status.result as { hubId: string }).hubId).toBe("hub_x");

		const config = await tool.execute({ query: "config" }, toolContext);
		expect((config.result as { ownerId: string }).ownerId).toBe(
			"hub-production",
		);

		const sessions = await tool.execute(
			{ query: "sessions", limit: 5 },
			toolContext,
		);
		const rows = sessions.result as Record<string, unknown>[];
		expect(rows[0]?.sessionId).toBe("s1");
		// Only the whitelisted projection passes through.
		expect(rows[0]).not.toHaveProperty("secretField");

		const runs = await tool.execute({ query: "runs" }, toolContext);
		expect((runs.result as { runId: string }[])[0]?.runId).toBe("hrun_1");
	});

	it("tails and redacts the hub log", async () => {
		const root = mkdtempSync(join(tmpdir(), "hub-support-log-"));
		const logPath = join(root, "hub-daemon.log");
		const token = "a".repeat(64);
		writeFileSync(
			logPath,
			[
				"line one",
				`authorization: Bearer ${token}`,
				`{"authToken":"${token}"}`,
				"line four",
			].join("\n"),
		);
		const tool = createHubSupportTool(createDeps({ logPath }));
		const logs = await tool.execute({ query: "logs", lines: 10 }, toolContext);
		expect(logs.ok).toBe(true);
		const text = logs.result as string;
		expect(text).toContain("line one");
		expect(text).toContain("line four");
		expect(text).not.toContain(token);
		expect(text).toContain("[redacted]");
	});

	it("reports a missing log honestly instead of failing", async () => {
		const tool = createHubSupportTool(
			createDeps({ logPath: "/nonexistent/hub-daemon.log" }),
		);
		const logs = await tool.execute({ query: "logs" }, toolContext);
		expect(logs.ok).toBe(true);
		expect(String(logs.result)).toContain("No hub log found");
	});

	it("rejects invalid input and isolates dependency failures", async () => {
		const tool = createHubSupportTool(
			createDeps({
				getStatus: () => {
					throw new Error("status backend exploded");
				},
			}),
		);
		const invalid = await tool.execute(
			{ query: "everything" } as never,
			toolContext,
		);
		expect(invalid.ok).toBe(false);

		const failed = await tool.execute({ query: "status" }, toolContext);
		expect(failed.ok).toBe(false);
		expect(failed.error).toContain("status backend exploded");
	});
});

describe("redactHubSecrets", () => {
	it("scrubs bearer headers, token fields, and long key-shaped blobs", () => {
		const hex = "f".repeat(64);
		const b64 = "A1b2C3d4".repeat(6);
		const input = `Bearer header: authorization: Bearer ${hex}\n"apiKey":"sk-something-long"\nblob ${b64} end`;
		const output = redactHubSecrets(input);
		expect(output).not.toContain(hex);
		expect(output).not.toContain(b64);
		expect(output).not.toContain("sk-something-long");
	});

	it("leaves ordinary text alone", () => {
		const text = "session s1 completed in 1200ms with finishReason=completed";
		expect(redactHubSecrets(text)).toBe(text);
	});
});
