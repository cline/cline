import { describe, expect, it, vi } from "vitest";
import { createOAuthClientCallbacks } from "./client";

describe("auth/client createOAuthClientCallbacks", () => {
	it("emits instructions and URL and forwards prompts", async () => {
		const onOutput = vi.fn();
		const onPrompt = vi.fn().mockResolvedValue("value");
		const callbacks = createOAuthClientCallbacks({ onOutput, onPrompt });

		callbacks.onAuth({
			url: "https://example.com/auth",
			instructions: "Open your browser",
		});
		const answer = await callbacks.onPrompt({ message: "Enter code" });

		expect(answer).toBe("value");
		expect(onPrompt).toHaveBeenCalledWith({ message: "Enter code" });
		expect(onOutput).toHaveBeenNthCalledWith(1, "Open your browser");
		expect(onOutput).toHaveBeenNthCalledWith(2, "https://example.com/auth");
	});

	it("tries opening URL and reports opener errors", async () => {
		const openUrl = vi.fn().mockRejectedValue(new Error("failed"));
		const onOpenUrlError = vi.fn();
		const callbacks = createOAuthClientCallbacks({
			onPrompt: vi.fn().mockResolvedValue(""),
			openUrl,
			onOpenUrlError,
		});

		callbacks.onAuth({ url: "https://example.com/auth" });
		await Promise.resolve();

		expect(openUrl).toHaveBeenCalledWith("https://example.com/auth");
		expect(onOpenUrlError).toHaveBeenCalledTimes(1);
		expect(onOpenUrlError.mock.calls[0]?.[0]).toMatchObject({
			url: "https://example.com/auth",
		});
	});

	it("reports synchronous opener errors without aborting auth output", () => {
		const openUrl = vi.fn(() => {
			throw new Error("missing opener");
		});
		const onOpenUrlError = vi.fn();
		const onOutput = vi.fn();
		const callbacks = createOAuthClientCallbacks({
			onPrompt: vi.fn().mockResolvedValue(""),
			onOutput,
			openUrl,
			onOpenUrlError,
		});

		expect(() =>
			callbacks.onAuth({ url: "https://example.com/auth" }),
		).not.toThrow();
		expect(openUrl).toHaveBeenCalledWith("https://example.com/auth");
		expect(onOpenUrlError).toHaveBeenCalledTimes(1);
		expect(onOpenUrlError.mock.calls[0]?.[0]).toMatchObject({
			url: "https://example.com/auth",
		});
		expect(onOutput).toHaveBeenLastCalledWith("https://example.com/auth");
	});

	it("forwards onServerListening to the returned callbacks", () => {
		const onServerListening = vi.fn();
		const callbacks = createOAuthClientCallbacks({
			onPrompt: vi.fn().mockResolvedValue(""),
			onServerListening,
		});

		expect(callbacks.onServerListening).toBe(onServerListening);
	});

	it("forwards onServerClose to the returned callbacks", () => {
		const onServerClose = vi.fn();
		const callbacks = createOAuthClientCallbacks({
			onPrompt: vi.fn().mockResolvedValue(""),
			onServerClose,
		});

		expect(callbacks.onServerClose).toBe(onServerClose);
	});

	it("leaves onServerListening and onServerClose undefined when not provided", () => {
		const callbacks = createOAuthClientCallbacks({
			onPrompt: vi.fn().mockResolvedValue(""),
		});

		expect(callbacks.onServerListening).toBeUndefined();
		expect(callbacks.onServerClose).toBeUndefined();
	});
});
