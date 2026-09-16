import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const importCheck = `
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	AgentAskQuestion,
	AgentApprovalCard,
	AttachmentDropZone,
	AgentAurora,
	AgentHeroHeading,
	AgentWelcomeHero,
	AgentPromptQueue,
	AgentQuickActions,
	SearchCombobox,
	SessionStatus,
	Switch,
} from "@cline/ui";
import { Conversation, Message } from "@cline/ui/components/agent-chat";
import { ToolFileDiff } from "@cline/ui/components/agent-chat/tool-diff";
import { buildToolSummary } from "@cline/ui/components/agent-chat/tool-summary";

for (const specifier of [
	"@cline/ui/components.css",
	"@cline/ui/components/markdown.css",
	"@cline/ui/theme/palette.css",
	"@cline/ui/theme/scoped-tokens.css",
]) {
	if (!existsSync(fileURLToPath(import.meta.resolve(specifier)))) {
		throw new Error("packed CSS export does not exist: " + specifier);
	}
}

const packageJsonUrl = import.meta.resolve("@cline/ui/package.json");
const heroCss = readFileSync(
	fileURLToPath(new URL("./components/agent-welcome-hero.css", packageJsonUrl)),
	"utf8",
);
const inlineHeroMaskCount =
	heroCss.split('url("data:image/svg+xml;base64,').length - 1;
if (inlineHeroMaskCount !== 4) {
	throw new Error("packed hero CSS does not contain four inline SVG masks");
}

const css = import.meta.resolve("@cline/ui/components/agent-chat.css");
const tokens = import.meta.resolve("@cline/ui/theme/tokens.css");
const summary = buildToolSummary({
	toolName: "read_files",
	input: { files: [{ path: "src/app.tsx", start_line: 10, end_line: 80 }] },
});
if (summary.label !== "Read file app.tsx (10–80)" || summary.kind !== "read") {
	throw new Error("tool-summary subpath returned an unexpected summary");
}
if (typeof ToolFileDiff !== "function") {
	throw new Error("tool-diff subpath did not export ToolFileDiff");
}
if (
	!AgentApprovalCard ||
	!AttachmentDropZone ||
	!AgentAskQuestion ||
	!AgentAurora ||
	!AgentHeroHeading ||
	!AgentWelcomeHero ||
	!AgentPromptQueue ||
	!SearchCombobox ||
	!AgentQuickActions ||
	!SessionStatus ||
	!Switch ||
	!Conversation ||
	!Message ||
	!css ||
	!tokens
) {
	process.exit(1);
}
`;

// Compile against the installed archive, not workspace source aliases. In
// particular, declaration checking catches optional peer API incompatibilities.
const typeCheck = `
import { createElement } from "react";
import { AgentPromptQueue, SearchCombobox } from "@cline/ui";
import { ToolFileDiff, type ToolFileDiffProps } from "@cline/ui/components/agent-chat/tool-diff";
const diff: ToolFileDiffProps = {
 path: "example.ts", oldText: "before", newText: "after",
 options: { diffStyle: "unified", disableLineNumbers: true },
};
createElement(ToolFileDiff, diff);
createElement(SearchCombobox, {
 ariaLabel: "Model", options: [{ label: "Model", value: "model" }], value: "model",
 onValueChange: (_value: string) => {}, onOpen: () => {},
});
createElement(AgentPromptQueue, {
 items: [{ id: "one", prompt: "Queued", steer: false }],
 onEdit: (_id: string, _prompt: string) => {},
 onRemove: (_id: string) => {}, onSteer: (_id: string) => {},
});
`;

