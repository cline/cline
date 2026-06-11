#!/usr/bin/env bun
/**
 * Request-size verification harness CLI.
 *
 * Prints how much of a transcript survives `MessageBuilder.buildForApi()`:
 *   - raw transcript serialized size
 *   - post-buildForApi serialized size
 *   - provider-formatted (AI SDK) payload size before/after
 *   - largest nested tool-result string before/after
 *   - estimated percent reduction
 *
 * Usage:
 *   bun scripts/report-request-size.ts                # synthetic huge run_commands transcript
 *   bun scripts/report-request-size.ts <messages.json> # a Message[] transcript file
 *
 * The synthetic transcript mirrors the real `ToolOperationResult[]` shape the
 * default tools emit (untyped `{query, result, success}` entries stored
 * directly in tool_result content), which is the request-bloat path this
 * harness exists to watch.
 */

import { readFileSync } from "node:fs";
import type { Message } from "@cline/shared";
import {
	buildMessageSizeReport,
	formatMessageSizeReport,
} from "../src/session/services/message-size-report";

function syntheticTranscript(): Message[] {
	const hugeOutput = [
		"==> head of command output <==",
		"line ".repeat(400_000),
		"==> tail of command output <==",
	].join("\n");
	const hugeFile = ["// head of file", "x".repeat(1_500_000), "// EOF"].join(
		"\n",
	);

	return [
		{
			role: "user",
			content: [{ type: "text", text: "inspect the repo and run the tests" }],
		},
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "call_run",
					name: "run_commands",
					input: { commands: ["npm test 2>&1"] },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_run",
					name: "run_commands",
					content: [
						{
							query: "npm test 2>&1",
							result: hugeOutput,
							success: true,
							duration: 5230,
						},
					] as never,
				},
			],
		},
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "call_read",
					name: "read_files",
					input: { files: [{ path: "/repo/dist/bundle.js" }] },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_read",
					name: "read_files",
					content: [
						{
							query: "/repo/dist/bundle.js",
							result: hugeFile,
							success: true,
						},
					] as never,
				},
			],
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "The tests pass. Summarizing now." }],
		},
	];
}

function loadTranscript(path: string): Message[] {
	const parsed = JSON.parse(readFileSync(path, "utf8"));
	if (!Array.isArray(parsed)) {
		throw new Error(`Expected a JSON array of messages in ${path}`);
	}
	return parsed as Message[];
}

const inputPath = process.argv[2];
const messages = inputPath ? loadTranscript(inputPath) : syntheticTranscript();

console.log(
	inputPath
		? `Transcript: ${inputPath} (${messages.length} messages)`
		: `Transcript: synthetic run_commands/read_files sample (${messages.length} messages)`,
);
console.log(formatMessageSizeReport(buildMessageSizeReport(messages)));
