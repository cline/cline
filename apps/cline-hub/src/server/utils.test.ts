import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { openExternalUrl } from "./utils";

vi.mock("node:child_process", () => ({
	spawn: vi.fn(() => {
		const child = {
			once: vi.fn(),
			unref: vi.fn(),
		};
		return child;
	}),
}));

const spawnMock = vi.mocked(spawn);

describe("openExternalUrl", () => {
	it("never routes the URL through cmd.exe and passes it as a single argv entry", () => {
		spawnMock.mockClear();
		// Contains cmd.exe statement separators (&) that a `cmd /c start`
		// based implementation re-parses into extra commands.
		const url = "https://example.com/auth?client_type=extension&x=1&calc";
		openExternalUrl(url);
		const call = spawnMock.mock.calls.at(-1) as
			| [string, string[]]
			| undefined;
		expect(call).toBeDefined();
		const [command, args] = call as [string, string[]];
		expect(command).not.toBe("cmd");
		expect(args).not.toContain("/c");
		expect(args).not.toContain("start");
		// The URL must arrive as exactly one argv entry with no shell
		// re-parsing in between.
		expect(args.filter((entry) => entry === url)).toHaveLength(1);
	});
});
