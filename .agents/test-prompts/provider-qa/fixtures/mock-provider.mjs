#!/usr/bin/env node
/**
 * Fault-injecting OpenAI-compatible mock provider for provider QA.
 *
 * Speaks `/v1/chat/completions` faithfully (SSE), plus a deliberately minimal
 * `/v1/responses`. The model id selects the wire-level pathology to inject, so
 * Cline's tool-call handling can be exercised without any real credentials.
 *
 * Every request is appended to a JSONL log so the advertised tool schemas
 * (`body.tools`) can be inspected after the fact.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";

function parseArgs(argv) {
	const out = {
		port: 8788,
		workspace: "/tmp/cline-qa/tools/workspace",
		log: "/tmp/cline-qa/proxy/requests.jsonl",
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--port") out.port = Number(argv[++i]);
		else if (arg === "--workspace") out.workspace = argv[++i];
		else if (arg === "--log") out.log = argv[++i];
	}
	return out;
}

const OPTS = parseArgs(process.argv.slice(2));
mkdirSync(dirname(OPTS.log), { recursive: true });

/** Content used by the unicode-integrity cases. Line four starts with a tab. */
const UNICODE_BLOCK = [
	'line one with "double quotes" and \'single quotes\'',
	"line two with a backslash \\ and a brace }",
	"line three with an em dash — and an emoji 🚀",
	"\tline four starts with a tab",
].join("\n");

const LONG_BLOCK = Array.from(
	{ length: 400 },
	(_, i) => `line ${String(i + 1).padStart(4, "0")} of the long payload`,
).join("\n");

function qaFile(name) {
	return join(OPTS.workspace, name);
}

/**
 * The pathologies. Each entry maps a phase (how many tool results the model has
 * already been handed) to the actions the mock should stream back.
 *
 * action kinds:
 *   text  { text }
 *   tool  { id, name, args }              arguments serialized as compact JSON
 *   tool  { id, name, rawArgs }           arguments emitted verbatim (may be invalid JSON)
 *   tool  { ..., stream: "char" }         arguments split one character per delta
 */
