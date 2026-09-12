import { describe, expect, it } from "vitest";
import {
	buildSlashCommandCatalog,
	createSlashCommandTokenRegex,
	detectSlashQuery,
	findSlashCommand,
	matchSlashCommands,
	SLASH_COMMAND_TOKEN_PATTERN,
	slashCommandKey,
	validateSlashCommandInput,
} from "./slash-commands";

describe("createSlashCommandTokenRegex", () => {
	it("matches a command at the start of the text", () => {
		const match = "/deploy now".match(createSlashCommandTokenRegex());
		expect(match?.[1]).toBe("");
		expect(match?.[2]).toBe("/deploy");
	});

	it("matches a command after whitespace, capturing the whitespace", () => {
		const match = "please /deploy now".match(createSlashCommandTokenRegex());
		expect(match?.[1]).toBe(" ");
		expect(match?.[2]).toBe("/deploy");
	});

	it("does not match a slash inside a URL or path", () => {
		expect(
			"http://example.com/deploy".match(createSlashCommandTokenRegex()),
		).toBeNull();
		expect("src/utils/deploy".match(createSlashCommandTokenRegex())).toBeNull();
	});

	it("accepts MCP prompt tokens with colons and Unicode skill names", () => {
		expect(
			"/mcp:server:prompt".match(createSlashCommandTokenRegex())?.[2],
		).toBe("/mcp:server:prompt");
		expect("/发布 docs".match(createSlashCommandTokenRegex())?.[2]).toBe(
			"/发布",
		);
	});

	it("always builds a Unicode-aware regex and never shares lastIndex state", () => {
		expect(createSlashCommandTokenRegex().flags).toContain("u");
		expect(createSlashCommandTokenRegex("gu").flags).toBe("gu");
		const first = createSlashCommandTokenRegex("g");
		const second = createSlashCommandTokenRegex("g");
		expect(first).not.toBe(second);
		expect(first.source).toBe(SLASH_COMMAND_TOKEN_PATTERN);
	});
});

describe("detectSlashQuery", () => {
	it("returns the typed prefix for a command being typed at the start", () => {
		expect(detectSlashQuery("/dep", 4)).toEqual({
			slashIndex: 0,
			query: "dep",
		});
	});

	it("returns an empty query right after the slash", () => {
		expect(detectSlashQuery("/")).toEqual({ slashIndex: 0, query: "" });
	});

	it("detects a command being typed mid-message after whitespace", () => {
		expect(detectSlashQuery("run this /rev", 13)).toEqual({
			slashIndex: 9,
			query: "rev",
		});
	});

	it("ignores slashes inside paths and URLs", () => {
		expect(detectSlashQuery("see src/utils")).toBeNull();
		expect(detectSlashQuery("open http://example.com/x")).toBeNull();
	});

	it("closes once the command is followed by whitespace", () => {
		expect(detectSlashQuery("/deploy now", 11)).toBeNull();
	});

	it("only offers suggestions for the first command in a message", () => {
		expect(detectSlashQuery("/deploy then /rev", 17)).toBeNull();
	});

	it("uses the cursor position, not the end of the text", () => {
		expect(detectSlashQuery("/dep later text", 4)).toEqual({
			slashIndex: 0,
			query: "dep",
		});
	});
});

describe("slashCommandKey", () => {
	it("trims, strips leading slashes and lower-cases", () => {
		expect(slashCommandKey("  //Deploy ")).toBe("deploy");
	});
});

describe("buildSlashCommandCatalog", () => {
	const builtins = [{ name: "compact", description: "Compact  context" }];
	const runtime = [
		{ name: "deploy", description: "Deploy\n  the app" },
		{ name: "Compact", description: "user command shadowing a builtin" },
		{ name: "", description: "nameless" },
	];

	it("keeps the earlier list's entry on collisions and drops empty names", () => {
		const catalog = buildSlashCommandCatalog([builtins, runtime]);
		expect(catalog.map((entry) => entry.name)).toEqual(["compact", "deploy"]);
		expect(catalog[0].description).toBe("Compact context");
	});

	it("collapses description whitespace without renaming the token", () => {
		const catalog = buildSlashCommandCatalog([runtime]);
		expect(catalog.find((entry) => entry.name === "deploy")?.description).toBe(
			"Deploy the app",
		);
		expect(catalog.map((entry) => entry.name)).toEqual(["deploy", "Compact"]);
	});

	it("preserves extra fields on entries", () => {
		const catalog = buildSlashCommandCatalog([
			[{ name: "x", kind: "skill" as const, section: "skill" }],
		]);
		expect(catalog[0]).toEqual({ name: "x", kind: "skill", section: "skill" });
	});
});

describe("matchSlashCommands / findSlashCommand / validateSlashCommandInput", () => {
	const catalog = [
		{ name: "compact" },
		{ name: "deploy" },
		{ name: "deep-planning" },
		{ name: "mcp:server:prompt" },
	];

	it("returns the whole catalog for an empty query", () => {
		expect(matchSlashCommands(catalog, "")).toEqual(catalog);
		expect(matchSlashCommands(catalog, "/")).toEqual(catalog);
	});

	it("filters by case-insensitive prefix", () => {
		expect(
			matchSlashCommands(catalog, "De").map((entry) => entry.name),
		).toEqual(["deploy", "deep-planning"]);
		expect(matchSlashCommands(catalog, "mcp:ser")).toHaveLength(1);
	});

	it("finds exact matches case-insensitively", () => {
		expect(findSlashCommand(catalog, "DEPLOY")?.name).toBe("deploy");
		expect(findSlashCommand(catalog, "dep")).toBeUndefined();
		expect(findSlashCommand(catalog, "")).toBeUndefined();
	});

	it("classifies typed input as full, partial or unknown", () => {
		expect(validateSlashCommandInput(catalog, "deploy")).toBe("full");
		expect(validateSlashCommandInput(catalog, "dep")).toBe("partial");
		expect(validateSlashCommandInput(catalog, "nope")).toBeNull();
		expect(validateSlashCommandInput(catalog, "")).toBeNull();
	});
});
