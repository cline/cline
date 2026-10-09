import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	actionsFor,
	commandArgs,
	listBoards,
	serialPorts,
} from "../tools/menu";

const root = resolve(import.meta.dir, "..");

test("catalog lists every profile and offers launcher export only for Cardputer", async () => {
	const boards = await listBoards(root);
	expect(boards).toHaveLength(3);
	for (const board of boards) {
		expect(
			actionsFor(board).some((action) => action.args.includes("launcher")),
		).toBe(board.id === "m5stack-cardputer-adv");
		const flash = actionsFor(board).find(
			(action) => action.args[0] === "flash",
		)!;
		expect(commandArgs(board.id, flash, "/dev/cu.usbmodem-test")).toEqual([
			board.id,
			"-p",
			"/dev/cu.usbmodem-test",
			"flash",
		]);
		expect(() => commandArgs(board.id, flash)).toThrow("serial port");
	}
});

test("detects USB serial ports for macOS and Linux without listing unrelated devices", async () => {
	const dev = await mkdtemp(join(tmpdir(), "device-ports-"));
	try {
		for (const name of [
			"cu.usbmodem0123",
			"cu.SLAB_USBtoUART",
			"ttyACM0",
			"ttyUSB1",
			"tty0",
			"cu.Bluetooth-Incoming-Port",
		])
			await writeFile(join(dev, name), "");
		expect(await serialPorts("darwin", dev)).toEqual([
			join(dev, "cu.SLAB_USBtoUART"),
			join(dev, "cu.usbmodem0123"),
		]);
		expect(await serialPorts("linux", dev)).toEqual([
			join(dev, "ttyACM0"),
			join(dev, "ttyUSB1"),
		]);
	} finally {
		await rm(dev, { recursive: true, force: true });
	}
});

test("direct flash commands always run from the firmware project with the chosen board directory", async () => {
	const bin = await mkdtemp(join(tmpdir(), "device-idf-"));
	try {
		await writeFile(
			join(bin, "idf.py"),
			'#!/usr/bin/env python3\nimport os,sys,json\nprint(json.dumps({"cwd":os.getcwd(),"args":sys.argv[1:]}))\n',
			{ mode: 0o755 },
		);
		const result = Bun.spawnSync(
			[
				process.execPath,
				join(root, "tools/build.ts"),
				"waveshare-s3-epaper-154",
				"-p",
				"/dev/cu.test",
				"flash",
			],
			{
				cwd: bin,
				env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
			},
		);
		expect(result.exitCode).toBe(0);
		const line = result.stdout
			.toString()
			.split("\n")
			.find((line) => line.startsWith('{"cwd"'))!;
		expect(JSON.parse(line)).toEqual({
			cwd: root,
			args: [
				"-B",
				"build/waveshare-s3-epaper-154",
				"-D",
				"CLINE_BOARD=waveshare-s3-epaper-154",
				"-p",
				"/dev/cu.test",
				"flash",
			],
		});
	} finally {
		await rm(bin, { recursive: true, force: true });
	}
});
