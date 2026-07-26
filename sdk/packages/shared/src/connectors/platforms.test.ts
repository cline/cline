import { describe, expect, it } from "vitest";
import { CONNECTOR_PLATFORMS, mergeConnectorConnectArgs } from "./platforms";

function platform(id: string) {
	const definition = CONNECTOR_PLATFORMS.find((entry) => entry.id === id);
	if (!definition) {
		throw new Error(`missing test platform ${id}`);
	}
	return definition;
}

describe("mergeConnectorConnectArgs", () => {
	it("replaces managed aliases while preserving CLI-only runtime options", () => {
		expect(
			mergeConnectorConnectArgs(
				platform("telegram"),
				[
					"--provider",
					"openrouter",
					"--bot-token=old-token",
					"--cwd",
					"/workspace",
					"--no-tools",
					"--allowed-user-id",
					"1",
				],
				["-k", "new-token", "--allowed-user-id", "2"],
				{ replaceSecurityArgs: true },
			),
		).toEqual([
			"--provider",
			"openrouter",
			"--cwd",
			"/workspace",
			"--no-tools",
			"-k",
			"new-token",
			"--allowed-user-id",
			"2",
		]);
	});

	it("preserves a CLI hook when dashboard security has never owned it", () => {
		expect(
			mergeConnectorConnectArgs(
				platform("slack"),
				[
					"--bot-token",
					"old-token",
					"--hook-command",
					"custom-hook",
					"--provider",
					"cline",
				],
				["--bot-token", "new-token", "--app-token", "app-token"],
				{ replaceSecurityArgs: false },
			),
		).toEqual([
			"--hook-command",
			"custom-hook",
			"--provider",
			"cline",
			"--bot-token",
			"new-token",
			"--app-token",
			"app-token",
		]);
	});

	it("drops Telegram hook commands when dashboard access control is applied", () => {
		expect(
			mergeConnectorConnectArgs(
				platform("telegram"),
				[
					"-k",
					"old-token",
					"--hook-command",
					"custom-hook",
					"--provider",
					"cline",
				],
				["-k", "new-token", "--allowed-user-id", "42"],
				{ replaceSecurityArgs: true },
			),
		).toEqual([
			"--provider",
			"cline",
			"-k",
			"new-token",
			"--allowed-user-id",
			"42",
		]);
	});

	it.each([
		["long flag", ["--bot-username", "old_bot"]],
		["short flag", ["-m", "old_bot"]],
		["equals syntax", ["--bot-username=old_bot"]],
	])("drops a persisted Telegram username after token rotation using %s", (_label, persistedUsernameArgs) => {
		expect(
			mergeConnectorConnectArgs(
				platform("telegram"),
				[
					"--provider",
					"openrouter",
					"-k",
					"old-token",
					...persistedUsernameArgs,
					"--cwd",
					"/workspace",
				],
				["-k", "new-token"],
				{ replaceSecurityArgs: false },
			),
		).toEqual([
			"--provider",
			"openrouter",
			"--cwd",
			"/workspace",
			"-k",
			"new-token",
		]);
	});
});
