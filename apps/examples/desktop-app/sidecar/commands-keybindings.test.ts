import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() =>
	vi.fn(() => ({ once: vi.fn(), unref: vi.fn() })),
);
vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawn,
}));

import { handleCommand } from "./commands";
import { createSidecarContext } from "./context";
import { resolveKeybindingsPath } from "./keybindings";

let dataDir: string;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "cline-commands-keybindings-"));
	process.env.CLINE_DATA_DIR = dataDir;
	spawn.mockClear();
});

afterEach(() => {
	delete process.env.CLINE_DATA_DIR;
	rmSync(dataDir, { recursive: true, force: true });
});

describe("open_keybindings_file", () => {
	it("creates the file when it is missing", async () => {
		const ctx = createSidecarContext("/local/workspace");
		const result = await handleCommand(ctx, "open_keybindings_file", {});
		expect(result).toEqual({ path: resolveKeybindingsPath() });
		expect(JSON.parse(readFileSync(resolveKeybindingsPath(), "utf8"))).toEqual({
			version: 1,
			bindings: {},
		});
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("leaves an existing malformed file alone so the user can fix it", async () => {
		const filePath = resolveKeybindingsPath();
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, '{ "bindings": { "quit": { "key": "Mod+Q", } } }');
		const ctx = createSidecarContext("/local/workspace");
		await handleCommand(ctx, "open_keybindings_file", {});
		expect(readFileSync(filePath, "utf8")).toBe(
			'{ "bindings": { "quit": { "key": "Mod+Q", } } }',
		);
	});
});