const MODELS = {
	/** A well-behaved agent that performs the canonical task correctly. */
	"fault/ok": (ctx) => {
		if (ctx.phase === 0) {
			return [
				{
					kind: "text",
					text: "I'll replace john with cline in qa.txt.",
				},
				{
					kind: "tool",
					id: "call_ok_edit",
					name: "editor",
					args: {
						path: qaFile("qa.txt"),
						old_text: "john",
						new_text: "cline",
					},
				},
			];
		}
		if (ctx.phase === 1) {
			return [
				{
					kind: "tool",
					id: "call_ok_run",
					name: "run_commands",
					args: { commands: ["cat qa.txt"] },
				},
			];
		}
		return [{ kind: "final", text: `cat qa.txt printed: ${ctx.lastToolText}` }];
	},

	/** D3-baseline: one clean editor call. */
	"fault/tool-edit": (ctx) => {
		if (ctx.phase === 0) {
			return [
				{
					kind: "tool",
					id: "call_edit_1",
					name: "editor",
					args: {
						path: qaFile("qa.txt"),
						old_text: "john",
						new_text: "cline",
					},
				},
			];
		}
		return [{ kind: "final", text: `editor returned: ${ctx.lastToolText}` }];
	},

	/** D3-multi: editor and run_commands in a single assistant response. */
	"fault/tool-edit-and-run": (ctx) => {
		if (ctx.phase === 0) {
			return [
				{
					kind: "tool",
					id: "call_multi_edit",
					name: "editor",
					args: {
						path: qaFile("qa.txt"),
						old_text: "john",
						new_text: "cline",
					},
				},
				{
					kind: "tool",
					id: "call_multi_run",
					name: "run_commands",
					args: { commands: ["cat qa.txt"] },
				},
			];
		}
		return [
			{
				kind: "final",
				text: `results(${ctx.toolTexts.length}): ${ctx.toolTexts.join(" || ")}`,
			},
		];
	},

	/** D3-duplicate: the identical edit twice, different call ids. */
	"fault/tool-duplicate": (ctx) => {
		if (ctx.phase === 0) {
			const args = {
				path: qaFile("qa.txt"),
				old_text: "john",
				new_text: "cline",
			};
			return [
				{ kind: "tool", id: "call_dup_a", name: "editor", args },
				{ kind: "tool", id: "call_dup_b", name: "editor", args },
			];
		}
		return [
			{
				kind: "final",
				text: `results(${ctx.toolTexts.length}): ${ctx.toolTexts.join(" || ")}`,
			},
		];
	},

	/**
	 * A duplicate whose edit is *not* self-cancelling: inserting the same line
	 * twice succeeds twice, so a silent double-apply is visible in the file.
	 */
	"fault/tool-duplicate-insert": (ctx) => {
		if (ctx.phase === 0) {
			const args = {
				path: qaFile("qa.txt"),
				new_text: "DUPLICATE_MARKER\n",
				insert_line: 1,
			};
			return [
				{ kind: "tool", id: "call_dupins_a", name: "editor", args },
				{ kind: "tool", id: "call_dupins_b", name: "editor", args },
			];
		}
		return [
			{
				kind: "final",
				text: `results(${ctx.toolTexts.length}): ${ctx.toolTexts.join(" || ")}`,
			},
		];
	},

	/** D3-mangled: syntactically invalid JSON arguments. */
	"fault/tool-mangled-args": (ctx) => {
		if (ctx.phase === 0) {
			return [
				{
					kind: "tool",
					id: "call_mangled_1",
					name: "editor",
					rawArgs: `{"path": "${qaFile("qa.txt")}", "old_text": "john", "new_text": }`,
				},
			];
		}
		return [{ kind: "final", text: `after mangled: ${ctx.lastToolText}` }];
	},

	/** D3-split: arguments streamed one character per delta. */
	"fault/tool-split-args": (ctx) => {
		if (ctx.phase === 0) {
			return [
				{
					kind: "tool",
					id: "call_split_1",
					name: "editor",
					stream: "char",
					args: {
						path: qaFile("qa.txt"),
						old_text: "john",
						new_text: "cline",
					},
				},
			];
		}
		return [{ kind: "final", text: `editor returned: ${ctx.lastToolText}` }];
	},

	/** D3-unicode: quotes, newlines, tabs, backslash, em dash, emoji. */
	"fault/tool-unicode-args": (ctx) => {
		if (ctx.phase === 0) {
			return [
				{
					kind: "tool",
					id: "call_unicode_1",
					name: "editor",
					stream: "char",
					args: {
						path: qaFile("qa-unicode.txt"),
						new_text: `${UNICODE_BLOCK}\n`,
					},
				},
			];
		}
		return [{ kind: "final", text: `editor returned: ${ctx.lastToolText}` }];
	},

	/** D2-long analogue: a few hundred lines of new content. */
	"fault/tool-long-args": (ctx) => {
		if (ctx.phase === 0) {
			return [
				{
					kind: "tool",
					id: "call_long_1",
					name: "editor",
					args: {
						path: qaFile("qa-long.txt"),
						new_text: `${LONG_BLOCK}\n`,
					},
				},
			];
		}
		return [{ kind: "final", text: `editor returned: ${ctx.lastToolText}` }];
	},

	/** Text only, for connectivity smoke tests. */
	"fault/text-only": () => [{ kind: "final", text: "PONG" }],
};

const MODEL_IDS = Object.keys(MODELS);

/* ------------------------------------------------------------------ */
/* request introspection                                              */
/* ------------------------------------------------------------------ */

function toolNamesFromChatBody(body) {
	if (!Array.isArray(body?.tools)) return [];
	return body.tools
		.map((t) => t?.function?.name ?? t?.name)
		.filter((n) => typeof n === "string");
}

function toolNamesFromResponsesBody(body) {
	if (!Array.isArray(body?.tools)) return [];
	return body.tools.map((t) => t?.name).filter((n) => typeof n === "string");
}

function textOfContent(content) {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") return part;
				if (typeof part?.text === "string") return part.text;
				return "";
			})
			.join("");
	}
	return "";
}

