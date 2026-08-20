/**
 * Agent Plugins loading and discovery (Gateway RFC, Phase 4): manifest
 * validation, `$schema` selection without fetching, fixed component
 * locations, immediate-children-only skill discovery, root `mcp.json`,
 * unsupported extension namespaces, and the narrow path failure
 * boundaries — including symlink escapes resolved against the plugin
 * root.
 */

import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDataRoot } from "../test-support";
import { fingerprintPluginDir, loadPlugin } from "./loader";
import {
	AGENT_PLUGIN_SCHEMA_1_0_0,
	isValidPluginName,
	validatePluginManifest,
} from "./manifest";

function makePlugin(
	overrides: Record<string, unknown> = {},
	setup?: (root: string) => void,
): string {
	const root = join(tempDataRoot("cline-plugin-"), "pkg");
	mkdirSync(root, { recursive: true });
	writeFileSync(
		join(root, "plugin.json"),
		JSON.stringify({
			$schema: AGENT_PLUGIN_SCHEMA_1_0_0,
			name: "test.plugin",
			...overrides,
		}),
	);
	setup?.(root);
	return root;
}

function addSkill(root: string, id: string, frontmatter = true): void {
	const dir = join(root, "skills", id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "SKILL.md"),
		frontmatter
			? `---\nname: ${id}\ndescription: A ${id} skill\n---\n\n# ${id}\n`
			: `# ${id} without frontmatter\n`,
	);
}