const interactionCheck = `
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://consumer.test" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Event", "KeyboardEvent"]) {
 Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { SearchCombobox, AgentPromptQueue } = await import("@cline/ui");
const container = document.createElement("div");
document.body.append(container);
const root = createRoot(container);
try {
 let opens = 0;
 const props = { ariaLabel: "Model", options: [{ label: "Model", value: "model" }], value: "model", onValueChange() {}, onOpen() { opens++; } };
 await act(async () => root.render(createElement(SearchCombobox, props)));
 assert.equal(opens, 0, "mount must not refresh the picker");
 const trigger = container.querySelector("button");
 assert.ok(trigger);
 await act(async () => trigger.click());
 assert.equal(opens, 1, "opening the packed picker calls onOpen");
 await act(async () => root.render(createElement(SearchCombobox, { ...props, options: [...props.options] })));
 assert.equal(opens, 1, "a catalog refresh must not reopen the picker");
 await act(async () => trigger.click());
 assert.equal(opens, 1, "closing must not refresh the picker");
 await act(async () => trigger.click());
 assert.equal(opens, 2, "reopening refreshes again");
 await act(async () => root.render(createElement(SearchCombobox, { ...props, disabled: true })));
 await act(async () => trigger.click());
 assert.equal(opens, 2, "disabled picker must not refresh");
 const steered = [];
 const queueProps = { items: [{ id: "one", prompt: "Visible queued message", steer: false }], onEdit() {}, onRemove() {}, onSteer(id) { steered.push(id); } };
 await act(async () => root.render(createElement(AgentPromptQueue, queueProps)));
 assert.ok(container.textContent.includes("Visible queued message"), "single queued prompt is immediately visible");
 const singleHeader = container.querySelector("button[aria-expanded]");
 assert.equal(singleHeader?.getAttribute("aria-expanded"), "true");
 assert.equal(document.getElementById(singleHeader.getAttribute("aria-controls"))?.hidden, false, "single prompt is visible without opening a disclosure");
 const steer = container.querySelector('[aria-label="Steer queued prompt"]');
 assert.ok(steer, "single prompt retains manual steering");
 await act(async () => steer.click());
 assert.deepEqual(steered, ["one"]);
 await act(async () => root.render(createElement(AgentPromptQueue, { ...queueProps, items: [...queueProps.items, { id: "two", prompt: "Second queued message", steer: false }] })));
 const toggle = container.querySelector("button[aria-expanded]");
 assert.ok(toggle, "multiple prompts retain disclosure");
 assert.equal(toggle.getAttribute("aria-expanded"), "false");
 assert.equal(document.getElementById(toggle.getAttribute("aria-controls"))?.hidden, true);
 await act(async () => toggle.click());
 assert.ok(container.textContent.includes("Second queued message"));
 assert.equal(document.getElementById(toggle.getAttribute("aria-controls"))?.hidden, false);
} finally {
 await act(async () => root.unmount());
 dom.window.close();
}
`;

async function verifyConsumer(root: string, runtime: string[]): Promise<void> {
	writeFileSync(join(root, "consumer.ts"), typeCheck);
	await run(
		[
			process.execPath,
			"x",
			"tsc",
			"--noEmit",
			"--strict",
			"--module",
			"ESNext",
			"--moduleResolution",
			"Bundler",
			"--target",
			"ES2022",
			"--lib",
			"ESNext,DOM,DOM.Iterable",
			"consumer.ts",
		],
		root,
	);
	writeFileSync(join(root, "interactions.mjs"), interactionCheck);
	await run([...runtime, "interactions.mjs"], root);
}

async function run(command: string[], cwd: string): Promise<void> {
	const child = Bun.spawn(command, {
		cwd,
		stderr: "inherit",
		stdout: "inherit",
	});
	const exitCode = await child.exited;
	if (exitCode !== 0) {
		throw new Error(`${command.join(" ")} exited with ${exitCode}`);
	}
}

function createConsumer(root: string): void {
	mkdirSync(root, { recursive: true });
	writeFileSync(
		join(root, "package.json"),
		`${JSON.stringify({ name: "cline-ui-smoke", private: true, type: "module" }, null, 2)}\n`,
	);
}

async function compileTailwind(
	root: string,
	name: string,
	inputLines: string[],
	runner: string[],
): Promise<string> {
	const input = join(root, `${name}.css`);
	const output = join(root, `${name}-output.css`);
	writeFileSync(input, [...inputLines, ""].join("\n"));
	await run([...runner, "-i", input, "-o", output, "--minify"], root);
	return readFileSync(output, "utf8");
}

function expectCandidate(css: string, candidate: string): void {
	const selector = `.${candidate.replaceAll(":", "\\:").replaceAll("/", "\\/")}`;
	if (!css.includes(selector)) {
		throw new Error(`packed Tailwind source did not emit ${candidate}`);
	}
}

function expectFragment(css: string, fragment: string, contract: string): void {
	if (!css.includes(fragment)) {
		throw new Error(`${contract} did not emit ${fragment}`);
	}
}

