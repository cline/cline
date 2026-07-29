import { describe, expect, it, vi, afterEach } from "vitest";
import { handleDriveAgentHomeWebviewCommand } from "./drive-agent-home";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

function peer(): BrowserPeer {
	return { id: "peer-1" } as unknown as BrowserPeer;
}

function ctx(overrides?: {
	uiClient?: HubContext["uiClient"];
	send?: HubContext["send"];
}): { context: HubContext; sent: unknown[] } {
	const sent: unknown[] = [];
	const context = {
		uiClient: overrides?.uiClient,
		send:
			overrides?.send ??
			((_peer: BrowserPeer, message: unknown) => {
				sent.push(message);
			}),
	} as unknown as HubContext;
	return { context, sent };
}

const sampleHome = {
	slug: "pair-partner",
	agent: {
		name: "pair-partner",
		description: "Default Drive pair partner.",
		tools: ["read_file"],
		skills: ["drive-persona"],
		systemPrompt: "SECRET PROMPT MUST NOT LEAK",
	},
	permissions: {
		presetIntent: "standard" as const,
		approvalHooks: ["highImpact"],
		notes: "Intent only.",
	},
	env: { values: {}, secretRefs: [] },
};

const sampleCompiled = {
	name: "pair-partner",
	slug: "pair-partner",
	description: "Default Drive pair partner.",
	tools: ["read_file"],
	skills: ["drive-persona"],
	systemPrompt: "SECRET PROMPT MUST NOT LEAK",
};

describe("handleDriveAgentHomeWebviewCommand", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("errors when hub is disconnected", async () => {
		const { context, sent } = ctx({ uiClient: undefined });
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: "/tmp/ws",
			slug: "pair-partner",
			requestId: "req-1",
		});
		expect(sent).toEqual([
			{
				type: "drive_agent_home_error",
				text: "Hub is not connected.",
				code: "hub_disconnected",
				requestId: "req-1",
			},
		]);
	});

	it("errors when workspaceRoot or slug is empty", async () => {
		const command = vi.fn();
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: "  ",
			slug: "pair-partner",
			requestId: "req-root",
		});
		expect(sent[0]).toMatchObject({
			type: "drive_agent_home_error",
			code: "invalid_payload",
			requestId: "req-root",
		});
		expect(command).not.toHaveBeenCalled();

		sent.length = 0;
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: "/tmp/ws",
			slug: "",
			requestId: "req-slug",
		});
		expect(sent[0]).toMatchObject({
			type: "drive_agent_home_error",
			code: "invalid_payload",
			requestId: "req-slug",
		});
	});

	it("forwards drive_agent_home_get and strips prompt fields", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: true,
			payload: { home: sampleHome, compiled: sampleCompiled },
		});
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: "/tmp/ws",
			slug: "pair-partner",
			requestId: "req-ok",
		});
		expect(command).toHaveBeenCalledWith("drive_agent_home_get", {
			workspaceRoot: "/tmp/ws",
			slug: "pair-partner",
		});
		expect(sent).toHaveLength(1);
		const message = sent[0] as {
			type: string;
			home: { agent: Record<string, unknown> };
			compiled: Record<string, unknown>;
		};
		expect(message.type).toBe("drive_agent_home");
		expect(message.home.agent.systemPrompt).toBeUndefined();
		expect(message.compiled.systemPrompt).toBeUndefined();
		expect(message.compiled.description).toBe("Default Drive pair partner.");
		expect(message.home.agent.tools).toEqual(["read_file"]);
	});

	it("maps hub command failure to drive_agent_home_error", async () => {
		const command = vi.fn().mockResolvedValue({
			ok: false,
			error: { code: "unknown_agent", message: "missing home" },
		});
		const { context, sent } = ctx({
			uiClient: { command } as unknown as HubContext["uiClient"],
		});
		await handleDriveAgentHomeWebviewCommand(context, peer(), {
			type: "drive_agent_home_get",
			workspaceRoot: "/tmp/ws",
			slug: "missing",
			requestId: "req-err",
		});
		expect(sent).toEqual([
			{
				type: "drive_agent_home_error",
				text: "missing home",
				code: "unknown_agent",
				requestId: "req-err",
			},
		]);
	});
});
