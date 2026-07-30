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
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	AgentAurora,
	AgentHeroHeading,
	AgentQuickActions,
	SearchCombobox,
	SessionStatus,
} from "@cline/ui";
import { Conversation, Message } from "@cline/ui/components/agent-chat";

for (const specifier of [
	"@cline/ui/components.css",
	"@cline/ui/components/markdown.css",
	"@cline/ui/theme/scoped-tokens.css",
]) {
	if (!existsSync(fileURLToPath(import.meta.resolve(specifier)))) {
		throw new Error("packed CSS export does not exist: " + specifier);
	}
}

const css = import.meta.resolve("@cline/ui/components/agent-chat.css");
const tokens = import.meta.resolve("@cline/ui/theme/tokens.css");
if (
	!AgentAurora ||
	!AgentHeroHeading ||
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

async function verifyTailwindContract(root: string): Promise<void> {
	const input = join(root, "tailwind.css");
	const output = join(root, "tailwind-output.css");
	writeFileSync(
		input,
		[
			'@import "tailwindcss";',
			'@import "@cline/ui/theme/scoped-tokens.css";',
			'@import "@cline/ui/theme/theme.css";',
			'@import "@cline/ui/components.css";',
			"",
		].join("\n"),
	);
	await run(
		[
			process.execPath,
			"x",
			"tailwindcss",
			"-i",
			input,
			"-o",
			output,
			"--minify",
		],
		root,
	);
	const css = readFileSync(output, "utf8");
	for (const candidate of [
		"bg-background/95",
		"border-border/60",
		"text-muted-foreground",
		"bg-primary/10",
		"max-h-56",
		"leading-none",
	]) {
		const selector = `.${candidate.replace("/", "\\/")}`;
		if (!css.includes(selector)) {
			throw new Error(`packed Tailwind source did not emit ${candidate}`);
		}
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
			"tailwindcss@4.2.0",
			"@tailwindcss/cli@4.2.0",
		],
		bunConsumer,
	);
	await run([process.execPath, "-e", importCheck], bunConsumer);
	await verifyTailwindContract(bunConsumer);

	const npmConsumer = join(temporaryRoot, "npm-consumer");
	createConsumer(npmConsumer);
	await run(
		[
			"npm",
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			archive,
			"react@18.3.1",
		],
		npmConsumer,
	);
	await run(["node", "--input-type=module", "-e", importCheck], npmConsumer);
	console.log(
		`Verified packed ${basename(archive)} with Bun/React 19 and npm/Node/React 18`,
	);
} finally {
	rmSync(temporaryRoot, { force: true, recursive: true });
}
