import { describe, expect, it, vi } from "vitest";
import { handleDeepLink } from "./deep-link";

describe("handleDeepLink", () => {
	it("forwards a normalized link to Hub", async () => {
		const writeln = vi.fn();
		const openInHub = vi.fn(async () => ({
			type: "new_session" as const,
			prompt: "fix it",
		}));
		const result = await handleDeepLink({
			url: "cline://new-session?prompt=fix%20it",
			cwd: "/tmp/project",
			io: { writeln, writeErr: vi.fn() },
			openInHub,
		});
		expect(result).toBe(0);
		expect(openInHub).toHaveBeenCalledWith(
			"cline://new-session?prompt=fix%20it",
			"/tmp/project",
		);
		expect(writeln).toHaveBeenCalledWith(
			"Forwarded Cline link to Hub (new_session).",
		);
	});

	it("rejects invalid URLs without starting Hub", async () => {
		const openInHub = vi.fn();
		const writeErr = vi.fn();
		expect(
			await handleDeepLink({
				url: "https://example.com",
				io: { writeln: vi.fn(), writeErr },
				openInHub,
			}),
		).toBe(1);
		expect(openInHub).not.toHaveBeenCalled();
		expect(writeErr).toHaveBeenCalled();
	});
});
