#!/usr/bin/env node
/**
 * An OpenAI-compatible endpoint whose behaviour is selected by the model id, so
 * a tester can reproduce a failure mode by picking a model in the UI instead of
 * hand-crafting HTTP traffic or waiting for a real provider to rate-limit them.
 *
 * Point any Cline host at it with the "OpenAI Compatible" provider:
 *   Base URL: http://127.0.0.1:8788/v1
 *   API Key:  anything non-empty
 *   Model:    one of the `fault/*` ids below (also served from /v1/models)
 *
 * Every inbound request is appended to a JSONL log, so the same server doubles
 * as the way to prove that a provider setting (custom header, base URL,
 * timeout, reasoning effort, ...) actually reached the wire rather than merely
 * surviving in the settings UI.
 *
 * Scope note: chat-completions is implemented faithfully. /v1/responses only
 * implements error injection and plain text, because the Responses-API
 * tool-calling semantics are exactly the thing you should be testing against
 * real OpenAI / Codex credentials rather than against a mock.
 *
 * Usage:
 *   node fault-proxy.mjs [--port 8788] [--log /tmp/fault-proxy.jsonl]
 *   curl -s localhost:8788/__requests | tail -1     # last request, pretty JSON
 *   curl -s -XPOST localhost:8788/__reset           # clear the request log
 */

import { appendFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"

const argv = process.argv.slice(2)
const getArg = (flag, fallback) => {
	const i = argv.indexOf(flag)
	return i === -1 ? fallback : argv[i + 1]
}

const PORT = Number(getArg("--port", "8788"))
const LOG_PATH = getArg("--log", "/tmp/fault-proxy.jsonl")

const MODELS = {
	"fault/ok": "Streams a short reply plus usage with cache read/write token counts.",
	"fault/ok-no-cache": "Streams a short reply with usage but no cache token fields.",
	"fault/big-usage": "Streams a short reply reporting 1.2M input / 90k output tokens (cost sanity check).",
	"fault/zero-usage": "Streams a short reply with every usage counter set to zero.",
	"fault/no-usage": "Streams a short reply and omits the usage block entirely.",
	"fault/tool-edit": "Emits one `editor` tool call that rewrites qa.txt, then finishes.",
	"fault/tool-edit-and-run": "Emits an `editor` call and a `run_commands` call in the same response.",
	"fault/tool-duplicate": "Emits the identical `editor` tool call twice with different ids.",
	"fault/tool-mangled-args": "Emits an `editor` tool call whose arguments are invalid JSON.",
	"fault/tool-split-args": "Emits an `editor` call with arguments streamed one character per delta.",
	"fault/tool-unicode-args": "Emits an `editor` call whose args contain quotes, newlines and emoji.",
	"fault/401": "Rejects with HTTP 401 invalid_api_key.",
	"fault/402": "Rejects with HTTP 402 insufficient_credits.",
	"fault/429": "Rejects with HTTP 429 rate_limit_exceeded and a Retry-After header.",
	"fault/context-overflow": "Rejects with HTTP 400 context_length_exceeded.",
	"fault/500": "Rejects with HTTP 500 and a non-JSON body.",
	"fault/hang": "Accepts the request and never responds (open-ended silent hang).",
	"fault/truncated-stream": "Starts streaming text and then destroys the socket mid-stream.",
	"fault/slow-stream": "Streams one token every 3s for 10 tokens (cancellation testing).",
}

let requestSeq = 0

function log(entry) {
	appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`)
}

function readBody(req) {
	return new Promise((resolve) => {
		let raw = ""
		req.on("data", (chunk) => {
			raw += chunk
		})
		req.on("end", () => resolve(raw))
	})
}

function sendJson(res, status, payload, headers = {}) {
	const body = JSON.stringify(payload)
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(body),
		...headers,
	})
	res.end(body)
}

function openStream(res) {
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	})
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function chunk(model, delta, finishReason = null, extra = {}) {
	return {
		id: `chatcmpl-fault-${requestSeq}`,
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
		...extra,
	}
}

function write(res, payload) {
	res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function usageBlock(kind) {
	switch (kind) {
		case "cache":
			return {
				prompt_tokens: 4213,
				completion_tokens: 118,
				total_tokens: 4331,
				prompt_tokens_details: { cached_tokens: 3072 },
				// Anthropic-flavoured aliases that several adapters read instead.
				cache_read_input_tokens: 3072,
				cache_creation_input_tokens: 1024,
			}
		case "no-cache":
			return { prompt_tokens: 4213, completion_tokens: 118, total_tokens: 4331 }
		case "big":
			return {
				prompt_tokens: 1_200_000,
				completion_tokens: 90_000,
				total_tokens: 1_290_000,
				prompt_tokens_details: { cached_tokens: 400_000 },
			}
		case "zero":
			return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
		default:
			return null
	}
}

const EDITOR_ARGS = {
	path: "qa.txt",
	old_text: "john",
	new_text: "cline",
}

const RUN_COMMAND_ARGS = {
	commands: ["cat qa.txt"],
}

function toolCallDelta(index, id, name, argumentsChunk) {
	return {
		tool_calls: [
			{
				index,
				id,
				type: "function",
				function: { name, arguments: argumentsChunk },
			},
		],
	}
}

async function streamText(res, model, text, usageKind, { delayMs = 0 } = {}) {
	openStream(res)
	write(res, chunk(model, { role: "assistant", content: "" }))
	for (const word of text.split(" ")) {
		if (delayMs) await sleep(delayMs)
		write(res, chunk(model, { content: `${word} ` }))
	}
	const usage = usageBlock(usageKind)
	write(res, chunk(model, {}, "stop", usage ? { usage } : {}))
	res.write("data: [DONE]\n\n")
	res.end()
}

async function handleChatCompletions(req, res, body) {
	const model = body?.model ?? "fault/ok"

	switch (model) {
		case "fault/401":
			return sendJson(res, 401, {
				error: {
					message: "Incorrect API key provided. You can find your API key at https://example.invalid/keys.",
					type: "invalid_request_error",
					param: null,
					code: "invalid_api_key",
				},
			})

		case "fault/402":
			return sendJson(res, 402, {
				error: {
					message: "Insufficient credits. Add credits to your account to continue.",
					type: "insufficient_quota",
					code: "insufficient_credits",
				},
			})

		case "fault/429":
			return sendJson(
				res,
				429,
				{
					error: {
						message:
							"Rate limit reached for fault/429 in organization org-qa on requests per min (RPM): Limit 3, Used 3. Please try again in 20s.",
						type: "rate_limit_error",
						code: "rate_limit_exceeded",
					},
				},
				{ "retry-after": "20" },
			)

		case "fault/context-overflow":
			return sendJson(res, 400, {
				error: {
					message:
						"This model's maximum context length is 8192 tokens. However, your messages resulted in 41027 tokens. Please reduce the length of the messages.",
					type: "invalid_request_error",
					param: "messages",
					code: "context_length_exceeded",
				},
			})

		case "fault/500":
			res.writeHead(500, { "content-type": "text/html" })
			return res.end("<html><body><h1>502 Bad Gateway</h1><p>upstream connect error</p></body></html>")

		case "fault/hang":
			// Deliberately never respond and never close.
			return

		case "fault/truncated-stream": {
			openStream(res)
			write(res, chunk(model, { role: "assistant", content: "" }))
			write(res, chunk(model, { content: "This response will be cut off mid-" }))
			await sleep(150)
			return res.destroy()
		}

		case "fault/slow-stream":
			return streamText(res, model, "one two three four five six seven eight nine ten", "no-cache", {
				delayMs: 3000,
			})

		case "fault/tool-edit": {
			openStream(res)
			write(res, chunk(model, { role: "assistant", content: "" }))
			write(res, chunk(model, { content: "Replacing john with cline in qa.txt." }))
			write(res, chunk(model, toolCallDelta(0, "call_fault_edit_1", "editor", JSON.stringify(EDITOR_ARGS))))
			write(res, chunk(model, {}, "tool_calls", { usage: usageBlock("cache") }))
			res.write("data: [DONE]\n\n")
			return res.end()
		}

		case "fault/tool-edit-and-run": {
			openStream(res)
			write(res, chunk(model, { role: "assistant", content: "" }))
			write(res, chunk(model, { content: "Editing the file and then printing it." }))
			write(res, chunk(model, toolCallDelta(0, "call_fault_edit_2", "editor", JSON.stringify(EDITOR_ARGS))))
			write(res, chunk(model, toolCallDelta(1, "call_fault_run_2", "run_commands", JSON.stringify(RUN_COMMAND_ARGS))))
			write(res, chunk(model, {}, "tool_calls", { usage: usageBlock("cache") }))
			res.write("data: [DONE]\n\n")
			return res.end()
		}

		case "fault/tool-duplicate": {
			openStream(res)
			write(res, chunk(model, { role: "assistant", content: "" }))
			write(res, chunk(model, toolCallDelta(0, "call_fault_dup_a", "editor", JSON.stringify(EDITOR_ARGS))))
			write(res, chunk(model, toolCallDelta(1, "call_fault_dup_b", "editor", JSON.stringify(EDITOR_ARGS))))
			write(res, chunk(model, {}, "tool_calls", { usage: usageBlock("no-cache") }))
			res.write("data: [DONE]\n\n")
			return res.end()
		}

		case "fault/tool-mangled-args": {
			openStream(res)
			write(res, chunk(model, { role: "assistant", content: "" }))
			write(res, chunk(model, toolCallDelta(0, "call_fault_bad", "editor", '{"path": "qa.txt", "old_text": "john"')))
			write(res, chunk(model, {}, "tool_calls", { usage: usageBlock("no-cache") }))
			res.write("data: [DONE]\n\n")
			return res.end()
		}

		case "fault/tool-split-args": {
			openStream(res)
			write(res, chunk(model, { role: "assistant", content: "" }))
			write(res, chunk(model, toolCallDelta(0, "call_fault_split", "editor", "")))
			for (const char of JSON.stringify(EDITOR_ARGS)) {
				write(res, chunk(model, { tool_calls: [{ index: 0, function: { arguments: char } }] }))
			}
			write(res, chunk(model, {}, "tool_calls", { usage: usageBlock("no-cache") }))
			res.write("data: [DONE]\n\n")
			return res.end()
		}

		case "fault/tool-unicode-args": {
			const args = {
				path: "qa.txt",
				old_text: "john",
				new_text: 'cline said "héllo"\n\tsecond line — em dash 🚀\nbackslash \\ and brace }',
			}
			openStream(res)
			write(res, chunk(model, { role: "assistant", content: "" }))
			write(res, chunk(model, toolCallDelta(0, "call_fault_unicode", "editor", JSON.stringify(args))))
			write(res, chunk(model, {}, "tool_calls", { usage: usageBlock("no-cache") }))
			res.write("data: [DONE]\n\n")
			return res.end()
		}

		case "fault/big-usage":
			return streamText(res, model, "Reporting an implausibly large usage block.", "big")

		case "fault/zero-usage":
			return streamText(res, model, "Reporting an all-zero usage block.", "zero")

		case "fault/no-usage":
			return streamText(res, model, "Reporting no usage block at all.", "none")

		case "fault/ok-no-cache":
			return streamText(res, model, "PONG from the fault proxy.", "no-cache")

		default:
			return streamText(res, model, "PONG from the fault proxy.", "cache")
	}
}

function handleResponses(req, res, body) {
	const model = body?.model ?? "fault/ok"
	if (model.startsWith("fault/4") || model.startsWith("fault/5") || model === "fault/context-overflow") {
		// Error bodies are protocol-independent, so reuse the chat-completions ones.
		return handleChatCompletions(req, res, body)
	}
	openStream(res)
	const responseId = `resp_fault_${requestSeq}`
	res.write(
		`data: ${JSON.stringify({ type: "response.created", response: { id: responseId, model, status: "in_progress" } })}\n\n`,
	)
	res.write(
		`data: ${JSON.stringify({ type: "response.output_text.delta", item_id: "msg_1", output_index: 0, delta: "PONG from the fault proxy." })}\n\n`,
	)
	res.write(
		`data: ${JSON.stringify({
			type: "response.completed",
			response: {
				id: responseId,
				model,
				status: "completed",
				output: [
					{
						id: "msg_1",
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "PONG from the fault proxy." }],
					},
				],
				usage: {
					input_tokens: 4213,
					output_tokens: 118,
					total_tokens: 4331,
					input_tokens_details: { cached_tokens: 3072 },
				},
			},
		})}\n\n`,
	)
	res.write("data: [DONE]\n\n")
	res.end()
}

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://${req.headers.host}`)
	const raw = await readBody(req)
	let body = null
	try {
		body = raw ? JSON.parse(raw) : null
	} catch {
		body = { __unparsed: raw }
	}

	requestSeq += 1
	const entry = {
		seq: requestSeq,
		at: new Date().toISOString(),
		method: req.method,
		path: url.pathname,
		query: Object.fromEntries(url.searchParams),
		headers: req.headers,
		body,
	}
	if (!url.pathname.startsWith("/__")) {
		log(entry)
		console.log(`[${entry.seq}] ${req.method} ${url.pathname} model=${body?.model ?? "-"}`)
	}

	if (url.pathname === "/__requests") {
		return sendJson(res, 200, { count: requestSeq, logPath: LOG_PATH })
	}
	if (url.pathname === "/__reset") {
		writeFileSync(LOG_PATH, "")
		requestSeq = 0
		return sendJson(res, 200, { ok: true })
	}
	if (url.pathname === "/__last") {
		return sendJson(res, 200, entry)
	}

	if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
		return sendJson(res, 200, {
			object: "list",
			data: Object.entries(MODELS).map(([id, description]) => ({
				id,
				object: "model",
				created: 1_700_000_000,
				owned_by: "cline-qa",
				description,
			})),
		})
	}

	if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
		return handleChatCompletions(req, res, body)
	}
	if (req.method === "POST" && url.pathname.endsWith("/responses")) {
		return handleResponses(req, res, body)
	}

	return sendJson(res, 404, { error: { message: `No fault-proxy route for ${req.method} ${url.pathname}` } })
})

server.on("clientError", (_err, socket) => socket.destroy())

server.listen(PORT, "127.0.0.1", () => {
	writeFileSync(LOG_PATH, "")
	console.log(`fault-proxy listening on http://127.0.0.1:${PORT}/v1  (request log: ${LOG_PATH})`)
	console.log("Models:")
	for (const [id, description] of Object.entries(MODELS)) {
		console.log(`  ${id.padEnd(26)} ${description}`)
	}
})
