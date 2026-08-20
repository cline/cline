/**
 * Credential hygiene end-to-end: a provider secret stored as a mode-0600
 * file is injected in memory at the engine boundary for a full turn —
 * and appears nowhere else: not in SQLite (including the WAL), not in
 * the event log, not in audit entries, not in projections, not in the
 * discovery record, and not in run rows or snapshots.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { EngineInvocation, EnginePort } from "@cline/bot";
import type { RunAccepted } from "@cline/shared/gateway";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient } from "./client";
import { resolveProviderModel } from "./engine-binding";
import { resolveGatewayPaths } from "./paths";
import { writeSecretFile } from "./secrets";
import { GatewayServer } from "./server";
import { ScriptedEnginePort, tempDataRoot, waitFor } from "./test-support";

const SECRET = "sk-test-SUPERSECRET-4f9c2e8b7a6d5140";

const servers: GatewayServer[] = [];
const clients: GatewayClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) {
		client.close();
	}
	for (const server of servers.splice(0)) {
		await server.stop("graceful").catch(() => {});
	}
});

function listFilesRecursively(dir: string): string[] {
	const names = readdirSync(dir, { recursive: true, encoding: "utf8" });
	const files: string[] = [];
	for (const name of names) {
		const full = join(dir, name);
		try {
			if (statSync(full).isFile()) {
				files.push(full);
			}
		} catch {
			// Transient files (WAL checkpoints) may vanish mid-walk.
		}
	}
	return files;
}

describe("credential hygiene", () => {
	it("a turn using a 0600 secret leaks it nowhere outside secrets/", async () => {
		const dataRoot = tempDataRoot();
		const paths = resolveGatewayPaths({ dataRoot, namespace: "default" });
		writeSecretFile(paths, "anthropic", SECRET);

		// Engine double that goes through the REAL credential resolution
		// used by `serve` (secret file, no env), then executes scripted —
		// proving the key reaches the engine boundary in memory only.
		const scripted = new ScriptedEnginePort();
		const resolvedKeys: string[] = [];
		const engine: EnginePort = {
			start(invocation: EngineInvocation) {
				const binding = resolveProviderModel(invocation, { env: {}, paths });
				if (binding.kind === "provider" && binding.apiKey) {
					resolvedKeys.push(binding.apiKey);
				}
				return scripted.start(invocation);
			},
		};
		const server = await GatewayServer.start({
			dataRoot,
			namespace: "default",
			engine,
		});
		servers.push(server);
		const discovery = server.discovery;
		if (!discovery) {
			throw new Error("no discovery");
		}
		const client = await GatewayClient.connectToDiscovery(discovery, {
			clientName: "hygiene-test",
			clientVersion: "0.0.1",
		});
		clients.push(client);
		const botId = server.runtime.defaultBotId;
		if (!botId) {
			throw new Error("no default bot");
		}

		const accepted = (await client.mutate("run.start", {
			botId,
			prompt: "use the stored credential",
			overrides: { providerId: "anthropic", modelId: "claude-x" },
		})) as RunAccepted;
		await waitFor(() => scripted.handles.length === 1);
		scripted.handles[0].emit({
			type: "message-appended",
			message: {
				id: "msg_hygiene",
				role: "assistant",
				content: [{ type: "text", text: "done without leaking" }],
				createdAt: Date.now(),
			},
			index: 0,
		});
		scripted.handles[0].settle({ outputText: "turn finished" });
		await waitFor(
			() => server.stores.runs.get(accepted.runId)?.state === "completed",
		);
		await server.outboxWorker.drain();

		// The key was actually used (in memory, via the 0600 file, no env).
		expect(resolvedKeys).toEqual([SECRET]);

		// It appears in exactly one place on disk: the secret file itself.
		// Not in gateway.db / WAL, projections, discovery, workspaces, logs.
		const offenders = listFilesRecursively(paths.dataDir).filter((file) => {
			const contents = readFileSync(file);
			return contents.includes(SECRET);
		});
		expect(offenders.map((file) => relative(paths.dataDir, file))).toEqual([
			join("secrets", "anthropic"),
		]);

		// Nor in any wire-visible surface: events, audit, run rows, status.
		const events = server.stores.events.listAfter(-1, {}, 1000);
		expect(JSON.stringify(events)).not.toContain(SECRET);
		expect(JSON.stringify(server.stores.audit.list(1000))).not.toContain(
			SECRET,
		);
		expect(
			JSON.stringify(server.stores.runs.get(accepted.runId)),
		).not.toContain(SECRET);
		expect(
			JSON.stringify(server.stores.runs.getConfigSnapshot(accepted.runId)),
		).not.toContain(SECRET);
		expect(JSON.stringify(server.runtime.status())).not.toContain(SECRET);
	});
});
