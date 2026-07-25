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

const responses = raw.split(/^===== /m).filter((chunk) => chunk.trim());

for (const [i, chunk] of responses.entries()) {
	const header = chunk.split("\n", 1)[0];
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