/** Phase + observed tool results for a chat-completions request. */
function chatContext(body) {
	const messages = Array.isArray(body?.messages) ? body.messages : [];
	const toolTexts = messages
		.filter((m) => m?.role === "tool")
		.map((m) => textOfContent(m.content).trim());
	return {
		phase: toolTexts.length,
		toolTexts,
		lastToolText: toolTexts.length ? toolTexts[toolTexts.length - 1] : "",
		tools: toolNamesFromChatBody(body),
	};
}

/** Phase + observed tool results for a responses request. */
function responsesContext(body) {
	const input = Array.isArray(body?.input) ? body.input : [];
	const toolTexts = input
		.filter((item) => item?.type === "function_call_output")
		.map((item) => textOfContent(item.output).trim());
	return {
		phase: toolTexts.length,
		toolTexts,
		lastToolText: toolTexts.length ? toolTexts[toolTexts.length - 1] : "",
		tools: toolNamesFromResponsesBody(body),
	};
}

/**
 * A `final` action becomes a completion tool call when the host advertises one,
 * so the agent loop terminates instead of being nagged by the completion guard.
 */
function expandFinal(action, ctx) {
	if (action.kind !== "final") return action;
	const completionTool = ctx.tools.includes("attempt_completion")
		? "attempt_completion"
		: ctx.tools.includes("submit_and_exit")
			? "submit_and_exit"
			: undefined;
	if (!completionTool) {
		return { kind: "text", text: action.text };
	}
	return {
		kind: "tool",
		id: `call_done_${Date.now()}`,
		name: completionTool,
		args: { result: action.text },
	};
}

function planFor(modelId, ctx) {
	const factory = MODELS[modelId] ?? MODELS["fault/text-only"];
	const actions = factory(ctx) ?? [];
	return actions.map((action) => expandFinal(action, ctx));
}

/* ------------------------------------------------------------------ */
/* SSE emission                                                       */
/* ------------------------------------------------------------------ */

function argumentFragments(action) {
	const raw =
		typeof action.rawArgs === "string"
			? action.rawArgs
			: JSON.stringify(action.args ?? {});
	if (action.stream === "char") return Array.from(raw);
	return [raw];
}

function sse(res, payload) {
	res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function streamChatCompletion(res, modelId, ctx) {
	const actions = planFor(modelId, ctx);
	const toolActions = actions.filter((a) => a.kind === "tool");

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	const base = {
		id: "chatcmpl-qa",
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: modelId,
	};
	const chunk = (delta, finish = null) =>
		sse(res, {
			...base,
			choices: [{ index: 0, delta, finish_reason: finish }],
		});

	chunk({ role: "assistant", content: "" });

	for (const action of actions) {
		if (action.kind === "text") {
			for (const piece of action.text.match(/.{1,24}/gs) ?? []) {
				chunk({ content: piece });
			}
		}
	}

	toolActions.forEach((action, index) => {
		chunk({
			tool_calls: [
				{
					index,
					id: action.id,
					type: "function",
					function: { name: action.name, arguments: "" },
				},
			],
		});
		for (const fragment of argumentFragments(action)) {
			chunk({
				tool_calls: [{ index, function: { arguments: fragment } }],
			});
		}
	});

	chunk({}, toolActions.length > 0 ? "tool_calls" : "stop");
	sse(res, {
		...base,
		choices: [],
		usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
	});
	res.write("data: [DONE]\n\n");
	res.end();
}

function streamResponses(res, modelId, ctx) {
	const actions = planFor(modelId, ctx);

	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});

	let seq = 0;
	const emit = (payload) => sse(res, { ...payload, sequence_number: seq++ });

	emit({
		type: "response.created",
		response: {
			id: "resp_qa",
			created_at: Math.floor(Date.now() / 1000),
			model: modelId,
		},
	});

	let outputIndex = 0;
	for (const action of actions) {
		if (action.kind === "text") {
			const itemId = `msg_${outputIndex}`;
			emit({
				type: "response.output_item.added",
				output_index: outputIndex,
				item: { type: "message", id: itemId },
			});
			for (const piece of action.text.match(/.{1,24}/gs) ?? []) {
				emit({
					type: "response.output_text.delta",
					item_id: itemId,
					delta: piece,
				});
			}
			outputIndex += 1;
			continue;
		}

		const itemId = `fc_${action.id}`;
		emit({
			type: "response.output_item.added",
			output_index: outputIndex,
			item: {
				type: "function_call",
				id: itemId,
				call_id: action.id,
				name: action.name,
				arguments: "",
			},
		});
		const fragments = argumentFragments(action);
		for (const fragment of fragments) {
			emit({
				type: "response.function_call_arguments.delta",
				item_id: itemId,
				output_index: outputIndex,
				delta: fragment,
			});
		}
		emit({
			type: "response.output_item.done",
			output_index: outputIndex,
			item: {
				type: "function_call",
				id: itemId,
				call_id: action.id,
				name: action.name,
				arguments: fragments.join(""),
				status: "completed",
			},
		});
		outputIndex += 1;
	}

	emit({
		type: "response.completed",
		response: {
			usage: { input_tokens: 100, output_tokens: 20 },
		},
	});
	res.write("data: [DONE]\n\n");
	res.end();
}

