import { resolve } from "node:path";
import { LAUNCHER_BOARD, packageLauncher } from "./launcher";
import { chooseBuild, listBoards } from "./menu";

const root = resolve(import.meta.dir, "..");
const boards = await listBoards(root);
let args = process.argv.slice(2);
if (args[0] === "--list") {
	for (const board of boards) {
		console.log(
			`${board.id}\t${board.name}${board.launcher ? " (M5Launcher supported)" : ""}`,
		);
	}
	process.exit(0);
}
if (args.length === 0) {
	try {
		const selected = await chooseBuild(boards);
		if (!selected) process.exit(0);
		args = selected;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
const profiles = boards.map((board) => board.id);
const [board, ...actions] = args;
if (!board || !profiles.includes(board)) {
	console.error(
		`Usage: bun firmware/tools/build.ts <${profiles.join(" | ")}> [build | flash | monitor | menuconfig ... | launcher]`,
	);
	process.exit(1);
}
const launcher = actions[0] === "launcher";
if (
	actions.includes("launcher") &&
	(!launcher || actions.length !== 1 || board !== LAUNCHER_BOARD)
) {
	console.error(
		"Use: bun firmware/tools/build.ts m5stack-cardputer-adv launcher (no flash actions).",
	);
	process.exit(1);
}
if (!Bun.which("idf.py")) {
	console.error(
		"ESP-IDF is not active. Source your ESP-IDF export.sh, then run this command again.",
	);
	process.exit(1);
}
console.log(`\nDevice: ${boards.find((item) => item.id === board)?.name}`);
console.log(`Project: ${root}`);
if (launcher)
	console.log(
		"Exporting an app for M5Launcher; copy the resulting .bin to your SD card and install it in Launcher.",
	);
else if (actions.includes("flash"))
	console.log(
		"Flashing full firmware replaces the installed firmware, including any launcher.",
	);
const child = Bun.spawn(
	[
		"idf.py",
		"-B",
		`build/${board}`,
		"-D",
		`CLINE_BOARD=${board}`,
		...(launcher ? ["build"] : actions.length ? actions : ["build"]),
	],
	{
		cwd: root,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	},
);
const code = await child.exited;
if (code !== 0) process.exit(code);
if (launcher)
	console.log(
		`M5Launcher app: ${await packageLauncher(resolve(root, "build", board))}`,
	);
