import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDefaultMcpServerClientFactory } from "./client";
import {
	createMcpServerFixture,
	fakeServerRegistration,
	type McpServerFixture,
} from "./client-test-fixtures";
import { resolveMcpServerRegistrations } from "./config-loader";

/**
 * Connect-budget integration tests over a real stdio child process (see
 * client-test-fixtures.ts). Successful-connect cases with slow initialize
 * responses live here; request-timeout and initialize-failure cases run in
 * client.test.ts and client-init-failure.test.ts respectively.
 */

let fixture: McpServerFixture;
let tempRoot: string;

beforeAll(() => {
	fixture = createMcpServerFixture();
	tempRoot = fixture.tempRoot;
});

afterAll(() => {
	fixture.cleanup();
});

describe("mcp client connect budget", () => {
	it("raises the initialize probe budget when a timeout is configured", async () => {
		const factory = createDefaultMcpServerClientFactory();
		// 3s of startup work would fail the old 1.5s probe; the configured
		// 10s timeout lets initialize finish.
		const client = await factory(
			fakeServerRegistration(tempRoot, {
				timeoutSeconds: 10,
				delayMs: 0,
				initDelayMs: 3_000,
			}),
		);
		try {
			await client.connect();
			const tools = await client.listTools();
			expect(tools).toEqual([]);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("connects a moderately slow server without a configured timeout", async () => {
		const factory = createDefaultMcpServerClientFactory();
		// The old 1.5s initialize probe killed servers that needed ~2s to answer
		// (https://github.com/cline/cline/issues/13035), so the default budget
		// must cover them. It deliberately stays small beyond that: initialize
		// runs on the session.create critical path, so genuinely slow starters
		// (e.g. JVM-based Oracle SQLcl) opt into patience with an explicit
		// `timeout` instead of the default stalling every session.
		const client = await factory(
			fakeServerRegistration(tempRoot, { delayMs: 0, initDelayMs: 2_000 }),
		);
		try {
			await client.connect();
			expect(await client.listTools()).toEqual([]);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("connects a slow-starting server when a timeout is configured", async () => {
		const factory = createDefaultMcpServerClientFactory();
		const client = await factory(
			fakeServerRegistration(tempRoot, {
				timeoutSeconds: 15,
				delayMs: 0,
				initDelayMs: 4_000,
			}),
		);
		try {
			await client.connect();
			expect(await client.listTools()).toEqual([]);
		} finally {
			await client.disconnect();
		}
	}, 30_000);

	it("uses the default connect budget when a malformed settings timeout is ignored", async () => {
		const filePath = join(tempRoot, `malformed-timeout-${Date.now()}.json`);
		writeFileSync(
			filePath,
			JSON.stringify({
				mcpServers: {
					"fake-server": {
						transport: fakeServerRegistration(tempRoot, {
							delayMs: 0,
							initDelayMs: 2_000,
						}).transport,
						timeout: "60",
					},
				},
			}),
			"utf8",
		);
		const [registration] = resolveMcpServerRegistrations({ filePath });
		expect(registration.timeoutSeconds).toBeUndefined();
		const client = await createDefaultMcpServerClientFactory()(registration);
		try {
			await client.connect();
			expect(await client.listTools()).toEqual([]);
		} finally {
			await client.disconnect();
		}
	}, 30_000);
});