function expectInlineHeroMasks(css: string, contract: string): void {
	const masks = css.match(/url\("?data:image\/svg\+xml;base64,/g);
	if (masks?.length !== 4) {
		throw new Error(`${contract} did not emit four inline SVG masks`);
	}
	if (css.includes("agent-welcome-hero-assets")) {
		throw new Error(`${contract} emitted external hero mask URLs`);
	}
}

async function verifyTailwindContract(
	root: string,
	runner: string[],
): Promise<void> {
	const css = await compileTailwind(
		root,
		"tailwind",
		[
			'@import "tailwindcss";',
			'@import "@cline/ui/theme/scoped-tokens.css";',
			'@import "@cline/ui/components.css";',
			"@theme inline {",
			"\t--color-background: var(--host-background);",
			"\t--radius-lg: var(--host-radius-lg);",
			"\t--text-sm--letter-spacing: var(--host-letter-spacing);",
			"}",
			'@source inline("bg-background rounded-lg text-sm");',
		],
		runner,
	);
	for (const candidate of [
		"bg-cline-ui-background/95",
		"border-cline-ui-border/60",
		"text-cline-ui-muted-foreground",
		"bg-cline-ui-primary/10",
		"max-h-64",
		"leading-none",
		"max-h-44",
		"not-last:border-b",
		"focus-visible:outline-3",
		"min-h-8",
		"resize-none",
		"backdrop-blur-sm",
		"border-dashed",
		"pointer-events-none",
	]) {
		expectCandidate(css, candidate);
	}
	for (const fragment of [
		"background-color:var(--host-background)",
		"border-radius:var(--host-radius-lg)",
		"letter-spacing:var(--host-letter-spacing)",
	]) {
		expectFragment(css, fragment, "host Tailwind namespace");
	}
	expectInlineHeroMasks(css, "host Tailwind namespace");

	const noPreflightCss = await compileTailwind(
		root,
		"tailwind-no-preflight",
		[
			"@layer theme, base, components, utilities;",
			'@import "tailwindcss/theme.css" layer(theme);',
			'@import "@cline/ui/theme/scoped-tokens.css";',
			'@import "@cline/ui/components.css";',
			'@import "tailwindcss/utilities.css" layer(utilities);',
		],
		runner,
	);
	for (const fragment of [
		"box-sizing:border-box",
		"border-style:solid",
		"font-family:inherit",
		"margin:.5rem 0 0",
		"padding-block:0",
	]) {
		expectFragment(noPreflightCss, fragment, "no-Preflight Tailwind contract");
	}
	expectInlineHeroMasks(noPreflightCss, "no-Preflight Tailwind contract");
	for (const output of [css, noPreflightCss]) {
		expectFragment(output, ".cline-ui-switch__track", "packed switch CSS");
		expectFragment(
			output,
			".cline-ui-switch__input:checked",
			"packed switch states",
		);
	}
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "cline-ui-package-"));

try {
	let archive = process.argv[2] ? resolve(process.argv[2]) : undefined;
	if (!archive) {
		const packDirectory = join(temporaryRoot, "pack");
		mkdirSync(packDirectory, { recursive: true });
		await run(
			[
				process.execPath,
				"pm",
				"pack",
				"--ignore-scripts",
				"--destination",
				packDirectory,
			],
			packageRoot,
		);
		const archiveName = readdirSync(packDirectory).find((name) =>
			name.endsWith(".tgz"),
		);
		if (!archiveName) throw new Error("bun pm pack did not create an archive");
		archive = join(packDirectory, archiveName);
	}

	const bunConsumer = join(temporaryRoot, "bun-consumer");
	createConsumer(bunConsumer);
	await run(
		[
			process.execPath,
			"add",
			"--ignore-scripts",
			archive,
			"react@19.2.4",
			"react-dom@19.2.4",
			"@pierre/diffs@1.4.0",
			"@types/react@19.2.14",
			"typescript@5.9.3",
			"@types/node@22",
			"jsdom@26.0.0",
			"tailwindcss@4.2.0",
			"@tailwindcss/cli@4.2.0",
		],
		bunConsumer,
	);
	await run([process.execPath, "-e", importCheck], bunConsumer);
	await verifyConsumer(bunConsumer, [process.execPath]);
	await verifyTailwindContract(bunConsumer, [
		process.execPath,
		"x",
		"tailwindcss",
	]);

	const nodeConsumer = join(temporaryRoot, "node-consumer");
	createConsumer(nodeConsumer);
	await run(
		[
			process.execPath,
			"add",
			"--ignore-scripts",
			archive,
			"react@18.3.1",
			"react-dom@18.3.1",
			"@pierre/diffs@1.3.2",
			"@types/react@18.3.1",
			"typescript@5.9.3",
			"@types/node@22",
			"jsdom@26.0.0",
			"tailwindcss@4.2.0",
			"@tailwindcss/cli@4.2.0",
		],
		nodeConsumer,
	);
	await run(["node", "--input-type=module", "-e", importCheck], nodeConsumer);
	await verifyConsumer(nodeConsumer, ["node"]);
	await verifyTailwindContract(nodeConsumer, [
		process.execPath,
		"x",
		"tailwindcss",
	]);
	console.log(
		`Verified packed ${basename(archive)} with Bun/React 19/diffs 1.4 and Node/React 18/diffs 1.3, including declarations, picker/queue interactions and Tailwind contracts`,
	);
} finally {
	rmSync(temporaryRoot, { force: true, recursive: true });
}
