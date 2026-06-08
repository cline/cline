import type { AgentEvent, TeamEvent } from "@cline/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, handleTeamEvent } from "./events";
import { setCurrentOutputMode } from "./output";
import type { Config } from "./types";

describe("handleEvent text formatting", () => {
	let output = "";
	let errorOutput = "";

	beforeEach(() => {
		vi.restoreAllMocks();
		output = "";
		errorOutput = "";
		setCurrentOutputMode("text");
		vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
			output += String(chunk);
			return true;
		});
		vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
			errorOutput += String(chunk);
			return true;
		});
	});

	it("adds a ⎿ before text that follows a tool block", () => {
		handleEvent(
			{
				type: "content_start",
				contentType: "tool",
				toolName: "read_files",
				input: { path: "/tmp/demo.txt" },
			} as unknown as AgentEvent,
			{} as Config,
		);
		handleEvent(
			{
				type: "content_end",
				contentType: "tool",
				toolName: "read_files",
				output: "ok",
			} as unknown as AgentEvent,
			{} as Config,
		);
		handleEvent(
			{
				type: "content_start",
				contentType: "text",
				text: "Now let me check this file.",
			} as unknown as AgentEvent,
			{} as Config,
		);

		expect(output).toContain(
			`\x1b[36m[read_files]\x1b[0m {"path":"/tmp/demo.txt"}`,
		);
		expect(output).toMatch(/⎿.*ok/s);
	});

	it("prints adjacent tool starts on separate lines", () => {
		handleEvent(
			{
				type: "content_start",
				contentType: "tool",
				toolName: "run_commands",
				input: { commands: ["echo one"] },
			} as unknown as AgentEvent,
			{} as Config,
		);
		handleEvent(
			{
				type: "content_start",
				contentType: "tool",
				toolName: "read_files",
				input: { file_paths: ["/tmp/demo.txt"] },
			} as unknown as AgentEvent,
			{} as Config,
		);

		expect(output).toMatch(/\[run_commands\].*\n.*\[read_files\]/s);
	});

	it("does not echo ask_question through the generic tool renderer", () => {
		handleEvent(
			{
				type: "content_start",
				contentType: "tool",
				toolName: "ask_question",
				input: {
					question: "How can I best assist you today?",
					options: [
						"Help me understand or analyze code in a repository",
						"Help me create or edit files",
					],
				},
			} as unknown as AgentEvent,
			{} as Config,
		);
		handleEvent(
			{
				type: "content_end",
				contentType: "tool",
				toolName: "ask_question",
				output: "Help me create or edit files",
			} as unknown as AgentEvent,
			{} as Config,
		);

		expect(output).toBe("");
	});

	it("prints tool errors inline", () => {
		handleEvent(
			{
				type: "content_start",
				contentType: "tool",
				toolName: "team_task",
				input: { action: "create", title: "Draft haiku" },
			} as unknown as AgentEvent,
			{} as Config,
		);
		handleEvent(
			{
				type: "content_end",
				contentType: "tool",
				toolName: "team_task",
				error:
					'✖ Field "status" is not allowed when action=create\n  → at status',
			} as unknown as AgentEvent,
			{} as Config,
		);

		expect(output).toContain(`\x1b[36m[team_task]\x1b[0m create`);
		expect(output).toContain("error:");
		expect(output).toContain(
			'Field "status" is not allowed when action=create',
		);
		expect(output).toContain("→ at status");
	});

	it("prints completed done events as finished in verbose mode", () => {
		handleEvent(
			{
				type: "done",
				reason: "completed",
				iterations: 5,
				text: "ok",
			} as unknown as AgentEvent,
			{ verbose: true } as Config,
		);

		expect(output).toContain("── finished (5 iterations) ──");
		expect(output).not.toContain("── aborted (5 iterations) ──");
	});

	it("prints aborted done events as aborted in verbose mode", () => {
		handleEvent(
			{
				type: "done",
				reason: "aborted",
				iterations: 2,
				text: "aborted",
			} as unknown as AgentEvent,
			{ verbose: true } as Config,
		);

		expect(output).toContain("── aborted (2 iterations) ──");
	});

	it("prints Cline insufficient credits errors with a dashboard link", () => {
		handleEvent(
			{
				type: "error",
				error: new Error("Error: Insufficient balance"),
				recoverable: false,
				iteration: 1,
				errorInfo: {
					kind: "provider",
					providerId: "cline",
					modelId: "openai/gpt-5.4",
					message: "Not enough credits available",
					code: "insufficient_credits",
					status: 402,
					details: {
						current_balance: -0,
						buy_credits_url:
							"https://app.cline.bot/dashboard/account?tab=credits",
					},
				},
			} as unknown as AgentEvent,
			{} as Config,
		);

		expect(errorOutput).toContain("Cline Credits depleted");
		expect(errorOutput).toContain("You have run out of Cline credits");
		expect(errorOutput).toContain("Current balance: $0.00");
		expect(errorOutput).toContain(
			"https://app.cline.bot/dashboard/account?tab=credits",
		);
		expect(errorOutput).not.toContain("Insufficient balance");
	});

	it("prints Cline account auth errors with an account command", () => {
		handleEvent(
			{
				type: "error",
				error: new Error("Cline account authentication requires sign in."),
				recoverable: false,
				iteration: 1,
				errorInfo: {
					kind: "auth",
					providerId: "cline",
					code: "cline_account_auth_required",
					message: "Cline account authentication requires sign in.",
				},
			} as unknown as AgentEvent,
			{} as Config,
		);

		expect(errorOutput).toContain("Cline account sign-in required");
		expect(errorOutput).toContain("Sign in to your Cline account to continue");
		expect(errorOutput).toContain("Open /account to sign in");
		expect(errorOutput).not.toContain("authentication requires sign in.");
	});

	it("prints provider-stream Cline account auth errors with an account command", () => {
		handleEvent(
			{
				type: "error",
				error: new Error("Unauthorized"),
				recoverable: false,
				iteration: 1,
				errorInfo: {
					kind: "provider",
					providerId: "cline",
					modelId: "openai/gpt-5.4",
					code: "cline_account_auth_required",
					status: 401,
					message: "Cline account authentication requires sign in.",
				},
			} as unknown as AgentEvent,
			{} as Config,
		);

		expect(errorOutput).toContain("Cline account sign-in required");
		expect(errorOutput).toContain("Sign in to your Cline account to continue");
		expect(errorOutput).toContain("Open /account to sign in");
		expect(errorOutput).not.toContain("Unauthorized");
	});

	it("emits special errors as structured agent events in JSON mode", () => {
		setCurrentOutputMode("json");
		handleEvent(
			{
				type: "error",
				error: new Error("Error: Insufficient balance"),
				recoverable: false,
				iteration: 1,
				errorInfo: {
					kind: "provider",
					providerId: "cline",
					modelId: "openai/gpt-5.4",
					message: "Not enough credits available",
					code: "insufficient_credits",
					status: 402,
				},
			} as unknown as AgentEvent,
			{} as Config,
		);

		expect(errorOutput).toBe("");
		const record: unknown = JSON.parse(output);
		expect(record).toMatchObject({
			type: "agent_event",
			event: {
				type: "error",
				errorInfo: {
					kind: "provider",
					providerId: "cline",
					code: "insufficient_credits",
				},
			},
		});
	});

	it("suppresses heartbeat-only team progress messages", () => {
		handleTeamEvent({
			type: "run_progress",
			run: {
				id: "run_00001",
				agentId: "worker-1",
			},
			message: "heartbeat",
		} as unknown as TeamEvent);

		expect(output).toBe("");
	});

	it("marks queued and started team runs as active", () => {
		handleTeamEvent({
			type: "run_queued",
			run: {
				id: "run_00001",
				agentId: "worker-1",
			},
		} as unknown as TeamEvent);
		handleTeamEvent({
			type: "run_started",
			run: {
				id: "run_00001",
				agentId: "worker-1",
			},
		} as unknown as TeamEvent);

		expect(output).toContain("queued");
		expect(output).toContain("started");
		expect(output).toContain("...");
		// Consecutive team events should not have blank lines between them
		expect(output).not.toMatch(/\n\n/);
	});

	it("closes inline reasoning before team events and terminates the line", () => {
		handleEvent(
			{
				type: "content_start",
				contentType: "reasoning",
				reasoning: "Investigating",
			} as unknown as AgentEvent,
			{} as Config,
		);
		handleTeamEvent({
			type: "run_started",
			run: {
				id: "run_00001",
				agentId: "worker-1",
			},
		} as unknown as TeamEvent);

		expect(output).toMatch(/Investigating.*\n.*\[team run\].*started.*\n$/s);
	});
});
