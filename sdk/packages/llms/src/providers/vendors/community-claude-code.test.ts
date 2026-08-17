import type { GatewayResolvedProviderConfig } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createClaudeCode = vi.fn(() => (modelId: string) => ({ modelId }));

vi.mock("ai-sdk-provider-claude-code", () => ({
	createClaudeCode,
}));

import { createClaudeCodeProviderModule } from "./community";

type SdkHookCallback = (...args: unknown[]) => Promise<Record<string, unknown>>;

function capturedSettings(): Record<string, unknown> {
	const call = createClaudeCode.mock.calls.at(-1) as unknown[] | undefined;
	const options = call?.[0] as { defaultSettings?: Record<string, unknown> };
	return options?.defaultSettings ?? {};
}

function capturedPreToolUseHook(): SdkHookCallback {
	const hooks = capturedSettings().hooks as
		| Record<string, Array<{ hooks: SdkHookCallback[] }>>
		| undefined;
	const callback = hooks?.PreToolUse?.[0]?.hooks?.[0];
	if (!callback) {
		throw new Error("expected a wired PreToolUse hook");
	}
	return callback;
}

function makeConfig(
	options: Record<string, unknown>,
): GatewayResolvedProviderConfig {
	return { providerId: "claude-code", options };
}

describe("createClaudeCodeProviderModule PreToolUse gating", () => {
	beforeEach(() => {
		createClaudeCode.mockClear();
	});

	it("wires no hooks when the host provides no permission callback", async () => {
		await createClaudeCodeProviderModule(makeConfig({}));
		expect(capturedSettings().hooks).toBeUndefined();
	});

	it("never clobbers hooks the caller configured explicitly", async () => {
		const userHooks = { PreToolUse: [] };
		await createClaudeCodeProviderModule(
			makeConfig({
				onToolPermission: vi.fn(),
				defaultSettings: { hooks: userHooks },
			}),
		);
		expect(capturedSettings().hooks).toBe(userHooks);
	});

	it("translates the SDK hook payload into a permission request", async () => {
		const onToolPermission = vi.fn(async () => ({ behavior: "allow" }));
		await createClaudeCodeProviderModule(makeConfig({ onToolPermission }));

		const output = await capturedPreToolUseHook()({
			hook_event_name: "PreToolUse",
			tool_name: "Read",
			tool_input: { file_path: "/tmp/a.txt" },
			tool_use_id: "cli_read_1",
		});

		expect(onToolPermission).toHaveBeenCalledWith({
			toolName: "Read",
			toolCallId: "cli_read_1",
			input: { file_path: "/tmp/a.txt" },
		});
		// Allow must NOT force a permission decision: the CLI's own permission
		// flow (user settings, permission mode) still applies.
		expect(output).toEqual({
			hookSpecificOutput: { hookEventName: "PreToolUse" },
		});
	});

	it("passes an input override through as updatedInput", async () => {
		const onToolPermission = vi.fn(async () => ({
			behavior: "allow",
			updatedInput: { file_path: "/tmp/b.txt" },
		}));
		await createClaudeCodeProviderModule(makeConfig({ onToolPermission }));

		const output = await capturedPreToolUseHook()({
			tool_name: "Read",
			tool_input: { file_path: "/tmp/a.txt" },
			tool_use_id: "cli_read_1",
		});

		expect(output).toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				updatedInput: { file_path: "/tmp/b.txt" },
			},
		});
	});

	it("maps deny to a permission denial, and interrupt to a turn stop", async () => {
		const onToolPermission = vi
			.fn()
			.mockResolvedValueOnce({ behavior: "deny", message: "not this file" })
			.mockResolvedValueOnce({
				behavior: "deny",
				message: "stop everything",
				interrupt: true,
			});
		await createClaudeCodeProviderModule(makeConfig({ onToolPermission }));
		const hook = capturedPreToolUseHook();

		await expect(
			hook({ tool_name: "Read", tool_input: {}, tool_use_id: "t1" }),
		).resolves.toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: "not this file",
			},
		});

		await expect(
			hook({ tool_name: "Bash", tool_input: {}, tool_use_id: "t2" }),
		).resolves.toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "deny",
				permissionDecisionReason: "stop everything",
			},
			continue: false,
			stopReason: "stop everything",
		});
	});
});
