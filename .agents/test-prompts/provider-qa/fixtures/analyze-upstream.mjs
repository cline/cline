#!/usr/bin/env node
/**
 * Summarizes a raw upstream SSE recording produced by the mock provider's
 * pass-through mode.
 *
 * The point is attribution: for each upstream response it reports how many
 * distinct tool calls the provider actually sent, keyed by both `index` and
 * `id`, plus whether any tool-call syntax leaked into the text channel. That
 * distinguishes "the provider sent the same tool call twice" from "Cline
 * executed one tool call twice".
 */

import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "/tmp/cline-qa/proxy/requests.jsonl.upstream";
const raw = readFileSync(path, "utf8");

// Native tool-call delimiters used by DeepSeek R1 style models.
const R1_TOKEN = /tool\s*.{0,3}\s*call\s*.{0,3}\s*begin|tool\s*.{0,3}\s*sep|\u2581/;

/**
 * Responses-API streams carry tool calls as `response.output_item.added`
 * (function_call) plus a run of `response.function_call_arguments.delta`
 * events, so they need their own accounting: how many function_call items the
 * provider actually opened, how many fragments each argument arrived in, and
 * whether the reassembled string parses.
 */
function summarizeResponsesStream(chunk) {
	const items = new Map();
	let sawResponsesEvent = false;
	let text = "";

	for (const line of chunk.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const payload = line.slice(6).trim();
		if (!payload || payload === "[DONE]") continue;
		let json;
		try {
			json = JSON.parse(payload);
		} catch {
			continue;
		}
		const type = json.type;
		if (typeof type !== "string" || !type.startsWith("response.")) continue;
		sawResponsesEvent = true;

		if (type === "response.output_item.added" && json.item?.type === "function_call") {
			items.set(json.output_index, {
				name: json.item.name,
				callId: json.item.call_id,
				args: json.item.arguments ?? "",
				fragments: 0,
			});
		} else if (type === "response.function_call_arguments.delta") {
			const slot = items.get(json.output_index);
			if (slot) {
				slot.args += json.delta ?? "";
				slot.fragments += 1;
			}
		} else if (type === "response.output_item.done" && json.item?.type === "function_call") {
			const slot = items.get(json.output_index);
			if (slot) slot.finalArgs = json.item.arguments ?? "";
		} else if (type === "response.output_text.delta") {
			text += json.delta ?? "";
		}
	}

	return sawResponsesEvent ? { items, text } : undefined;
}

const responses = raw.split(/^===== /m).filter((chunk) => chunk.trim());

for (const [i, chunk] of responses.entries()) {
	const header = chunk.split("\n", 1)[0];

	const responsesSummary = summarizeResponsesStream(chunk);
	if (responsesSummary) {
		const { items, text } = responsesSummary;
		console.log(`===== upstream response ${i + 1} (Responses API) =====`);
		console.log(`  ${header}`);
		console.log(`  function_call items:  ${items.size}`);
		const callIds = new Set([...items.values()].map((s) => s.callId));
		console.log(`  distinct call ids:    ${callIds.size}`);
		for (const [index, slot] of [...items.entries()].sort((a, b) => a[0] - b[0])) {
			console.log(`    output_index ${index}: name=${slot.name} call_id=${slot.callId}`);
			console.log(`      argument fragments: ${slot.fragments}`);
			console.log(`      reassembled bytes:  ${slot.args.length}`);
			let parses = false;
			try {
				JSON.parse(slot.args);
				parses = true;
			} catch {}
			console.log(`      parses as JSON:     ${parses}`);
			if (slot.finalArgs !== undefined) {
				console.log(`      matches output_item.done payload: ${slot.finalArgs === slot.args}`);
			}
			console.log(`      args head: ${JSON.stringify(slot.args.slice(0, 220))}`);
		}
		console.log(`  tool syntax leaked into text channel: ${R1_TOKEN.test(text)}`);
		console.log(`  text length: ${text.length}`);
		continue;
	}

	const byIndex = new Map();
	const ids = new Set();
	let content = "";
	let finish = null;
	let fragments = 0;

	for (const line of chunk.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const payload = line.slice(6).trim();
		if (!payload || payload === "[DONE]") continue;
		let json;
		try {
			json = JSON.parse(payload);
		} catch {
			continue;
		}
		const choice = json.choices?.[0];
		if (!choice) continue;
		if (choice.finish_reason) finish = choice.finish_reason;
		const delta = choice.delta ?? {};
		if (typeof delta.content === "string") content += delta.content;
		for (const call of delta.tool_calls ?? []) {
			const index = call.index ?? 0;
			if (!byIndex.has(index)) {
				byIndex.set(index, { name: undefined, ids: new Set(), args: "" });
			}
			const slot = byIndex.get(index);
			if (call.id) {
				slot.ids.add(call.id);
				ids.add(call.id);
			}
			if (call.function?.name) slot.name = call.function.name;
			if (typeof call.function?.arguments === "string") {
				slot.args += call.function.arguments;
				if (call.function.arguments) fragments += 1;
			}
		}
	}

	console.log(`===== upstream response ${i + 1} =====`);
	console.log(`  ${header}`);
	console.log(`  finish_reason:        ${finish ?? "(none)"}`);
	console.log(`  tool calls by index:  ${byIndex.size}`);
	console.log(`  distinct tool ids:    ${ids.size}`);
	console.log(`  argument fragments:   ${fragments}`);
	for (const [index, slot] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
		console.log(`    index ${index}: name=${slot.name ?? "(none)"} ids=[${[...slot.ids].join(", ")}]`);
		console.log(`      args: ${JSON.stringify(slot.args).slice(0, 400)}`);
	}
	const leaked = R1_TOKEN.test(content);
	console.log(`  tool syntax leaked into text channel: ${leaked}`);
	if (leaked) {
		const at = content.search(R1_TOKEN);
		console.log(`      near: ${JSON.stringify(content.slice(Math.max(0, at - 120), at + 320))}`);
	}
	console.log(`  text length: ${content.length}`);
}
