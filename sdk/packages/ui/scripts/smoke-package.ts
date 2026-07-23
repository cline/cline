import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const importCheck = `
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Conversation, Message } from "@cline/ui/components/agent-chat";
import { Button, SearchCombobox, SessionStatus } from "@cline/ui";
const controlsCss = import.meta.resolve("@cline/ui/components.css");
const css = import.meta.resolve("@cline/ui/components/agent-chat.css");
const markdown = import.meta.resolve("@cline/ui/components/markdown.css");
const scopedTokens = import.meta.resolve("@cline/ui/theme/scoped-tokens.css");
const tokens = import.meta.resolve("@cline/ui/theme/tokens.css");
if (!Button || !SearchCombobox || !SessionStatus || !Conversation || !Message || !controlsCss || !css || !markdown || !scopedTokens || !tokens) process.exit(1);
const entry = fileURLToPath(import.meta.resolve("@cline/ui"));
const sourceMapPath = entry + ".map";
const sourceMap = JSON.parse(readFileSync(sourceMapPath, "utf8"));
if (!sourceMap.sources.every((source) => existsSync(resolve(dirname(sourceMapPath), source)))) process.exit(1);
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
		[process.execPath, "add", "--ignore-scripts", archive, "react@19.2.4"],
		bunConsumer,
	);
	await run([process.execPath, "-e", importCheck], bunConsumer);

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
