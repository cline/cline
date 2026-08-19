/**
 * Logical bot workspace storage (Gateway RFC, Phase 4): paths live under
 * `bots/<botId>/workspaces/`, symlink and traversal escapes are
 * rejected, and the worker mount policy derives from the fixed per-bot
 * root — adding a child workspace changes neither the policy object nor
 * its contents, so it can never require a worker restart.
 */

import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createBotId, createSessionId } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { openGatewayDatabase } from "./db";
import { ensureGatewayDataDir, resolveGatewayPaths } from "./paths";
import { tempDataRoot } from "./test-support";
import {
	BotWorkspaceManager,
	relocateManagedSessionWorkspaces,
	WorkspacePathError,
} from "./workspaces";

function setup() {
	const paths = resolveGatewayPaths({
		dataRoot: tempDataRoot(),
		namespace: "default",
	});
	ensureGatewayDataDir(paths);
	return {
		paths,
		manager: new BotWorkspaceManager(paths),
		botId: createBotId(),
	};
}

describe("bot workspace storage", () => {
	it("materializes logical workspaces under bots/<botId>/workspaces/", () => {
		const { paths, manager, botId } = setup();
		const dir = manager.materializeWorkspace(botId, "project-a");
		expect(dir).toBe(join(paths.workspacesDir(botId), "project-a"));
		// Nested child workspaces are fine — still inside the root.
		const child = manager.materializeWorkspace(botId, "project-a/sub");
		expect(child).toBe(join(dir, "sub"));
	});

	it("rejects traversal and absolute workspace paths", () => {
		const { manager, botId } = setup();
		for (const evil of [
			"../escape",
			"a/../../escape",
			"/etc",
			"..",
			".",
			"",
			"a//b",
		]) {
			expect(() => manager.resolveWorkspacePath(botId, evil), evil).toThrow(
				WorkspacePathError,
			);
		}
	});

	it("rejects a workspace that symlinks outside the bot root", () => {
		const { paths, manager, botId } = setup();
		const outside = tempDataRoot("cline-ws-outside-");
		mkdirSync(paths.workspacesDir(botId), { recursive: true });
		symlinkSync(outside, join(paths.workspacesDir(botId), "sneaky"));
		expect(() => manager.materializeWorkspace(botId, "sneaky")).toThrow(
			WorkspacePathError,
		);
		expect(() =>
			manager.assertInsideBotRoot(
				botId,
				join(paths.workspacesDir(botId), "sneaky"),
			),
		).toThrow(WorkspacePathError);
	});

	it("adding a child workspace never widens the mount policy", () => {
		const { paths, manager, botId } = setup();
		const before = manager.mountPolicy(botId);
		expect(before.writeRoots).toEqual([paths.workspacesDir(botId)]);

		manager.materializeWorkspace(botId, "one");
		manager.materializeWorkspace(botId, "two/nested");

		const after = manager.mountPolicy(botId);
		// Same frozen object: nothing to re-mount, nothing to restart.
		expect(after).toBe(before);
		expect(after.writeRoots).toEqual([paths.workspacesDir(botId)]);
		expect(Object.isFrozen(after)).toBe(true);
	});

	it("scopes mount policies per bot", () => {
		const { manager } = setup();
		const a = createBotId();
		const b = createBotId();
		expect(manager.mountPolicy(a).writeRoots).not.toEqual(
			manager.mountPolicy(b).writeRoots,
		);
	});

	it("rebases managed workspaces after the Gateway data root moves", () => {
		const oldRoot = tempDataRoot("cline-old-root-");
		const paths = resolveGatewayPaths({
			dataRoot: tempDataRoot("cline-new-root-"),
			namespace: "default",
		});
		const database = openGatewayDatabase(join(tempDataRoot(), "gateway.db"));
		const botId = createBotId();
		const sessionId = createSessionId();
		database.db
			.prepare(
				"INSERT INTO sessions (session_id, bot_id, workspace_root, state, created_at, revision) VALUES (?, ?, ?, 'active', 1, 0);",
			)
			.run(
				sessionId,
				botId,
				join(oldRoot, "default", "bots", botId, "workspaces", sessionId),
			);

		expect(relocateManagedSessionWorkspaces(database, paths)).toBe(1);
		expect(
			database.db
				.prepare("SELECT workspace_root FROM sessions WHERE session_id = ?;")
				.get(sessionId)?.workspace_root,
		).toBe(paths.sessionWorkspaceDir(botId, sessionId));
		database.close();
	});
});
