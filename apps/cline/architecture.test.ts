import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

type PackageManifest = {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
};

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(appRoot, "../..");
const bundledProfileRoot = resolve(
	repoRoot,
	"sdk/packages/gateway/default-agent",
);
const forbiddenPackages = new Set([
	"@cline/core",
	"@cline/sdk",
	"@cline/cline-hub",
	"@cline/code",
]);
const ignoredDirectories = new Set([
	".git",
	".next",
	".worktrees",
	"dist",
	"node_modules",
	"out",
	"target",
]);

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

function walkFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...walkFiles(path));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

function packageDependencies(
	manifest: PackageManifest,
	includeDevelopment: boolean,
): string[] {
	return [
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.optionalDependencies ?? {}),
		...Object.keys(manifest.peerDependencies ?? {}),
		...(includeDevelopment ? Object.keys(manifest.devDependencies ?? {}) : []),
	];
}

function workspacePackages(): Map<string, PackageManifest> {
	const packages = new Map<string, PackageManifest>();
	for (const path of walkFiles(repoRoot)) {
		if (
			path.endsWith("/package.json") ||
			path === join(repoRoot, "package.json")
		) {
			const manifest = readJson<PackageManifest>(path);
			if (manifest.name) packages.set(manifest.name, manifest);
		}
	}
	return packages;
}

function clineImports(source: string): string[] {
	return [...source.matchAll(/["'](@cline\/[^"']+)["']/g)].map(
		(match) => match[1],
	);
}

type CommandUse = {
	readonly command: string;
	readonly source: string;
};

const dynamicDesktopInvocations = new Map<string, readonly string[]>([
	[
		"webview/components/views/settings/routine-view.tsx:command",
		["create_routine_schedule", "update_routine_schedule"],
	],
]);

