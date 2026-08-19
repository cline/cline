/**
 * Headless second Gateway client — the multi-client fixture.
 *
 * A tiny CLI that attaches to the SAME local Gateway as the desktop app
 * so multi-client behavior (shared event stream, FIFO admission,
 * first-approval-wins) can be exercised manually and in E2E tests:
 *
 *   bun run second-client -- status
 *   bun run second-client -- prompt "do something"
 *   bun run second-client -- steer <runId> "change of plan"
 *   bun run second-client -- interrupt <runId>
 *   bun run second-client -- retry <runId>
 *   bun run second-client -- watch            # stream events
 *   bun run second-client -- approve-all      # answer approvals with yes
 *   bun run second-client -- deny-all         # answer approvals with no
 */

import {
	createEventCursor,
	encodeEventCursor,
} from "@cline/shared/gateway";
import { GatewayClient, readDiscoveryRecord, resolveGatewayPaths } from "@cline/gateway/client";

async function connect(): Promise<GatewayClient> {
	const paths = resolveGatewayPaths({});
	const record = readDiscoveryRecord(paths.discoveryFile);
	if (!record) {
		process.stderr.write(
			`No Gateway discovery record at ${paths.discoveryFile}. Start it with: cline-gateway start\n`,
		);
		process.exit(2);
	}
	return GatewayClient.connectToDiscovery(record, {
		clientName: "gateway-desktop-second-client",
		clientVersion: "0.0.1",
	});
}

async function main(): Promise<void> {
	const [command, ...rest] = process.argv.slice(2);
	const client = await connect();
	const status = await client.getStatus();
	const botId = status.defaultBotId;

	switch (command) {
		case "status": {
			process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
			break;
		}
		case "prompt": {
			if (!botId || !rest[0]) {
				throw new Error("usage: prompt <text>");
			}
			const accepted = await client.startRun({
				botId,
				prompt: rest.join(" "),
			});
			process.stdout.write(`${JSON.stringify(accepted)}\n`);
			break;
		}
		case "steer": {
			const [runId, ...text] = rest;
			if (!runId || text.length === 0) {
				throw new Error("usage: steer <runId> <text>");
			}
			const result = await client.steerRun({
				runId: runId as never,
				text: text.join(" "),
			});
			process.stdout.write(`${JSON.stringify(result)}\n`);
			break;
		}
		case "interrupt": {
			if (!rest[0]) {
				throw new Error("usage: interrupt <runId>");
			}
			const result = await client.interruptRun({ runId: rest[0] as never });
			process.stdout.write(`${JSON.stringify(result)}\n`);
			break;
		}
		case "retry": {
			if (!rest[0]) {
				throw new Error("usage: retry <runId>");
			}
			const result = await client.retryRun({ runId: rest[0] as never });
			process.stdout.write(`${JSON.stringify(result)}\n`);
			break;
		}
		case "watch": {
			client.onEvent((event) => {
				process.stdout.write(`${JSON.stringify(event)}\n`);
			});
			await client.subscribe({
				cursor: encodeEventCursor(createEventCursor(-1)),
			});
			await new Promise(() => {});
			break;
		}
		case "approve-all":
		case "deny-all": {
			const approved = command === "approve-all";
			client.onServerRequest((request) => {
				process.stdout.write(
					`answering ${request.id} (${request.method}): approved=${approved}\n`,
				);
				return { approved, reason: "second-client fixture" };
			});
			await client.subscribe({});
			process.stdout.write("waiting for approval requests (ctrl-c to exit)\n");
			await new Promise(() => {});
			break;
		}
		default:
			process.stderr.write(
				"usage: second-client <status|prompt|steer|interrupt|retry|watch|approve-all|deny-all>\n",
			);
			process.exit(2);
	}
	client.close();
}

main().catch((error) => {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exit(1);
});
