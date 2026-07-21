import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeDesktopEnvironment } from "./environment";

const originalPath = process.env.PATH;

afterEach(() => {
	process.env.PATH = originalPath;
});

describe("initializeDesktopEnvironment", () => {
	it.each(["darwin", "linux"] as const)(
		"loads the user shell PATH on %s",
		(platform) => {
			process.env.PATH = "/usr/bin:/bin";
			const resolvePath = vi.fn(() => {
				process.env.PATH = "/opt/homebrew/bin:/usr/bin:/bin";
			});

			expect(initializeDesktopEnvironment(platform, resolvePath)).toEqual({
				pathChanged: true,
			});
			expect(resolvePath).toHaveBeenCalledOnce();
			expect(process.env.PATH).toContain("/opt/homebrew/bin");
		},
	);

	it("keeps the inherited Windows PATH", () => {
		process.env.PATH = "C:\\Windows\\System32";
		const resolvePath = vi.fn();

		expect(initializeDesktopEnvironment("win32", resolvePath)).toEqual({
			pathChanged: false,
		});
		expect(resolvePath).not.toHaveBeenCalled();
		expect(process.env.PATH).toBe("C:\\Windows\\System32");
	});

	it("preserves the inherited PATH when shell resolution fails", () => {
		process.env.PATH = "/usr/bin:/bin";
		const resolvePath = vi.fn(() => {
			process.env.PATH = "/broken";
			throw new Error("shell startup failed");
		});

		expect(initializeDesktopEnvironment("darwin", resolvePath)).toEqual({
			pathChanged: false,
			error: "shell startup failed",
		});
		expect(process.env.PATH).toBe("/usr/bin:/bin");
	});
});
