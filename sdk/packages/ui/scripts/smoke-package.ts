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

async function run(command: string[], cwd: string): Promise<void> {
	const process = Bun.spawn(command, {
		cwd,
		stderr: "inherit",
		stdout: "inherit",
	});
	const exitCode = await process.exited;
	if (exitCode !== 0) {
		throw new Error(`${command.join(" ")} exited with ${exitCode}`);
	}
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "cline-ui-package-"));

try {
	let archive = process.argv[2] ? resolve(process.argv[2]) : undefined;
	if (!archive) {
		const packDirectory = join(temporaryRoot, "pack");
		mkdirSync(packDirectory, { recursive: true });
		await run(
			[process.execPath, "pm", "pack", "--destination", packDirectory],
			packageRoot,
		);
		const archiveName = readdirSync(packDirectory).find((name) =>
			name.endsWith(".tgz"),
		);
		if (!archiveName) throw new Error("bun pm pack did not create an archive");
		archive = join(packDirectory, archiveName);
	}

	writeFileSync(
		join(temporaryRoot, "package.json"),
		`${JSON.stringify({ name: "cline-ui-smoke", private: true, type: "module" }, null, 2)}\n`,
	);
	await run(
		[process.execPath, "add", "--ignore-scripts", archive, "react@19.2.4"],
		temporaryRoot,
	);
	await run(
		[
			process.execPath,
			"-e",
			'import { Conversation, Message } from "@cline/ui/components/agent-chat"; const css = import.meta.resolve("@cline/ui/components/agent-chat.css"); const tokens = import.meta.resolve("@cline/ui/theme/tokens.css"); if (!Conversation || !Message || !css || !tokens) process.exit(1);',
		],
		temporaryRoot,
	);
	await run(
		[
			"node",
			"--input-type=module",
			"-e",
			'import { Conversation, Message } from "@cline/ui/components/agent-chat"; const css = import.meta.resolve("@cline/ui/components/agent-chat.css"); const tokens = import.meta.resolve("@cline/ui/theme/tokens.css"); if (!Conversation || !Message || !css || !tokens) process.exit(1);',
		],
		temporaryRoot,
	);
	console.log(
		`Verified packed ${basename(archive)} in a clean Bun and Node consumer`,
	);
} finally {
	rmSync(temporaryRoot, { force: true, recursive: true });
}
