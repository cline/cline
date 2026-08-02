/**
 * End-to-end coverage for XML tool calling (`toolCallingMode: "xml"`).
 *
 * Runs real ClineCore sessions with the real built-in tools against a local
 * OpenAI-compatible server whose "model" only ever emits XML text — never
 * structured `tool_calls` — which is the situation the setting exists for.
 *
 * The translation is the `@ai-sdk-tool/parser` morph-XML middleware applied
 * at the model boundary (see `@cline/llms` `providers/xml-tool-calling.ts`),
 * so these tests exercise the real vendor path end to end: tool schemas are
 * stripped from the wire, docs are prompted, XML replies come back as native
 * tool calls, and tool history is serialized to text on the next turn.
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setClineDir } from "@cline/shared/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ClineCore } from "../ClineCore";
import { getClineDefaultSystemPrompt } from "../index";

interface MockRequest {
	system: string;
	messages: Array<{ role: string; content: unknown }>;
	toolNames: string[];
}

interface MockServer {
	baseUrl: string;
	requests: MockRequest[];
	close: () => Promise<void>;
}

/** OpenAI-compatible chat-completions endpoint driven by a scripted reply list. */
async function startMockModel(
	reply: (request: MockRequest, turn: number) => string,
): Promise<MockServer> {
	const requests: MockRequest[] = [];
	let turn = 0;
	const server: Server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			if (!req.url?.includes("chat/completions")) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({ data: [] }));
				return;
			}
			const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			const messages: Array<{ role: string; content: unknown }> =
				body.messages ?? [];
			const system = messages.find(
				(message) => message.role === "system" || message.role === "developer",
			);
			const record: MockRequest = {
				system: typeof system?.content === "string" ? system.content : "",
				messages: messages.filter(
					(message) =>
						message.role !== "system" && message.role !== "developer",
				),
				toolNames: (body.tools ?? []).map(
					(tool: { function?: { name?: string } }) => tool.function?.name ?? "",
				),
			};
			requests.push(record);
			const text = reply(record, turn++);
			const chunk = (delta: unknown, finish: string | null) =>
				`data: ${JSON.stringify({
					id: "chatcmpl-mock",
					object: "chat.completion.chunk",
					created: 0,
					model: body.model,
					choices: [{ index: 0, delta, finish_reason: finish }],
				})}\n\n`;
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.write(chunk({ role: "assistant" }, null));
			res.write(chunk({ content: text }, null));
			res.write(chunk({}, "stop"));
			res.write("data: [DONE]\n\n");
			res.end();
		});
	});
	const port = await new Promise<number>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve((server.address() as { port: number }).port);
		});
	});
	return {
		baseUrl: `http://127.0.0.1:${port}/v1`,
		requests,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
			}),
	};
}

interface RunResult {
	requests: MockRequest[];
	toolCalls: Array<{ name: string; input: unknown; output?: unknown }>;
	text: string;
	cwd: string;
}

async function runSession(options: {
	prompt: string;
	reply: (request: MockRequest, turn: number) => string;
	toolCallingMode?: "native" | "xml";
	enableSpawnAgent?: boolean;
	setup?: (cwd: string) => void;
}): Promise<RunResult> {
	const cwd = mkdtempSync(join(tmpdir(), "cline-xml-e2e-ws-"));
	options.setup?.(cwd);
	// Built-in file tools resolve relative paths against the process cwd.
	process.chdir(cwd);
	const model = await startMockModel(options.reply);
	const toolCalls: RunResult["toolCalls"] = [];
	const cline = await ClineCore.create({
		clientName: "xml-tool-calling-e2e",
		backendMode: "local",
		toolPolicies: { "*": { autoApprove: true } },
	});
	const unsubscribe = cline.subscribe((event) => {
		if (event.type !== "agent_event") return;
		const agentEvent = event.payload.event as {
			type: string;
			contentType?: string;
			toolName?: string;
			input?: unknown;
			output?: unknown;
		};
		if (agentEvent.contentType !== "tool") return;
		if (agentEvent.type === "content_start") {
			toolCalls.push({
				name: agentEvent.toolName ?? "",
				input: agentEvent.input,
			});
		}
		if (agentEvent.type === "content_end") {
			const last = toolCalls.at(-1);
			if (last) last.output = agentEvent.output;
		}
	});
	try {
		const session = await cline.start({
			prompt: options.prompt,
			config: {
				cwd,
				providerId: "openai-compatible",
				modelId: "mock-model",
				apiKey: "test-key",
				baseUrl: model.baseUrl,
				systemPrompt: getClineDefaultSystemPrompt({
					rootPath: cwd,
					mode: "act",
					platform: process.platform,
					providerId: "openai-compatible",
				}),
				enableTools: true,
				enableSpawnAgent: options.enableSpawnAgent ?? false,
				enableAgentTeams: false,
				maxIterations: 10,
				...(options.toolCallingMode
					? { toolCallingMode: options.toolCallingMode }
					: {}),
			},
		});
		return {
			requests: model.requests,
			toolCalls,
			text: session.result?.text ?? "",
			cwd,
		};
	} finally {
		unsubscribe();
		await cline.dispose("test complete");
		await model.close();
	}
}

