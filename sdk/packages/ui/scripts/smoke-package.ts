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
} from "@cline/ui";
import { Conversation, Message } from "@cline/ui/components/agent-chat";
import {
	groupChatMessages,
	MessageBubble,
} from "@cline/ui/components/agent-chat/messages";
import { ToolMessageBlock } from "@cline/ui/components/agent-chat/messages/tool-message-block";
import { ToolFileDiff } from "@cline/ui/components/agent-chat/tool-diff";
import { buildToolSummary } from "@cline/ui/components/agent-chat/tool-summary";
import {
	createUiTranscriptState,
	reduceUiMessage,
} from "@cline/ui/protocol";

for (const specifier of [
	"@cline/ui/components.css",
	"@cline/ui/components/markdown.css",
	"@cline/ui/theme/palette.css",
	"@cline/ui/theme/scoped-tokens.css",
	// Terminal entries need the OpenTUI peers to load; browsers must never
	// import them, so the smoke only asserts the exports resolve.
	"@cline/ui/tui",
	"@cline/ui/tui/formatting",
]) {
	if (!existsSync(fileURLToPath(import.meta.resolve(specifier)))) {
		throw new Error("packed export does not exist: " + specifier);
	}
}

const transcript = reduceUiMessage(createUiTranscriptState(), {
	type: "assistant_delta",
	text: "hi",
});
if (
	transcript.blocks.length !== 1 ||
	transcript.blocks[0].kind !== "assistant_text"
) {
	throw new Error("protocol subpath did not accumulate assistant deltas");
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
const grouped = groupChatMessages([
	{
		id: "m1",
		sessionId: "s1",
		role: "assistant",
		content: "hi",
		createdAt: 1,
	},
]);
if (grouped.length !== 1 || grouped[0].type !== "message") {
	throw new Error("messages subpath did not group a transcript");
}
if (!MessageBubble || !ToolMessageBlock) {
	throw new Error("messages subpath did not export transcript components");
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
	!Conversation ||
	!Message ||
	!css ||
	!tokens
) {
	process.exit(1);
}
`;

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
		"bg-cline-ui-muted",
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
			"@pierre/diffs@1.3.2",
			"ansi-to-react@6.2.6",
			"lucide-react@0.564.0",
			"tailwindcss@4.2.0",
			"@tailwindcss/cli@4.2.0",
		],
		bunConsumer,
	);
	await run([process.execPath, "-e", importCheck], bunConsumer);
	await verifyTailwindContract(bunConsumer, [
		process.execPath,
		"x",
		"tailwindcss",
	]);

	// The messages barrel must stay importable without the optional
	// ansi-to-react peer; only the tool-message-block subpath needs it.
	const minimalConsumer = join(temporaryRoot, "minimal-messages-consumer");
	createConsumer(minimalConsumer);
	await run(
		[
			process.execPath,
			"add",
			"--ignore-scripts",
			archive,
			"react@19.2.4",
			"react-dom@19.2.4",
			"lucide-react@0.564.0",
		],
		minimalConsumer,
	);
	await run(
		[
			process.execPath,
			"-e",
			`
import { groupChatMessages, MessageBubble } from "@cline/ui/components/agent-chat/messages";
const grouped = groupChatMessages([
	{ id: "m1", sessionId: "s1", role: "assistant", content: "hi", createdAt: 1 },
]);
if (grouped.length !== 1 || grouped[0].type !== "message" || !MessageBubble) {
	throw new Error("messages barrel failed without ansi-to-react installed");
}
`,
		],
		minimalConsumer,
	);

	const npmConsumer = join(temporaryRoot, "npm-consumer");
	createConsumer(npmConsumer);
	await run(
		[
			"npm",
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			// The optional OpenTUI peers are Bun-first packages whose own peer
			// ranges conflict under npm's automatic peer installation; browser
			// consumers never load the terminal entries, so skip auto peers.
			"--legacy-peer-deps",
			archive,
			"react@18.3.1",
			"react-dom@18.3.1",
			"@pierre/diffs@1.3.2",
			"ansi-to-react@6.2.6",
			"lucide-react@0.564.0",
			"tailwindcss@4.2.0",
			"@tailwindcss/cli@4.2.0",
		],
		npmConsumer,
	);
	await run(["node", "--input-type=module", "-e", importCheck], npmConsumer);
	await verifyTailwindContract(npmConsumer, [
		"npx",
		"--no-install",
		"tailwindcss",
	]);
	console.log(
		`Verified packed ${basename(archive)} with Bun/React 19 and npm/Node/React 18, including Tailwind contracts`,
	);
} finally {
	rmSync(temporaryRoot, { force: true, recursive: true });
}
