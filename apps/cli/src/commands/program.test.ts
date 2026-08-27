import { relative, sep } from "node:path";
import {
	resolveClineDataDir,
	resolveClineDir,
	setHomeDir,
} from "@cline/shared/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commanderToParsedArgs, createProgram } from "./program";

/** Render an absolute path under `home` the way help text does: `~/...`. */
function tildePath(absolutePath: string, home: string): string {
	return `~/${relative(home, absolutePath).split(sep).join("/")}`;
}

describe("root option help text", () => {
	const FAKE_HOME = "/home/cline-help-test";
	const savedEnv: Record<string, string | undefined> = {};

	beforeAll(() => {
		// Pin the resolver inputs so the defaults below are the true defaults
		// (no CLINE_DIR/CLINE_DATA_DIR overrides, known home directory).
		for (const key of ["CLINE_DIR", "CLINE_DATA_DIR"]) {
			savedEnv[key] = process.env[key];
			delete process.env[key];
		}
		setHomeDir(FAKE_HOME);
	});

	afterAll(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	});

	it("reports the actual resolver defaults for --config and --data-dir", () => {
		// A wide help width keeps each option description on one line so the
		// full default text can be matched.
		const help = createProgram()
			.configureHelp({ helpWidth: 500 })
			.helpInformation();

		const configDefault = tildePath(resolveClineDir(), FAKE_HOME);
		const dataDirDefault = tildePath(resolveClineDataDir(), FAKE_HOME);

		// Sanity-check the resolvers themselves so the assertions below can't
		// silently drift along with a resolver regression.
		expect(configDefault).toBe("~/.cline");
		expect(dataDirDefault).toBe("~/.cline/data");

		expect(help).toContain(
			`Configuration directory (default: ${configDefault})`,
		);
		expect(help).toContain(
			`Use isolated local state at this directory path (default: ${dataDirDefault})`,
		);
	});
});

describe("local cloud teammate flags", () => {
	it("collects an explicit opt-in and repeatable capsule selections", () => {
		const program = createProgram();
		program.parse([
			"node",
			"cline",
			"--cloud-teammates-local",
			"--cloud-file",
			"src/index.ts",
			"--cloud-file",
			"dist/app.dmg",
			"delegate this review",
		]);

		expect(commanderToParsedArgs(program)).toMatchObject({
			cloudTeammatesLocal: true,
			cloudFiles: ["src/index.ts", "dist/app.dmg"],
			prompt: "delegate this review",
		});
	});
});
