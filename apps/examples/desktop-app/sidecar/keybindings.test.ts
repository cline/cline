import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readKeybindings,
	resolveKeybindingsPath,
	sanitizeKeybindings,
	writeKeybindings,
} from "./keybindings";

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-keybindings-"));
	process.env.CLINE_DATA_DIR = dataDir;
});

afterEach(() => {
	delete process.env.CLINE_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
});

describe("keybindings store", () => {
	it("returns no overrides when the file is missing", () => {
		expect(readKeybindings()).toEqual({ version: 1, bindings: {} });
	});

	it("round-trips bindings through keybindings.json", () => {
		writeKeybindings({
			bindings: {
				quit: { key: "Mod+Q", holdMs: 1500 },
				"new-session": { key: "" },
			},
		});
		expect(resolveKeybindingsPath().endsWith("keybindings.json")).toBe(true);
		expect(JSON.parse(readFileSync(resolveKeybindingsPath(), "utf8"))).toEqual({
			version: 1,
			bindings: {
				quit: { key: "Mod+Q", holdMs: 1500 },
				"new-session": { key: "" },
			},
		});
		expect(readKeybindings().bindings.quit).toEqual({
			key: "Mod+Q",
			holdMs: 1500,
		});
	});

	it("drops malformed entries and clamps hold durations", () => {
		expect(
			sanitizeKeybindings({
				bindings: {
					a: { key: 5 },
					b: "Mod+B",
					c: { key: "Mod+C", holdMs: 999_999 },
					d: { key: "Mod+D", holdMs: -4 },
				},
			}).bindings,
		).toEqual({ c: { key: "Mod+C", holdMs: 5000 }, d: { key: "Mod+D" } });
	});

	it("falls back to defaults on invalid JSON", () => {
		writeKeybindings({ bindings: {} });
		writeFileSync(resolveKeybindingsPath(), "{nope");
		expect(readKeybindings()).toEqual({ version: 1, bindings: {} });
	});
});