describe("plugin manifest", () => {
	it("requires a supported $schema selected locally, never fetched", () => {
		expect(
			validatePluginManifest({ name: "x.y" }).ok,
			"missing $schema rejects the plugin",
		).toBe(false);
		expect(
			validatePluginManifest({
				$schema: "https://agent-plugins.org/schemas/999.0.0/plugin.schema.json",
				name: "x.y",
			}).ok,
			"unsupported $schema rejects the plugin",
		).toBe(false);
		expect(
			validatePluginManifest({
				$schema: AGENT_PLUGIN_SCHEMA_1_0_0,
				name: "x.y",
			}).ok,
		).toBe(true);
	});

	it("enforces the name constraints", () => {
		for (const valid of ["my-plugin", "acme.tools", "lint3r", "a"]) {
			expect(isValidPluginName(valid), valid).toBe(true);
		}
		for (const invalid of [
			"My-Plugin",
			"-start",
			"has--double",
			"too.many..dots",
			"end-",
			"",
			"x".repeat(65),
		]) {
			expect(isValidPluginName(invalid), invalid).toBe(false);
		}
	});

	it("reports and ignores unknown top-level fields (non-fatal)", () => {
		const result = validatePluginManifest({
			$schema: AGENT_PLUGIN_SCHEMA_1_0_0,
			name: "x.y",
			unknownField: 42,
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(
				result.diagnostics.some(
					(diag) => diag.code === "manifest.unknown_field",
				),
			).toBe(true);
			expect("unknownField" in result.manifest).toBe(false);
		}
	});

	it("reports and ignores a non-object extensions field (non-fatal)", () => {
		const result = validatePluginManifest({
			$schema: AGENT_PLUGIN_SCHEMA_1_0_0,
			name: "x.y",
			extensions: "not-an-object",
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.manifest.extensions).toBeUndefined();
			expect(
				result.diagnostics.some(
					(diag) => diag.code === "manifest.extensions_not_object",
				),
			).toBe(true);
		}
	});

	it("rejects other schema violations (wrong known-field types)", () => {
		expect(
			validatePluginManifest({
				$schema: AGENT_PLUGIN_SCHEMA_1_0_0,
				name: "x.y",
				keywords: "not-an-array",
			}).ok,
		).toBe(false);
		expect(
			validatePluginManifest({
				$schema: AGENT_PLUGIN_SCHEMA_1_0_0,
				name: "x.y",
				author: "not-an-object",
			}).ok,
		).toBe(false);
	});

	it("ignores unimplemented extension namespaces without validating them", () => {
		const result = validatePluginManifest({
			$schema: AGENT_PLUGIN_SCHEMA_1_0_0,
			name: "x.y",
			extensions: {
				"com.example.other-client": { anything: ["goes", { here: true }] },
			},
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(
				result.diagnostics.some(
					(diag) => diag.code === "manifest.extension_namespace_ignored",
				),
			).toBe(true);
		}
	});
});

describe("plugin loading and discovery", () => {
	it("loads the manifest first and rejects a plugin without one", () => {
		const root = join(tempDataRoot("cline-plugin-"), "pkg");
		mkdirSync(root, { recursive: true });
		const result = loadPlugin(root);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.diagnostics[0]?.code).toBe(
				"plugin.manifest_missing_or_escaping",
			);
		}
	});

	it("discovers skills only as immediate skills/*/SKILL.md children", () => {
		const root = makePlugin({}, (dir) => {
			addSkill(dir, "alpha");
			addSkill(dir, "beta");
			// Nested descendant: must NOT be discovered.
			const nested = join(dir, "skills", "alpha", "nested-skill");
			mkdirSync(nested, { recursive: true });
			writeFileSync(
				join(nested, "SKILL.md"),
				"---\nname: nested\ndescription: nope\n---\n",
			);
			// A stray file directly in skills/ is not a skill.
			writeFileSync(join(dir, "skills", "README.md"), "not a skill");
		});
		const result = loadPlugin(root);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plugin.skills.map((skill) => skill.id)).toEqual([
				"alpha",
				"beta",
			]);
		}
	});

	it("skips one non-conforming skill and keeps its siblings", () => {
		const root = makePlugin({}, (dir) => {
			addSkill(dir, "good");
			addSkill(dir, "broken", false);
		});
		const result = loadPlugin(root);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plugin.skills.map((skill) => skill.id)).toEqual(["good"]);
			expect(
				result.plugin.diagnostics.some(
					(diag) => diag.boundary === "skill:broken",
				),
			).toBe(true);
		}
	});

	it("a missing fixed location is not an error", () => {
		const root = makePlugin();
		const result = loadPlugin(root);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plugin.skills).toEqual([]);
			expect(result.plugin.mcpServers).toEqual([]);
			expect(
				result.plugin.diagnostics.filter((diag) => diag.severity === "error"),
			).toEqual([]);
		}
	});

	it("disables only the component type when its fixed location has the wrong kind", () => {
		const root = makePlugin({}, (dir) => {
			// skills is a FILE (wrong kind); mcp.json is a DIRECTORY.
			writeFileSync(join(dir, "skills"), "wrong kind");
			mkdirSync(join(dir, "mcp.json"));
		});
		const result = loadPlugin(root);
		expect(result.ok, "the plugin itself still loads").toBe(true);
		if (result.ok) {
			expect(result.plugin.skills).toEqual([]);
			expect(result.plugin.mcpServers).toEqual([]);
			const boundaries = result.plugin.diagnostics.map((diag) => diag.boundary);
			expect(boundaries).toContain("skills");
			expect(boundaries).toContain("mcp");
		}
	});

	it("reads MCP servers from the root mcp.json and skips invalid entries", () => {
		const root = makePlugin({}, (dir) => {
			writeFileSync(
				join(dir, "mcp.json"),
				JSON.stringify({
					mcpServers: {
						good: { command: "bunx", args: ["some-server"] },
						web: { url: "https://example.com/mcp" },
						broken: { neither: true },
					},
				}),
			);
		});
		const result = loadPlugin(root);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(
				result.plugin.mcpServers.map((server) => server.name).sort(),
			).toEqual(["good", "web"]);
			expect(
				result.plugin.diagnostics.some(
					(diag) => diag.boundary === "mcp-server:broken",
				),
			).toBe(true);
		}
	});

	it("skips one MCP entry whose configured package path escapes the root", () => {
		const root = makePlugin({}, (dir) => {
			writeFileSync(
				join(dir, "mcp.json"),
				JSON.stringify({
					mcpServers: {
						escaping: { command: "./../../outside/server.js" },
						fine: { command: "./server.js" },
					},
				}),
			);
		});
		const result = loadPlugin(root);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plugin.mcpServers.map((server) => server.name)).toEqual([
				"fine",
			]);
			expect(
				result.plugin.diagnostics.some(
					(diag) => diag.code === "mcp.entry_escapes_root",
				),
			).toBe(true);
		}
	});

	it("skips a skill whose SKILL.md symlinks outside the plugin root", () => {
		const outside = tempDataRoot("cline-plugin-outside-");
		writeFileSync(
			join(outside, "SKILL.md"),
			"---\nname: evil\ndescription: escapes\n---\n",
		);
		const root = makePlugin({}, (dir) => {
			addSkill(dir, "good");
			const evil = join(dir, "skills", "evil");
			mkdirSync(evil, { recursive: true });
			symlinkSync(join(outside, "SKILL.md"), join(evil, "SKILL.md"));
		});
		const result = loadPlugin(root);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plugin.skills.map((skill) => skill.id)).toEqual(["good"]);
			expect(
				result.plugin.diagnostics.some(
					(diag) => diag.code === "skills.skill_escapes_root",
				),
			).toBe(true);
		}
	});

	it("disables the skills component when skills/ symlinks outside the root", () => {
		const outside = tempDataRoot("cline-plugin-outside-");
		const outsideSkills = join(outside, "skills");
		mkdirSync(join(outsideSkills, "leaked"), { recursive: true });
		writeFileSync(
			join(outsideSkills, "leaked", "SKILL.md"),
			"---\nname: leaked\ndescription: escapes\n---\n",
		);
		const root = makePlugin({}, (dir) => {
			symlinkSync(outsideSkills, join(dir, "skills"));
		});
		const result = loadPlugin(root);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.plugin.skills).toEqual([]);
			expect(
				result.plugin.diagnostics.some(
					(diag) =>
						diag.code === "skills.location_invalid" &&
						diag.boundary === "skills",
				),
			).toBe(true);
		}
	});

	it("fingerprints change with content and are stable without changes", async () => {
		const root = makePlugin({}, (dir) => addSkill(dir, "alpha"));
		const first = fingerprintPluginDir(root);
		expect(fingerprintPluginDir(root)).toBe(first);
		await new Promise((resolve) => setTimeout(resolve, 10));
		writeFileSync(
			join(root, "skills", "alpha", "SKILL.md"),
			"---\nname: alpha\ndescription: changed\n---\n",
		);
		expect(fingerprintPluginDir(root)).not.toBe(first);
	});
});
