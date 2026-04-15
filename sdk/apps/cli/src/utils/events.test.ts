import type { AgentEvent, TeamEvent } from "@clinebot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, handleTeamEvent } from "./events";
import { setCurrentOutputMode } from "./output";
import type { Config } from "./types";

describe("handleEvent text formatting", () => {
	let output = "";

	beforeEach(() => {
		output = "";
		setCurrentOutputMode("text");
		vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
			output += String(chunk);
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
			`\x1b[36m⏺ [read_files]\x1b[0m {"path":"/tmp/demo.txt"}`,
		);
		expect(output).toContain("⎿ ok");
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
