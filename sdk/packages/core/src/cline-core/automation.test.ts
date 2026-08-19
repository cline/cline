import type { ChatStartSessionRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeHost } from "../runtime/host/runtime-host";
import { createClineCoreAutomationRuntimeHandlers } from "./automation";

function createRequest(): ChatStartSessionRequest {
	return {
		workspaceRoot: "/workspace",
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		source: "custom-trigger",
		systemPrompt: "system",
		mode: "act",
		enableTools: true,
	};
}

describe("createClineCoreAutomationRuntimeHandlers", () => {
	it("starts every scheduled run with automation provenance", async () => {
		const startSession = vi.fn().mockResolvedValue({
			sessionId: "scheduled-session",
			manifestPath: "/tmp/scheduled-session.manifest.json",
			messagesPath: "/tmp/scheduled-session.messages.json",
		});
		const handlers = createClineCoreAutomationRuntimeHandlers({
			host: { startSession } as unknown as RuntimeHost,
			getExtensionContext: () => ({
				client: { name: "VSCode Extension", version: "3.99.0" },
			}),
		});

		await handlers.startSession(createRequest());

		expect(startSession).toHaveBeenCalledWith(
			expect.objectContaining({
				source: "vscode",
				mode: "automation",
				sessionMetadata: {
					sessionHistoryOrigin: {
						mode: "automation",
						trigger: "custom-trigger",
					},
				},
				config: expect.objectContaining({ mode: "act" }),
			}),
		);
	});
});
