import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCliBuildInfo } from "../utils/common";
import { createDevCommand } from "./dev";

describe("createDevCommand", () => {
	const tempDirs: string[] = [];
	const commandName = getCliBuildInfo().name;

	afterEach(() => {
		delete process.env.CLINE_DATA_DIR;
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("opens the log file for dev log", async () => {
		const dataDir = mkdtempSync(
			path.join(os.tmpdir(), `${commandName}-dev-log-test-`),
		);
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;

		const opened: string[] = [];
		const output: string[] = [];
		const errors: string[] = [];
		let exitCode = 0;

		const cmd = createDevCommand(
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: (text) => {
					errors.push(text);
				},
			},
			(code) => {
				exitCode = code;
			},
			{
				openPath: async (target) => {
					opened.push(target);
				},
			},
		);

		await cmd.parseAsync(["log"], { from: "user" });

		const expectedPath = path.join(dataDir, "logs", `${commandName}.log`);
		expect(exitCode).toBe(0);
		expect(errors).toHaveLength(0);
		expect(opened).toEqual([expectedPath]);
		expect(output).toEqual([expectedPath]);
		expect(existsSync(expectedPath)).toBe(true);
	});

	it("shows help for unknown subcommands", async () => {
		const cmd = createDevCommand(
			{
				writeln: () => {},
				writeErr: () => {},
			},
			() => {},
		);

		await expect(
			cmd.parseAsync(["unknown"], { from: "user" }),
		).rejects.toThrow();
	});

	it("returns an error if opening log file fails", async () => {
		const dataDir = mkdtempSync(
			path.join(os.tmpdir(), `${commandName}-dev-log-test-`),
		);
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;

		const errors: string[] = [];
		let exitCode = 0;

		const cmd = createDevCommand(
			{
				writeln: () => {},
				writeErr: (text) => {
					errors.push(text);
				},
			},
			(code) => {
				exitCode = code;
			},
			{
				openPath: async () => {
					throw new Error("open failed");
				},
			},
		);

		await cmd.parseAsync(["log"], { from: "user" });

		expect(exitCode).toBe(1);
		expect(errors[0]).toContain("failed to open log file");
		expect(errors[0]).toContain("open failed");
	});
});
