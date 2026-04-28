/**
 * TypeScript LSP Plugin
 *
 * Gives the agent a `goto_definition` tool powered by the TypeScript Language
 * Service API. It resolves through imports, re-exports, type aliases, etc. so
 * it's much more precise than grep or text search.
 *
 * The plugin resolves `typescript` from the target project's own node_modules
 * at runtime, so it has zero dependencies beyond Node builtins.
 *
 * CLI usage:
 *   cp apps/examples/typescript-lsp-plugin/index.ts ~/.cline/plugins/typescript-lsp.ts
 *   clite -i "Find where createTool is defined"
 *
 * Direct demo usage:
 *   ANTHROPIC_API_KEY=sk-... bun run apps/examples/typescript-lsp-plugin/index.ts
 */

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { type AgentExtension, ClineCore, createTool } from "@clinebot/core";

// ---------------------------------------------------------------------------
// TypeScript Language Service setup
// ---------------------------------------------------------------------------

type LanguageServiceCache = {
	tsconfigPath: string;
	service: ReturnType<typeof createLanguageService>;
	ts: typeof import("typescript");
};

let cache: LanguageServiceCache | undefined;

function findTsConfig(startDir: string): string | undefined {
	let dir = startDir;
	while (true) {
		const candidate = join(dir, "tsconfig.json");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

// Resolve typescript from the target project's node_modules so we use the
// same version the project is compiled with.
function loadTypeScript(projectDir: string) {
	const req = createRequire(resolve(projectDir, "package.json"));
	const tsPath = req.resolve("typescript");
	return req(tsPath) as typeof import("typescript");
}

function createLanguageService(
	ts: typeof import("typescript"),
	tsconfigPath: string,
) {
	const projectDir = dirname(tsconfigPath);
	const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

	if (configFile.error) {
		throw new Error(
			"Failed to read tsconfig.json: " +
				ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"),
		);
	}

	const parsed = ts.parseJsonConfigFileContent(
		configFile.config,
		ts.sys,
		projectDir,
	);

	const host: import("typescript").LanguageServiceHost = {
		getScriptFileNames: () => parsed.fileNames,
		getScriptVersion: () => "1",
		getScriptSnapshot: (fileName) => {
			const content = ts.sys.readFile(fileName);
			if (content === undefined) return undefined;
			return ts.ScriptSnapshot.fromString(content);
		},
		getCurrentDirectory: () => projectDir,
		getCompilationSettings: () => parsed.options,
		getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,
		getDirectories: ts.sys.getDirectories,
	};

	return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function getOrCreateService(tsconfigPath: string) {
	if (cache && cache.tsconfigPath === tsconfigPath) {
		return cache;
	}

	const projectDir = dirname(tsconfigPath);
	const ts = loadTypeScript(projectDir);
	const service = createLanguageService(ts, tsconfigPath);
	cache = { tsconfigPath, service, ts };
	return cache;
}

function offsetToLineCol(
	sourceFile: import("typescript").SourceFile,
	ts: typeof import("typescript"),
	offset: number,
) {
	const lc = ts.getLineAndCharacterOfPosition(sourceFile, offset);
	return { line: lc.line + 1, column: lc.character + 1 };
}

function getIdentifiersOnLine(
	ts: typeof import("typescript"),
	sourceFile: import("typescript").SourceFile,
	targetLine: number,
) {
	const identifiers: Array<{ offset: number; name: string }> = [];
	function visit(node: import("typescript").Node) {
		if (ts.isIdentifier(node)) {
			const lc = ts.getLineAndCharacterOfPosition(
				sourceFile,
				node.getStart(sourceFile),
			);
			if (lc.line + 1 === targetLine) {
				identifiers.push({
					offset: node.getStart(sourceFile),
					name: node.text,
				});
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(sourceFile);
	return identifiers;
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

type GotoDefinitionInput = { file: string; line: number };

type DefinitionLocation = {
	file: string;
	line: number;
	column: number;
	kind: string;
	name: string;
	containerName?: string;
};

const plugin: AgentExtension = {
	name: "typescript-lsp",
	manifest: {
		capabilities: ["tools"],
	},

	setup(api) {
		api.registerTool(
			createTool({
				name: "goto_definition",
				description:
					"Find where TypeScript/JavaScript symbols on a given line are defined. " +
					"Given a file path and line number, finds all identifiers on that line " +
					"and resolves their definitions. Much more precise than text search " +
					"-- resolves through imports, re-exports, type aliases, etc.",
				inputSchema: {
					type: "object",
					properties: {
						file: {
							type: "string",
							description: "Absolute path to the file.",
						},
						line: {
							type: "integer",
							description: "Line number (1-based).",
						},
					},
					required: ["file", "line"],
					additionalProperties: false,
				},
				timeoutMs: 30000,
				retryable: false,
				async execute(input: unknown) {
					const { file, line } = input as GotoDefinitionInput;
					const fileName = resolve(file);

					if (!existsSync(fileName)) {
						throw new Error(`File does not exist: ${fileName}`);
					}

					const tsconfigPath = findTsConfig(dirname(fileName));
					if (!tsconfigPath) {
						throw new Error(
							`No tsconfig.json found in any parent directory of ${fileName}`,
						);
					}

					const { ts, service } = getOrCreateService(tsconfigPath);
					const program = service.getProgram();
					if (!program) throw new Error("Failed to create TypeScript program");

					const sourceFile = program.getSourceFile(fileName);
					if (!sourceFile) {
						throw new Error(
							"File not found in TypeScript program. Make sure it is included by tsconfig.json: " +
								fileName,
						);
					}

					const identifiers = getIdentifiersOnLine(ts, sourceFile, line);

					if (identifiers.length === 0) {
						return {
							found: false,
							file,
							line,
							message: "No identifiers found on this line.",
						};
					}

					const results: Array<{
						symbol: string;
						definitions: DefinitionLocation[];
					}> = [];

					const seen = new Set<string>();

					for (const { offset, name: symbolName } of identifiers) {
						if (seen.has(symbolName)) continue;
						seen.add(symbolName);

						const definitions = service.getDefinitionAtPosition(
							fileName,
							offset,
						);
						if (!definitions || definitions.length === 0) continue;

						const nonSelfDefs = definitions.filter((def) => {
							if (def.fileName !== fileName) return true;
							const defLine = offsetToLineCol(
								sourceFile,
								ts,
								def.textSpan.start,
							);
							return defLine.line !== line;
						});

						if (nonSelfDefs.length === 0) continue;

						results.push({
							symbol: symbolName,
							definitions: nonSelfDefs.map((def) => {
								const defSourceFile = program.getSourceFile(def.fileName);
								const loc = defSourceFile
									? offsetToLineCol(defSourceFile, ts, def.textSpan.start)
									: { line: 0, column: 0 };

								return {
									file: def.fileName,
									line: loc.line,
									column: loc.column,
									kind: def.kind,
									name: def.name,
									containerName: def.containerName || undefined,
								};
							}),
						});
					}

					if (results.length === 0) {
						return {
							found: false,
							file,
							line,
							message:
								"Identifiers found on this line but none resolved to external definitions.",
						};
					}

					return {
						found: true,
						query: { file, line },
						tsconfig: tsconfigPath,
						results,
					};
				},
			}),
		);
	},
};

// ---------------------------------------------------------------------------
// Standalone demo
// ---------------------------------------------------------------------------

async function runDemo(): Promise<void> {
	const sessionManager = await ClineCore.create({});

	try {
		const result = await sessionManager.start({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: process.env.ANTHROPIC_API_KEY ?? "",
				cwd: process.cwd(),
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				systemPrompt:
					"You are a helpful assistant. Use the goto_definition tool to navigate TypeScript code.",
				extensions: [plugin],
				extensionContext: {
					workspace: {
						rootPath: process.cwd(),
						cwd: process.cwd(),
					},
				},
			},
			prompt:
				"Use goto_definition to find where createTool is defined. " +
				"Start from packages/shared/src/tools/create.ts line 42.",
			interactive: false,
		});

		console.log(`\n${result.result?.text ?? ""}`);
	} finally {
		await sessionManager.dispose();
	}
}

if (import.meta.main) {
	await runDemo();
}

export { plugin, runDemo };
export default plugin;
