import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	__test__,
	readSessionMessageCount,
	readSessionReplyText,
} from "./common";

describe("spawnDetachedConnector", () => {
	it("preserves the connect subcommand when building detached connector args", () => {
		expect(
			__test__.buildDetachedConnectorArgs(
				["connect", "telegram"],
				["-m", "ClineAdapterBot", "-k", "token-123"],
			),
		).toEqual([
			"connect",
			"telegram",
			"-m",
			"ClineAdapterBot",
			"-k",
			"token-123",
			"-i",
		]);
	});

	it("preserves bun conditions and resolves the cli entrypoint for detached launches", () => {
		const entryPath = fileURLToPath(import.meta.url);
		expect(
			__test__.buildDetachedConnectorCommand(
				["connect", "telegram"],
				["-m", "ClineAdapterBot", "-k", "token-123"],
				"/Users/test/.bun/bin/bun",
				entryPath,
				["--conditions=development"],
				dirname(entryPath),
				{},
			),
		).toEqual({
			launcher: "/Users/test/.bun/bin/bun",
			childArgs: [
				"--inspect=127.0.0.1:0",
				"--enable-source-maps",
				"--conditions=development",
				entryPath,
				"connect",
				"telegram",
				"-m",
				"ClineAdapterBot",
				"-k",
				"token-123",
				"-i",
			],
		});
	});

	it("uses a dynamic connector inspector port for development node launches", () => {
		const entryPath = fileURLToPath(import.meta.url);
		expect(
			__test__.buildDetachedConnectorCommand(
				["connect", "telegram"],
				["-m", "ClineAdapterBot"],
				"/usr/local/bin/node",
				entryPath,
				[],
				dirname(entryPath),
				{ CLINE_BUILD_ENV: "development" },
			),
		).toEqual({
			launcher: "/usr/local/bin/node",
			childArgs: [
				"--inspect=127.0.0.1:0",
				"--enable-source-maps",
				entryPath,
				"connect",
				"telegram",
				"-m",
				"ClineAdapterBot",
				"-i",
			],
		});
	});
});

describe("readSessionReplyText", () => {
	it("reads messages through the hub session client", async () => {
		const client = {
			readMessages: async () => [
				{
					role: "user",
					content: [{ type: "text", text: "question" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "first" }],
				},
				{
					role: "assistant",
					content: [
						{ type: "text", text: "latest " },
						{ type: "text", text: "reply" },
					],
				},
			],
		};

		await expect(
			readSessionReplyText(client as never, "session-1"),
		).resolves.toBe("latest reply");
	});

	it("can restrict fallback replies to messages after a known boundary", async () => {
		const client = {
			readMessages: async () => [
				{
					role: "assistant",
					content: [{ type: "text", text: "previous reply" }],
				},
				{
					role: "user",
					content: [{ type: "text", text: "next question" }],
				},
				{
					role: "assistant",
					content: [{ type: "text", text: "current reply" }],
				},
			],
		};

		await expect(
			readSessionReplyText(client as never, "session-1", {
				minMessageIndex: 1,
			}),
		).resolves.toBe("current reply");
	});

	it("does not read prior assistant replies before the boundary", async () => {
		const client = {
			readMessages: async () => [
				{
					role: "assistant",
					content: [{ type: "text", text: "previous reply" }],
				},
				{
					role: "user",
					content: [{ type: "text", text: "next question" }],
				},
			],
		};

		await expect(
			readSessionReplyText(client as never, "session-1", {
				minMessageIndex: 1,
			}),
		).resolves.toBeUndefined();
	});

	it("reads the session message count through the hub session client", async () => {
		const client = {
			readMessages: async () => [
				{ role: "user", content: "one" },
				{ role: "assistant", content: "two" },
			],
		};

		await expect(
			readSessionMessageCount(client as never, "session-1"),
		).resolves.toBe(2);
	});
});
