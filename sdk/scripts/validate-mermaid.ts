#!/usr/bin/env bun
/**
 * Structural Mermaid parse gate (same rules as @cline/drive validateMermaidSource).
 *
 * Usage:
 *   bun sdk/scripts/validate-mermaid.ts path/to/doc.md
 *   bun sdk/scripts/validate-mermaid.ts --source "flowchart LR\n A-->B"
 *   bun sdk/scripts/validate-mermaid.ts --stdin   # read source from stdin
 *
 * Exit 0 = all blocks parse-validated; 1 = failures; 2 = usage error.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateMermaidSource } from "../packages/drive/src/director/validateMermaidSource.ts";

function extractFences(markdown: string): string[] {
	return [...markdown.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)].map(
		(match) => match[1] ?? "",
	);
}

function usage(): never {
	console.error(
		"Usage: bun sdk/scripts/validate-mermaid.ts <file.md> | --source <text> | --stdin",
	);
	process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0) {
	usage();
}

let sources: string[] = [];
if (args[0] === "--stdin") {
	sources = [await Bun.stdin.text()];
} else if (args[0] === "--source") {
	const text = args.slice(1).join(" ");
	if (!text.trim()) {
		usage();
	}
	sources = [text];
} else {
	const filePath = resolve(args[0]!);
	const body = readFileSync(filePath, "utf8");
	sources = extractFences(body);
	if (sources.length === 0) {
		console.error(`No \`\`\`mermaid fences in ${filePath}`);
		process.exit(1);
	}
}

let fail = 0;
for (let i = 0; i < sources.length; i++) {
	const result = validateMermaidSource(sources[i]!);
	if (result.ok) {
		console.log(`PASS block ${i}`);
	} else {
		fail++;
		console.log(`FAIL block ${i}: ${result.reason}`);
	}
}
console.log(`${sources.length - fail}/${sources.length} parse-validated`);
process.exit(fail ? 1 : 0);
