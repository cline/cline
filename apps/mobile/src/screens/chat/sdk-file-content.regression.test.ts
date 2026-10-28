import { Buffer } from "node:buffer";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSessionState,
	reduceSession,
	selectViewModel,
} from "@/session/reducer";
import { parseSessionMessagesReply } from "@/session/schemas";
import { shareGeneratedFile } from "./GeneratedFile";

beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
	vi.mocked(Sharing.shareAsync).mockResolvedValue();
});

describe("SDK file attachments keep their original UTF-8 bytes", () => {
	// buildUserFileContentBlock in Core's user-input-builder.ts persists the
	// loader's text verbatim in FileContent.content; it does not base64-encode it.
	it.each([
		["README.md", "# Read me\nHello"],
		["encoded-example.txt", "SGVsbG8="],
		["unicode.txt", "Résumé 🐈\nこんにちは\n"],
	])("shares %s without rejecting or decoding its authored text", async (name, content) => {
		const parsed = parseSessionMessagesReply({
			messages: [
				{
					role: "user",
					content: [{ type: "file", path: `/repo/${name}`, content }],
				},
			],
		});
		if (parsed.status !== "ok") throw new Error("SDK file payload must parse");
		const state = reduceSession(createSessionState(), {
			type: "hydrated",
			messages: parsed.messages,
		});
		const block = selectViewModel(state).messages[0]?.blocks[0];
		if (block?.kind !== "media")
			throw new Error("The attached file must remain accessible");
		const write = vi.spyOn(File.prototype, "write");
		await shareGeneratedFile(block.media);
		expect(write).toHaveBeenCalledWith(
			Buffer.from(content, "utf8").toString("base64"),
			{ encoding: "base64" },
		);
		expect(Sharing.shareAsync).toHaveBeenCalledOnce();
	});
});
