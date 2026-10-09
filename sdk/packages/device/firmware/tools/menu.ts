import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

export interface Board {
	id: string;
	name: string;
	launcher: boolean;
}
export interface Action {
	label: string;
	args: string[];
	port?: boolean;
}

export async function listBoards(root: string): Promise<Board[]> {
	const catalog = JSON.parse(
		await readFile(join(root, "devices/boards.json"), "utf8"),
	) as Record<string, Omit<Board, "id">>;
	const profiles = (await readdir(join(root, "devices")))
		.filter((name) => name.startsWith("sdkconfig.cline-"))
		.map((name) => name.slice("sdkconfig.cline-".length))
		.sort();
	if (
		profiles.length !== Object.keys(catalog).length ||
		profiles.some(
			(id) => !catalog[id]?.name || typeof catalog[id].launcher !== "boolean",
		)
	) {
		throw new Error(
			"devices/boards.json must describe every sdkconfig.cline-* profile",
		);
	}
	return profiles.map((id) => ({ id, ...catalog[id] }));
}

export function actionsFor(board: Board): Action[] {
	return [
		...(board.launcher
			? [
					{
						label: "Build M5Launcher app (install from SD; preserves launcher)",
						args: ["launcher"],
					},
				]
			: []),
		{ label: "Build firmware", args: ["build"] },
		{
			label: "Build and flash firmware (replaces installed firmware)",
			args: ["flash"],
			port: true,
		},
		{
			label: "Build, flash, and open serial monitor",
			args: ["flash", "monitor"],
			port: true,
		},
		{ label: "Open serial monitor", args: ["monitor"], port: true },
		{ label: "Configure firmware (menuconfig)", args: ["menuconfig"] },
	];
}

export async function serialPorts(
	platform = process.platform,
	devRoot = "/dev",
): Promise<string[]> {
	if (platform === "win32") {
		const result = Bun.spawnSync(
			[
				"powershell.exe",
				"-NoProfile",
				"-Command",
				"[System.IO.Ports.SerialPort]::GetPortNames()",
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		if (result.exitCode !== 0) return [];
		return result.stdout.toString().trim().split(/\s+/).filter(Boolean).sort();
	}
	const names = await readdir(devRoot);
	const pattern =
		platform === "darwin" ? /^cu\.(usb|SLAB|wch)/i : /^tty(USB|ACM)\d+$/;
	return names
		.filter((name) => pattern.test(name))
		.map((name) => join(devRoot, name))
		.sort();
}

export function commandArgs(
	board: string,
	action: Action,
	port?: string,
): string[] {
	const selectedPort = port?.trim() ?? "";
	if (action.port && !selectedPort)
		throw new Error("This action requires a serial port");
	return [board, ...(action.port ? ["-p", selectedPort] : []), ...action.args];
}

export async function chooseBuild(
	boards: Board[],
): Promise<string[] | undefined> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error(
			"The device menu needs an interactive terminal. Use --list or pass a board and action explicitly.",
		);
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	async function choose<T>(
		title: string,
		values: T[],
		label: (value: T) => string,
	): Promise<T | undefined> {
		console.log(`\n${title}`);
		values.forEach((value, index) => {
			console.log(`  ${index + 1}. ${label(value)}`);
		});
		for (;;) {
			const answer = (
				await rl.question("Choose a number (q to cancel): ")
			).trim();
			if (answer.toLowerCase() === "q") return undefined;
			if (/^\d+$/.test(answer) && values[Number(answer) - 1])
				return values[Number(answer) - 1];
			console.log(`Enter a number from 1 to ${values.length}, or q.`);
		}
	}
	try {
		const board = await choose(
			"Supported Cline devices",
			boards,
			(board) => board.name,
		);
		if (!board) return;
		const action = await choose(
			"What would you like to do?",
			actionsFor(board),
			(action) => action.label,
		);
		if (!action) return;
		let port: string | undefined;
		if (action.port) {
			console.log("Connect your device by USB. Select its port below.");
			for (;;) {
				const ports = await serialPorts();
				const selection = await choose(
					"Serial port",
					[...ports, "Enter a port manually", "Refresh detected ports"],
					(port) => port,
				);
				if (!selection) return;
				if (selection === "Refresh detected ports") continue;
				port = selection;
				if (selection === "Enter a port manually") {
					port = (await rl.question("Serial port path (q to cancel): ")).trim();
					if (port.toLowerCase() === "q") return;
					if (!port) {
						console.log("Enter a serial port path.");
						continue;
					}
				}
				break;
			}
		}
		return commandArgs(board.id, action, port);
	} finally {
		rl.close();
	}
}
