import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function listSourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(join(packageRoot, dir), {
		withFileTypes: true,
		recursive: true,
	})) {
		if (!entry.isFile()) continue;
		if (!/\.(ts|tsx)$/.test(entry.name)) continue;
		out.push(join(entry.parentPath, entry.name));
	}
	return out;
}

function importsOf(file: string): string[] {
	// Type-only imports are erased at build time and cannot leak runtime
	// dependencies, so they are excluded from the boundary checks.
	const src = readFileSync(file, "utf8")
		.replace(/import\s+type\s[\s\S]*?["'][^"']+["'];?/g, "")
		.replace(/export\s+type\s[\s\S]*?["'][^"']+["'];?/g, "");
	const specs: string[] = [];
	const re = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
	for (const match of src.matchAll(re)) {
		const spec = match[1];
		if (spec) specs.push(spec);
	}
	return specs;
}

/**
 * Renderer/runtime dependency boundaries:
 * - the browser entry (components/) must never receive terminal
 *   dependencies (OpenTUI, node builtins, tui/ or protocol/ modules)
 * - the terminal entry (tui/) must not import the browser components
 * - the protocol entry stays renderer-free entirely
 * - the renderer-free formatting subpath must not pull in OpenTUI
 */
describe("entry point isolation", () => {
	it("browser components never import terminal or Node modules", () => {
		for (const file of listSourceFiles("components")) {
			for (const spec of importsOf(file)) {
				expect(spec, `${file} imports ${spec}`).not.toMatch(
					/^(@opentui|opentui-|node:)/,
				);
				expect(spec, `${file} imports ${spec}`).not.toMatch(
					/\.\.\/(tui|protocol)\//,
				);
			}
		}
	});

	it("terminal modules never import browser components", () => {
		const browserComponentsDir = join(packageRoot, "components");
		for (const file of listSourceFiles("tui")) {
			for (const spec of importsOf(file)) {
				if (!spec.startsWith(".")) continue;
				const resolved = join(file, "..", spec);
				expect(
					resolved.startsWith(browserComponentsDir),
					`${file} imports ${spec} (resolves into the browser components tree)`,
				).toBe(false);
			}
		}
	});

	it("protocol modules stay renderer-free", () => {
		for (const file of listSourceFiles("protocol")) {
			for (const spec of importsOf(file)) {
				expect(spec, `${file} imports ${spec}`).not.toMatch(
					/^(@opentui|opentui-|react|node:)/,
				);
				expect(spec, `${file} imports ${spec}`).not.toMatch(/\.\.\/tui\//);
			}
		}
	});

	it("the messages barrel never imports the optional ANSI peer", () => {
		// ToolMessageBlock (and only it) needs ansi-to-react; it ships from its
		// own subpath so that consumers of the barrel's pure helpers and other
		// components are never forced to install the optional peer.
		const seen = new Set<string>();
		const queue = [
			join(packageRoot, "components/agent-chat/messages/index.ts"),
		];
		while (queue.length > 0) {
			const file = queue.pop();
			if (!file || seen.has(file)) continue;
			seen.add(file);
			for (const spec of importsOf(file)) {
				expect(spec, `${file} imports ${spec}`).not.toBe("ansi-to-react");
				if (spec.startsWith(".")) {
					const base = join(file, "..", spec).replace(/\.js$/, "");
					for (const candidate of [
						`${base}.ts`,
						`${base}.tsx`,
						join(base, "index.ts"),
						join(base, "index.tsx"),
					]) {
						try {
							readFileSync(candidate);
							queue.push(candidate);
							break;
						} catch {
							// try next candidate
						}
					}
				}
			}
		}
		expect(seen.size).toBeGreaterThan(5);
	});

	it("the formatting subpath never imports the OpenTUI renderer", () => {
		const seen = new Set<string>();
		const queue = [join(packageRoot, "tui/formatting/index.ts")];
		while (queue.length > 0) {
			const file = queue.pop();
			if (!file || seen.has(file)) continue;
			seen.add(file);
			for (const spec of importsOf(file)) {
				expect(spec, `${file} imports ${spec}`).not.toMatch(
					/^(@opentui|opentui-|react$)/,
				);
				if (spec.startsWith(".")) {
					const base = join(file, "..", spec);
					for (const candidate of [
						`${base}.ts`,
						`${base}.tsx`,
						join(base, "index.ts"),
					]) {
						try {
							readFileSync(candidate);
							queue.push(candidate);
							break;
						} catch {
							// try next candidate
						}
					}
				}
			}
		}
		expect(seen.size).toBeGreaterThan(5);
	});
});
