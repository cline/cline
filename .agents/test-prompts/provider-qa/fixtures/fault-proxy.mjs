#!/usr/bin/env node
// OpenAI-compatible mock server used as the "wire observer" for provider QA.
//
// Every request is appended to a JSONL log so a test can prove which model id
// actually left the extension, independent of what the UI or providers.json say.
//
// Behaviour is keyed off the requested model id, so a single endpoint can stand
// in for a healthy provider, a rate-limited one, a context-overflow, etc.

import fs from "node:fs"
import http from "node:http"
import path from "node:path"

const PORT = Number(process.env.QA_PROXY_PORT || 8788)
const HOST = "127.0.0.1"
const LOG_DIR = process.env.QA_PROXY_DIR || "/tmp/cline-qa/proxy"
const LOG_FILE = path.join(LOG_DIR, "requests.log")

fs.mkdirSync(LOG_DIR, { recursive: true })

// Model ids whose names describe the failure they inject. `fault/ok` and
// `fault/ok-no-cache` form a deliberate prefix pair for the B2-prefix case.
const FAULT_MODELS = [
	"fault/ok",
	"fault/ok-no-cache",
	"fault/ok-slow",
	"fault/ok-drip",
	"fault/429",
	"fault/401",
	"fault/500",
	"fault/context-overflow",
	"fault/empty-stream",
	"fault/invalid-json",
]

// Filler entries so list length, substring filtering and keyboard navigation are
// all testable against a list that is not trivially short.
const CATALOG_MODELS = [
	"probe/claude-sonnet-4-5",
	"probe/claude-sonnet-4-5-thinking",
	"probe/claude-haiku-4-5",
	"probe/claude-opus-4-1",
	"probe/gpt-4.1",
	"probe/gpt-4.1-mini",
	"probe/gpt-4.1-nano",
	"probe/gpt-5.1",
	"probe/gpt-5.1-codex",
	"probe/llama-3.3-70b",
	"probe/llama-3.1-8b",
	"probe/mixtral-8x7b",
	"probe/gemini-2.5-pro",
	"probe/gemini-2.5-flash",
	"probe/deepseek-chat",
	"probe/deepseek-reasoner",
	"probe/qwen-2.5-coder-32b",
	"probe/mistral-large",
]

const ALL_MODELS = [...FAULT_MODELS, ...CATALOG_MODELS]

function logRequest(entry) {
	fs.appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`)
}

function readBody(req) {
	return new Promise((resolve) => {
		const chunks = []
		req.on("data", (c) => chunks.push(c))
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
	})
}

function sendJson(res, status, body) {
	const payload = JSON.stringify(body)
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	})
	res.end(payload)
}

function sseHeaders(res) {
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	})
}

// Emit a minimal but well-formed OpenAI streaming completion. When gapMs is set
// the chunks are spaced out, which keeps a response visibly streaming long
// enough to interrupt it (used by the mid-task reload case).
async function streamText(res, model, text, gapMs = 0) {
	sseHeaders(res)
	const id = `chatcmpl-qa-${Date.now()}`
	const base = { id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model }

	res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`)
	for (const piece of text.match(/.{1,8}/gs) ?? []) {
		if (gapMs) await sleep(gapMs)
		if (res.writableEnded) return
		res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })}\n\n`)
	}
	res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`)
	res.write(
		`data: ${JSON.stringify({
			...base,
			choices: [],
			usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
		})}\n\n`,
	)
	res.write("data: [DONE]\n\n")
	res.end()
}

function nonStreamText(res, model, text) {
	sendJson(res, 200, {
		id: `chatcmpl-qa-${Date.now()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
		usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
	})
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function handleChatCompletions(req, res, body) {
	let parsed = {}
	try {
		parsed = JSON.parse(body || "{}")
	} catch {
		/* logged as model=<unparseable> below */
	}
	const model = typeof parsed.model === "string" ? parsed.model : "<none>"
	const stream = parsed.stream !== false

	logRequest({
		ts: new Date().toISOString(),
		method: req.method,
		path: req.url,
		model,
		stream,
		headers: req.headers,
		body: body?.slice(0, 20000) ?? "",
	})

	// The reply text names the model the proxy was actually asked for, so a
	// rendered chat bubble is itself evidence of what went on the wire.
	switch (model) {
		case "fault/429":
			return sendJson(res, 429, {
				error: {
					message: "Rate limit reached for fault/429. Please retry after 30s.",
					type: "rate_limit_error",
					code: "rate_limit_exceeded",
				},
			})
		case "fault/401":
			return sendJson(res, 401, {
				error: { message: "Incorrect API key provided for fault/401.", type: "invalid_request_error", code: "invalid_api_key" },
			})
		case "fault/500":
			return sendJson(res, 500, { error: { message: "The server had an error processing fault/500.", type: "server_error" } })
		case "fault/context-overflow":
			return sendJson(res, 400, {
				error: {
					message:
						"This model's maximum context length is 8192 tokens. However, your messages resulted in 99999 tokens. Please reduce the length of the messages.",
					type: "invalid_request_error",
					code: "context_length_exceeded",
				},
			})
		case "fault/empty-stream":
			sseHeaders(res)
			res.write("data: [DONE]\n\n")
			return res.end()
		case "fault/invalid-json":
			sseHeaders(res)
			res.write("data: {not json at all\n\n")
			return res.end()
		case "fault/ok-slow":
			await sleep(Number(process.env.QA_PROXY_SLOW_MS || 8000))
			break
		default:
			break
	}

	if (model === "fault/ok-drip") {
		const long = `PONG [served-by:${model}] ${"streaming ".repeat(40)}done`
		return streamText(res, model, long, Number(process.env.QA_PROXY_DRIP_MS || 700))
	}

	const text = `PONG [served-by:${model}]`
	return stream ? streamText(res, model, text) : nonStreamText(res, model, text)
}

const server = http.createServer(async (req, res) => {
	const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : ""
	const url = req.url || "/"

	if (url.endsWith("/chat/completions")) {
		return handleChatCompletions(req, res, body)
	}

	logRequest({
		ts: new Date().toISOString(),
		method: req.method,
		path: url,
		model: null,
		headers: req.headers,
		body: body.slice(0, 4000),
	})

	// Model list. Support both /v1/models and /models so a base URL configured
	// with or without the /v1 suffix still resolves.
	if (req.method === "GET" && /\/models\/?$/.test(url.split("?")[0])) {
		return sendJson(res, 200, {
			object: "list",
			data: ALL_MODELS.map((id) => ({
				id,
				object: "model",
				created: 1700000000,
				owned_by: "qa-fault-proxy",
			})),
		})
	}

	if (url.includes("/api/tags")) {
		// Ollama-shaped list, so an Ollama base URL can be pointed here too.
		return sendJson(res, 200, {
			models: ALL_MODELS.map((id) => ({ name: id, model: id, size: 1, digest: "qa", modified_at: new Date().toISOString() })),
		})
	}

	if (url === "/__qa/health") {
		return sendJson(res, 200, { ok: true, models: ALL_MODELS.length, log: LOG_FILE })
	}

	return sendJson(res, 404, { error: { message: `qa-fault-proxy: no route for ${req.method} ${url}`, type: "invalid_request_error" } })
})

server.listen(PORT, HOST, () => {
	process.stdout.write(`qa-fault-proxy listening on http://${HOST}:${PORT}/v1 (log: ${LOG_FILE})\n`)
})