/* ------------------------------------------------------------------ */
/* server                                                             */
/* ------------------------------------------------------------------ */

function readBody(req) {
	return new Promise((resolve) => {
		let raw = "";
		req.on("data", (c) => {
			raw += c;
		});
		req.on("end", () => {
			try {
				resolve({ raw, json: raw ? JSON.parse(raw) : {} });
			} catch {
				resolve({ raw, json: {} });
			}
		});
	});
}

function logRequest(entry) {
	appendFileSync(OPTS.log, `${JSON.stringify(entry)}\n`);
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	const path = url.pathname.replace(/\/+$/, "") || "/";

	if (req.method === "GET" && (path === "/__health" || path === "/")) {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				ok: true,
				workspace: OPTS.workspace,
				log: OPTS.log,
				models: MODEL_IDS,
			}),
		);
		return;
	}

	if (req.method === "POST" && path === "/__reset") {
		writeFileSync(OPTS.log, "");
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ ok: true, reset: true }));
		return;
	}

	if (req.method === "GET" && path === "/__log") {
		let body = "";
		try {
			body = readFileSync(OPTS.log, "utf8");
		} catch {
			body = "";
		}
		res.writeHead(200, { "Content-Type": "text/plain" });
		res.end(body);
		return;
	}

	if (req.method === "GET" && (path === "/v1/models" || path === "/models")) {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				object: "list",
				data: MODEL_IDS.map((id) => ({
					id,
					object: "model",
					created: 1,
					owned_by: "cline-qa",
				})),
			}),
		);
		return;
	}

	if (req.method !== "POST") {
		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: { message: `no route for ${path}` } }));
		return;
	}

	const { json: body } = await readBody(req);
	const isResponses = path === "/v1/responses" || path === "/responses";
	const isChat =
		path === "/v1/chat/completions" || path === "/chat/completions";

	if (!isResponses && !isChat) {
		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: { message: `no route for ${path}` } }));
		return;
	}

	const modelId = typeof body?.model === "string" ? body.model : "fault/ok";
	const ctx = isResponses ? responsesContext(body) : chatContext(body);

	logRequest({
		at: new Date().toISOString(),
		path,
		api: isResponses ? "responses" : "chat",
		model: modelId,
		phase: ctx.phase,
		toolsAdvertised: ctx.tools,
		toolResultsSeen: ctx.toolTexts,
		body,
	});

	if (isResponses) {
		streamResponses(res, modelId, ctx);
	} else {
		streamChatCompletion(res, modelId, ctx);
	}
});

server.listen(OPTS.port, "127.0.0.1", () => {
	process.stdout.write(
		`qa mock provider listening on http://127.0.0.1:${OPTS.port}\n` +
			`  workspace: ${OPTS.workspace}\n` +
			`  log:       ${OPTS.log}\n` +
			`  models:    ${MODEL_IDS.join(", ")}\n`,
	);
});
