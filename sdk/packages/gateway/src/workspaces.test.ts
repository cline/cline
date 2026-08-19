/**
 * Logical bot workspace storage (Gateway RFC, Phase 4): paths live under
 * `bots/<botId>/workspaces/`, symlink and traversal escapes are
 * rejected, and the worker mount policy derives from the fixed per-bot
 * root — adding a child workspace changes neither the policy object nor
 * its contents, so it can never require a worker restart.
 */

import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createBotId } from "@cline/shared/gateway";
import { describe, expect, it } from "vitest";
import { ensureGatewayDataDir, resolveGatewayPaths } from "./paths";
import { tempDataRoot } from "./test-support";
import { BotWorkspaceManager, WorkspacePathError } from "./workspaces";

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
});
