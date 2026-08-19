import { describe, expect, it, vi } from "vitest";
import {
	createVsCodeRuntimeCapabilities,
	type VsCodeCapabilityUi,
} from "./runtime-capabilities";

describe("createVsCodeRuntimeCapabilities", () => {
	it("registers askQuestion and approval handlers with VS Code UI behavior", async () => {
		const showQuickPick = vi.fn(async () => "Use SDK");
		const showInputBox = vi.fn(async () => "typed answer");
		const showWarningMessage: VsCodeCapabilityUi["showWarningMessage"] = vi.fn(
			async (_message, _options, ...items) => items[0],
		);
		const capabilities = createVsCodeRuntimeCapabilities({
			ui: { showQuickPick, showInputBox, showWarningMessage },
		});

		expect(capabilities.toolExecutors?.askQuestion).toEqual(
			expect.any(Function),
		);
		expect(capabilities.requestToolApproval).toEqual(expect.any(Function));

		await expect(
			capabilities.toolExecutors?.askQuestion?.(
				"Which approach?",
				["Use SDK", "Write custom"],
				{ agentId: "agent", conversationId: "conv", iteration: 1 },
			),
		).resolves.toBe("Use SDK");
		expect(showQuickPick).toHaveBeenCalledWith(["Use SDK", "Write custom"], {
			placeHolder: "Which approach?",
			ignoreFocusOut: true,
		});

		await expect(
			capabilities.requestToolApproval?.({
				sessionId: "session-1",
				agentId: "agent",
				conversationId: "conv",
				iteration: 1,
				toolCallId: "tool-call-1",
				toolName: "run_commands",
				input: { commands: ["echo hi"] },
				policy: { autoApprove: false },
			}),
		).resolves.toEqual({ approved: true });
		expect(showWarningMessage).toHaveBeenCalledWith(
			"Allow run_commands to run?",
			expect.objectContaining({
				modal: true,
				detail: expect.stringContaining("tool-call-1"),
			}),
			"Approve",
			"Deny",
		);

		await expect(
			capabilities.toolExecutors?.askQuestion?.("Freeform?", [], {
				agentId: "agent",
				conversationId: "conv",
				iteration: 2,
			}),
		).resolves.toBe("typed answer");
		expect(showInputBox).toHaveBeenCalledWith({
			prompt: "Freeform?",
			ignoreFocusOut: true,
		});
	});
});