function productionWebviewCommandUses(): {
	readonly commands: readonly CommandUse[];
	readonly unaccountedDynamicCalls: readonly string[];
} {
	const commands: CommandUse[] = [];
	const unaccountedDynamicCalls: string[] = [];
	for (const path of walkFiles(join(appRoot, "webview"))) {
		if (!path.endsWith(".ts") && !path.endsWith(".tsx")) continue;
		if (/\.(?:test|spec)\.[^.]+$/.test(path)) continue;
		const sourceText = readFileSync(path, "utf8");
		const sourceFile = ts.createSourceFile(
			path,
			sourceText,
			ts.ScriptTarget.Latest,
			true,
			path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
		);
		const source = relative(appRoot, path).split("\\").join("/");
		const visit = (node: ts.Node): void => {
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				ts.isIdentifier(node.expression.expression) &&
				node.expression.expression.text === "desktopClient" &&
				node.expression.name.text === "invoke"
			) {
				const argument = node.arguments[0];
				const position = sourceFile.getLineAndCharacterOfPosition(
					node.getStart(sourceFile),
				);
				const location = `${source}:${position.line + 1}`;
				if (argument && ts.isStringLiteralLike(argument)) {
					commands.push({ command: argument.text, source: location });
				} else {
					const expression = argument?.getText(sourceFile) ?? "<missing>";
					const key = `${source}:${expression}`;
					const knownCommands = dynamicDesktopInvocations.get(key);
					if (knownCommands) {
						commands.push(
							...knownCommands.map((command) => ({
								command,
								source: location,
							})),
						);
					} else {
						unaccountedDynamicCalls.push(
							`${location} desktopClient.invoke(${expression})`,
						);
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}
	return { commands, unaccountedDynamicCalls };
}

function sidecarRoutedCommands(): ReadonlySet<string> {
	const commands = new Set<string>();
	for (const relativePath of [
		"sidecar/commands.ts",
		"sidecar/host-commands.ts",
	]) {
		const path = join(appRoot, relativePath);
		const sourceFile = ts.createSourceFile(
			path,
			readFileSync(path, "utf8"),
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);
		const commandLiteral = (
			left: ts.Expression,
			right: ts.Expression,
		): string | undefined =>
			ts.isIdentifier(left) &&
			left.text === "command" &&
			ts.isStringLiteralLike(right)
				? right.text
				: undefined;
		const visit = (node: ts.Node): void => {
			if (
				ts.isBinaryExpression(node) &&
				(node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
					node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken)
			) {
				const command =
					commandLiteral(node.left, node.right) ??
					commandLiteral(node.right, node.left);
				if (command) commands.add(command);
			}
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === "includes" &&
				node.arguments.some(
					(argument) =>
						ts.isIdentifier(argument) && argument.text === "command",
				) &&
				ts.isArrayLiteralExpression(node.expression.expression)
			) {
				for (const element of node.expression.expression.elements) {
					if (ts.isStringLiteralLike(element)) commands.add(element.text);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}
	return commands;
}

function registeredNativeCommands(): ReadonlySet<string> {
	const source = readFileSync(join(appRoot, "src-tauri/src/main.rs"), "utf8");
	const handler = source.match(
		/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/,
	)?.[1];
	if (!handler) return new Set();
	return new Set(
		handler
			.split(",")
			.map((entry) => entry.replace(/\/\/.*$/gm, "").trim())
			.filter((entry) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry)),
	);
}

describe("Cline desktop architecture boundary", () => {
	it("has no direct or transitive Core, SDK, Hub, or legacy desktop dependency", () => {
		const appManifest = readJson<PackageManifest>(
			join(appRoot, "package.json"),
		);
		const direct = packageDependencies(appManifest, true);
		expect(direct.filter((name) => forbiddenPackages.has(name))).toEqual([]);

		const packages = workspacePackages();
		const queue = packageDependencies(appManifest, false).map((name) => ({
			name,
			path: [appManifest.name ?? "@cline/cline-app", name],
		}));
		const visited = new Set<string>();
		const forbiddenPaths: string[] = [];
		while (queue.length > 0) {
			const current = queue.shift();
			if (!current) break;
			if (forbiddenPackages.has(current.name)) {
				forbiddenPaths.push(current.path.join(" -> "));
				continue;
			}
			if (visited.has(current.name)) continue;
			visited.add(current.name);
			const manifest = packages.get(current.name);
			if (!manifest) continue;
			for (const dependency of packageDependencies(manifest, false)) {
				queue.push({
					name: dependency,
					path: [...current.path, dependency],
				});
			}
		}
		expect(forbiddenPaths).toEqual([]);
	});

	it("limits the sidecar to the typed Gateway client and narrow shared surfaces", () => {
		const allowed = new Set([
			"@cline/gateway/client",
			"@cline/llms",
			"@cline/shared/agent",
			"@cline/shared/connectors",
			"@cline/shared/gateway",
		]);
		const violations: string[] = [];
		for (const path of walkFiles(join(appRoot, "sidecar"))) {
			if (!path.endsWith(".ts") || path.endsWith(".test.ts")) continue;
			for (const imported of clineImports(readFileSync(path, "utf8"))) {
				if (!allowed.has(imported)) {
					violations.push(`${relative(appRoot, path)} -> ${imported}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("contains no production import or launch path back to legacy hosts", () => {
		const violations: string[] = [];
		for (const path of walkFiles(appRoot)) {
			const extension = extname(path);
			if (![".ts", ".tsx", ".mts", ".rs", ".json"].includes(extension)) {
				continue;
			}
			if (/\.(?:test|spec)\.[^.]+$/.test(path)) continue;
			let source = readFileSync(path, "utf8");
			if (path.endsWith("/src-tauri/src/main.rs")) {
				source = source.split("#[cfg(test)]")[0] ?? source;
			}
			for (const pattern of [
				/@cline\/(?:core|sdk|cline-hub)(?:\/[^"'\s]*)?/g,
				/apps\/(?:cline-hub|examples\/desktop-app)/g,
			]) {
				for (const match of source.matchAll(pattern)) {
					violations.push(
						`${relative(appRoot, path)} contains ${JSON.stringify(match[0])}`,
					);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("bundles only the Gateway bridge, Gateway authority, and Gateway profile", () => {
		const tauri = readJson<{
			bundle: { externalBin: string[]; resources: Record<string, string> };
		}>(join(appRoot, "src-tauri/tauri.conf.json"));
		expect(tauri.bundle.externalBin).toEqual([
			"bin/cline-sidecar",
			"bin/clinegate",
		]);
		expect(tauri.bundle.resources).toEqual({
			"icons/dock/": "icons/dock/",
			"../../../sdk/packages/gateway/default-agent/": "profiles/",
		});

		const forbiddenProfileReferences: string[] = [];
		for (const path of walkFiles(bundledProfileRoot)) {
			if (![".ts", ".tsx", ".js", ".mjs", ".json"].includes(extname(path))) {
				continue;
			}
			const source = readFileSync(path, "utf8");
			for (const imported of clineImports(source)) {
				if (forbiddenPackages.has(imported.split("/").slice(0, 2).join("/"))) {
					forbiddenProfileReferences.push(
						`${relative(bundledProfileRoot, path)} -> ${imported}`,
					);
				}
			}
		}
		expect(forbiddenProfileReferences).toEqual([]);
	});

	it("keeps bridge processes separate from Gateway process ownership", () => {
		const gatewaySource = readFileSync(
			join(appRoot, "sidecar/gateway.ts"),
			"utf8",
		);
		const bridgeSource = readFileSync(
			join(appRoot, "sidecar/index.ts"),
			"utf8",
		);
		expect(`${gatewaySource}\n${bridgeSource}`).not.toContain("ownedProcess");
		expect(`${gatewaySource}\n${bridgeSource}`).not.toMatch(
			/["']gateway\.stop["']/,
		);
		expect(gatewaySource).not.toMatch(/["']serve["']/);
		expect(gatewaySource).toContain(
			'export const DESKTOP_GATEWAY_NAMESPACE = "desktop"',
		);
	});

	it("keeps system-prompt authority in Gateway instead of a native shadow store", () => {
		const nativeSource = readFileSync(
			join(appRoot, "src-tauri/src/main.rs"),
			"utf8",
		).split("#[cfg(test)]")[0];
		const clientSource = readFileSync(
			join(appRoot, "webview/lib/desktop-client.ts"),
			"utf8",
		);
		for (const legacyPromptPath of [
			"CLINE_HOST_SYSTEM_PROMPT",
			"resolve_bot_system_prompt_path",
			"read_bot_system_prompt,",
			"write_bot_system_prompt,",
		]) {
			expect(nativeSource).not.toContain(legacyPromptPath);
		}
		expect(clientSource).not.toMatch(
			/NATIVE_COMMANDS[\s\S]*?["'](?:read|write)_bot_system_prompt["']/,
		);
	});

	it("routes every production webview desktop command", () => {
		const { commands, unaccountedDynamicCalls } =
			productionWebviewCommandUses();
		if (unaccountedDynamicCalls.length > 0) {
			throw new Error(
				[
					"Dynamic desktopClient.invoke calls require an explicit command expansion in dynamicDesktopInvocations:",
					...unaccountedDynamicCalls.map((call) => `  - ${call}`),
				].join("\n"),
			);
		}

		const sidecarCommands = sidecarRoutedCommands();
		const nativeCommands = registeredNativeCommands();
		const missingByCommand = new Map<string, Set<string>>();
		for (const use of commands) {
			if (sidecarCommands.has(use.command) || nativeCommands.has(use.command)) {
				continue;
			}
			const sources = missingByCommand.get(use.command) ?? new Set<string>();
			sources.add(use.source);
			missingByCommand.set(use.command, sources);
		}
		if (missingByCommand.size > 0) {
			const diagnostics = [...missingByCommand]
				.sort(([left], [right]) => left.localeCompare(right))
				.map(
					([command, sources]) =>
						`  - ${command} <- ${[...sources].sort().join(", ")}`,
				);
			throw new Error(
				[
					"Production webview commands are missing from both the sidecar router and Tauri generate_handler!:",
					...diagnostics,
				].join("\n"),
			);
		}

		expect(commands.length).toBeGreaterThan(0);
	});
});