function scripted(
	lines: string[],
): (request: MockRequest, turn: number) => string {
	return (_request, turn) => lines[turn] ?? "Done.";
}

describe("XML tool calling end to end", () => {
	let previousCwd: string;

	beforeAll(() => {
		previousCwd = process.cwd();
		setClineDir(mkdtempSync(join(tmpdir(), "cline-xml-e2e-home-")));
	});

	afterAll(() => {
		process.chdir(previousCwd);
	});

	it("drives a multi-tool task through XML and feeds results back", async () => {
		const run = await runSession({
			prompt: "Read the notes, then write a greeting module.",
			toolCallingMode: "xml",
			setup: (cwd) => {
				writeFileSync(join(cwd, "notes.txt"), "remember: ship it\n");
			},
			reply: scripted([
				'Let me look at the notes.\n\n<read_files>\n<files>[{"path": "notes.txt"}]</files>\n</read_files>',
				'<editor>\n<path>greeting.py</path>\n<new_text>def greet(name):\n    return f"hello {name}"\n</new_text>\n</editor>',
				'<run_commands>\n<commands>["cat greeting.py"]</commands>\n</run_commands>',
				"All three steps are done.",
			]),
		});

		expect(run.toolCalls.map((call) => call.name)).toEqual([
			"read_files",
			"editor",
			"run_commands",
		]);
		expect(JSON.stringify(run.toolCalls[0]?.output)).toContain(
			"remember: ship it",
		);
		expect(readFileSync(join(run.cwd, "greeting.py"), "utf8")).toContain(
			"def greet",
		);
		expect(JSON.stringify(run.toolCalls[2]?.output)).toContain("def greet");
		expect(run.text).toBe("All three steps are done.");

		// The provider only ever saw XML: no tool schemas, no tool-role messages.
		expect(
			run.requests.every((request) => request.toolNames.length === 0),
		).toBe(true);
		expect(run.requests[0]?.system).toContain(
			"You have access to the following functions:",
		);
		const lastTurn = run.requests.at(-1);
		expect(lastTurn?.messages.some((message) => message.role === "tool")).toBe(
			false,
		);
		// Tool results are serialized into the text wire format...
		expect(JSON.stringify(lastTurn?.messages)).toContain("<tool_response>");
		// ...and prior assistant tool calls are re-serialized as XML.
		expect(JSON.stringify(lastTurn?.messages)).toContain("<editor>");
	});

	it("handles trailing prose and executes every call in a batched reply", async () => {
		const run = await runSession({
			prompt: "Read a.txt and b.txt",
			toolCallingMode: "xml",
			setup: (cwd) => {
				writeFileSync(join(cwd, "a.txt"), "alpha\n");
				writeFileSync(join(cwd, "b.txt"), "beta\n");
			},
			reply: scripted([
				'<read_files>\n<files>[{"path": "a.txt"}]</files>\n</read_files>\n\nLet me know if you need more.',
				'<read_files>\n<files>[{"path": "a.txt"}]</files>\n</read_files>\n\n<read_files>\n<files>[{"path": "b.txt"}]</files>\n</read_files>',
				"Both files read.",
			]),
		});

		// Turn 1's call runs despite the trailing prose; turn 2's two batched
		// calls BOTH run (multiple tool calls per message is part of the
		// native contract, so the parser maps them straight through).
		expect(run.toolCalls.map((call) => call.name)).toEqual([
			"read_files",
			"read_files",
			"read_files",
		]);
		expect(JSON.stringify(run.toolCalls[0]?.output)).toContain("alpha");
		expect(JSON.stringify(run.toolCalls[2]?.output)).toContain("beta");
		// Nothing that looks like a tool call is ever shown to the user as text.
		expect(run.text).not.toContain("<read_files>");
	});

	it("executes a fenced tool call (lenient, like the legacy parser)", async () => {
		// Weak models routinely wrap their *real* tool calls in markdown
		// fences; refusing fenced calls silently stalls exactly the models
		// this mode exists for, so leniency wins over example-quoting safety.
		const run = await runSession({
			prompt: "Read the secret file",
			toolCallingMode: "xml",
			setup: (cwd) => {
				writeFileSync(join(cwd, "secret.txt"), "fenced but real\n");
			},
			reply: scripted([
				'Reading it now:\n\n```xml\n<read_files>\n<files>[{"path": "secret.txt"}]</files>\n</read_files>\n```',
				"Read it.",
			]),
		});

		expect(run.toolCalls.map((call) => call.name)).toEqual(["read_files"]);
		expect(JSON.stringify(run.toolCalls[0]?.output)).toContain(
			"fenced but real",
		);
	});

	it("keeps raw base64 out of XML-mode tool result text", async () => {
		const run = await runSession({
			prompt: "Look at pixel.png",
			toolCallingMode: "xml",
			setup: (cwd) => {
				writeFileSync(
					join(cwd, "pixel.png"),
					Buffer.from(
						"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
						"base64",
					),
				);
			},
			reply: scripted([
				'<read_files>\n<files>[{"path": "pixel.png"}]</files>\n</read_files>',
				"Looks like a single pixel.",
			]),
		});

		const parts = (run.requests[1]?.messages ?? []).flatMap((message) =>
			Array.isArray(message.content)
				? (message.content as Array<{ type: string }>)
				: [{ type: "text", text: message.content }],
		);
		const textParts = JSON.stringify(
			parts.filter((part) => part.type === "text"),
		);
		// Image bytes never leak into the serialized tool result; the
		// middleware replaces them with a typed placeholder. (XML mode targets
		// text-only local models — vision users should stay on native mode.)
		expect(textParts).toContain("[Image: image/png]");
		expect(textParts).not.toContain("iVBORw0KGgo");
	});

	it("passes XML mode down to spawned subagents", async () => {
		const run = await runSession({
			prompt: "Delegate a lookup",
			toolCallingMode: "xml",
			enableSpawnAgent: true,
			reply: (request, turn) => {
				if (request.system.includes("You are a helper.")) {
					return "Nothing to report.";
				}
				return turn === 0
					? "<spawn_agent>\n<systemPrompt>You are a helper.</systemPrompt>\n<task>Look around</task>\n</spawn_agent>"
					: "Delegation complete.";
			},
		});

		const subagentRequests = run.requests.filter((request) =>
			request.system.includes("You are a helper."),
		);
		expect(subagentRequests.length).toBeGreaterThan(0);
		expect(
			subagentRequests.every((request) => request.toolNames.length === 0),
		).toBe(true);
		expect(subagentRequests[0]?.system).toContain(
			"You have access to the following functions:",
		);
	});

	it("leaves native tool calling untouched when the mode is not set", async () => {
		const run = await runSession({
			prompt: "Just say hi",
			reply: scripted(["Hi there."]),
		});

		expect(run.requests[0]?.toolNames).toContain("read_files");
		expect(run.requests[0]?.system).not.toContain(
			"You have access to the following functions:",
		);
		expect(run.text).toBe("Hi there.");
	});
});
