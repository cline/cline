import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import test from "node:test";
import { replayModel } from "../src/scenario-spec.mjs";
import { createHarnessServer } from "../src/server.mjs";

async function withServer(run, options = {}) {
	const server = await createHarnessServer({ port: 0, ...options });
	try {
		await run(server);
	} finally {
		await server.close();
	}
}

function completionBody(model) {
	return {
		model,
		stream: true,
		messages: [{ role: "user", content: "test" }],
		tools: [
			{
				type: "function",
				function: { name: "run_commands", parameters: { type: "object" } },
			},
		],
	};
}

async function completion(server, model, signal) {
	return fetch(`${server.origin}/v1/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(completionBody(model)),
		signal,
	});
}

function parseSse(text) {
	return text
		.split("\n\n")
		.filter((block) => block.startsWith("data: ") && block !== "data: [DONE]")
		.map((block) => JSON.parse(block.slice(6)));
}

function toolArguments(chunks) {
	return chunks
		.map(
			(chunk) =>
				chunk.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments ?? "",
		)
		.join("");
}

test("lists every deterministic scenario as a model", async () => {
	await withServer(async (server) => {
		const response = await fetch(`${server.origin}/v1/models`);
		assert.equal(response.status, 200);
		const body = await response.json();
		assert.ok(body.data.some((model) => model.id === "harness/baseline"));
		assert.ok(
			body.data.some((model) => model.id === "harness/stall-after-tool-start"),
		);
	});
});

test("baseline emits only the fixed callback command and records its execution", async () => {
	await withServer(async (server) => {
		const response = await completion(server, "harness/baseline");
		const traceId = response.headers.get("x-cline-harness-trace-id");
		const chunks = parseSse(await response.text());
		const input = JSON.parse(toolArguments(chunks));
		assert.equal(input.commands.length, 1);
		assert.match(input.commands[0], /^node -e /);
		assert.ok(input.commands[0].includes(`${server.origin}/__harness/marker`));
		assert.ok(input.commands[0].includes(`traceId=${traceId}`));
		assert.equal(chunks.at(-1).choices[0].finish_reason, "tool_calls");

		const child = spawn(input.commands[0], { shell: true, stdio: "pipe" });
		const [exitCode] = await once(child, "exit");
		assert.equal(exitCode, 0);
		assert.ok(
			server.traces.some(
				(entry) =>
					entry.traceId === traceId &&
					entry.event === "command_callback_received",
			),
		);
	});
});

test("the same replay model emits byte-identical SSE and stable replay headers", async () => {
	const model = replayModel({
		scenario: "tool-arguments",
		seed: 4242,
		size: 32_003,
		chunkBytes: 257,
	});
	const firstServer = await createHarnessServer({
		port: 0,
		allowUnreachableReplayCallbacks: true,
	});
	let firstBody;
	let firstReplay;
	let firstFingerprint;
	try {
		const first = await completion(firstServer, model);
		firstBody = Buffer.from(await first.arrayBuffer());
		firstReplay = first.headers.get("x-cline-harness-replay");
		firstFingerprint = first.headers.get("x-cline-harness-fingerprint");
	} finally {
		await firstServer.close();
	}
	const secondServer = await createHarnessServer({
		port: 0,
		allowUnreachableReplayCallbacks: true,
	});
	try {
		const second = await completion(secondServer, model);
		const secondBody = Buffer.from(await second.arrayBuffer());

		assert.deepEqual(secondBody, firstBody);
		assert.equal(second.headers.get("x-cline-harness-replay"), firstReplay);
		assert.equal(
			second.headers.get("x-cline-harness-fingerprint"),
			firstFingerprint,
		);
	} finally {
		await secondServer.close();
	}
});

test("HTTP replay requires explicit extreme opt-in", async () => {
	const model = replayModel({
		scenario: "text",
		seed: 99,
		size: 256 * 1024,
		chunkBytes: 1,
	});
	await withServer(async (server) => {
		const response = await completion(server, model);
		assert.equal(response.status, 400);
		assert.match(await response.text(), /extreme opt-in/i);
	});
	await withServer(
		async (server) => {
			const response = await completion(server, model);
			assert.equal(response.status, 200);
			await response.body.cancel();
		},
		{ allowExtreme: true },
	);
});

test("replay tool callbacks require the standard executable endpoint", async () => {
	const model = replayModel({ scenario: "baseline" });
	await withServer(async (server) => {
		const response = await completion(server, model);
		assert.equal(response.status, 400);
		assert.match(await response.text(), /standard executable endpoint/i);
	});
});

test("aborting a delayed replay stops scheduling later chunks", async () => {
	const model = replayModel({
		scenario: "text",
		seed: 77,
		size: 1024,
		chunkBytes: 1,
		delayMs: 50,
	});
	await withServer(
		async (server) => {
			const controller = new AbortController();
			const response = await completion(server, model, controller.signal);
			const reader = response.body.getReader();
			await reader.read();
			controller.abort();
			await assert.rejects(reader.read());
			await new Promise((resolve) => setTimeout(resolve, 100));
			const before = server.traces.length;
			await new Promise((resolve) => setTimeout(resolve, 150));
			assert.equal(server.traces.length, before);
		},
		{ allowExtreme: true },
	);
});

test("fragmented tool arguments reassemble into the same safe input", async () => {
	await withServer(
		async (server) => {
			const response = await completion(server, "harness/fragmented-tool-call");
			const chunks = parseSse(await response.text());
			const input = JSON.parse(toolArguments(chunks));
			assert.equal(input.commands.length, 1);
			assert.ok(chunks.length > input.commands[0].length);
		},
		{
			limits: {
				burstBytes: 1024,
				fragmentDelayMs: 0,
				slowChunkDelayMs: 1,
				repeatedToolCalls: 2,
			},
		},
	);
});

test("burst output sends the configured pressure volume and completes", async () => {
	await withServer(
		async (server) => {
			const response = await completion(server, "harness/burst-output");
			const chunks = parseSse(await response.text());
			const text = chunks
				.map((chunk) => chunk.choices[0].delta.content ?? "")
				.join("");
			assert.equal(Buffer.byteLength(text), 8 * 1024);
			assert.equal(chunks.at(-1).choices[0].finish_reason, "stop");
		},
		{
			limits: {
				burstBytes: 8 * 1024,
				fragmentDelayMs: 0,
				slowChunkDelayMs: 1,
				repeatedToolCalls: 2,
			},
		},
	);
});

test("a stalled response is released when the client aborts", async () => {
	await withServer(async (server) => {
		const controller = new AbortController();
		const response = await completion(
			server,
			"harness/stall-after-tool-start",
			controller.signal,
		);
		const reader = response.body.getReader();
		const firstRead = await reader.read();
		assert.equal(firstRead.done, false);
		controller.abort();
		await assert.rejects(reader.read());
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.ok(server.traces.some((entry) => entry.event === "stream_stalled"));
	});
});

test("server shutdown releases a client that leaves a stalled response open", async () => {
	const server = await createHarnessServer({ port: 0 });
	const response = await completion(server, "harness/stall-after-tool-start");
	const reader = response.body.getReader();
	await reader.read();

	await assert.doesNotReject(withTimeout(server.close(), 1_000));
});

test("server shutdown releases a burst response blocked by client backpressure", async () => {
	const server = await createHarnessServer({
		port: 0,
		limits: {
			burstBytes: 8 * 1024 * 1024,
			fragmentDelayMs: 0,
			slowChunkDelayMs: 1,
			repeatedToolCalls: 2,
		},
	});
	const controller = new AbortController();
	await completion(server, "harness/burst-output", controller.signal);
	controller.abort();

	await assert.doesNotReject(withTimeout(server.close(), 1_000));
});

test("a bind failure cleans up startup resources", async () => {
	const occupied = createHttpServer();
	occupied.listen(0, "127.0.0.1");
	await once(occupied, "listening");
	const address = occupied.address();
	assert.ok(address && typeof address !== "string");

	try {
		await assert.rejects(
			createHarnessServer({ host: "127.0.0.1", port: address.port }),
			(error) => error?.code === "EADDRINUSE",
		);
	} finally {
		occupied.close();
		await once(occupied, "close");
	}
});

test("remote binding requires an explicit override", async () => {
	await assert.rejects(
		createHarnessServer({ host: "0.0.0.0", port: 0 }),
		/Refusing to bind/,
	);
});

async function withTimeout(promise, milliseconds) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Operation exceeded ${milliseconds}ms`)),
					milliseconds,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
