import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { persistSessionMessages, readSessionMessages } from "./messages";

// Both the blob store and the sidecar's session paths read this lazily, so the
// test owns the whole session data root.
const sessionDataDir = mkdtempSync(join(tmpdir(), "cline-blob-projection-"));
process.env.CLINE_SESSION_DATA_DIR = sessionDataDir;

type StoredContent = { type: string; blobId?: string; mediaType?: string };
type ProjectedMessage = {
	role?: string;
	images?: { mediaType: string; data: string }[];
};

describe("blob-referenced history projection", () => {
	it("stores oversized images as refs but hands the UI base64 bytes", async () => {
		const sessionId = "blob-projection";
		const base64 = Buffer.alloc(64 * 1024, 7).toString("base64");
		persistSessionMessages(sessionId, [
			{
				id: "img-1",
				role: "assistant",
				ts: 1,
				content: [{ type: "image", mediaType: "image/png", data: base64 }],
			},
		]);

		const stored = JSON.parse(
			readFileSync(
				join(sessionDataDir, sessionId, `${sessionId}.messages.json`),
				"utf8",
			),
		) as { messages: { content: StoredContent[] }[] };
		// On disk the bytes are replaced by a content-addressed reference.
		expect(stored.messages[0]?.content[0]?.type).toBe("image_ref");
		expect(stored.messages[0]?.content[0]?.blobId).toMatch(/^[a-f0-9]{64}$/);
		expect(readdirSync(join(sessionDataDir, sessionId, "blobs")).length).toBe(1);

		// The UI projection must materialize the bytes: the bundled webview
		// renders `data:${mediaType};base64,${data}`, so a blob URL would render
		// as a broken image.
		const projected = (await readSessionMessages(
			{ liveSessions: new Map() } as Parameters<typeof readSessionMessages>[0],
			sessionId,
		)) as ProjectedMessage[];
		const image = projected.find((message) => message.images?.length)?.images?.[0];
		expect(image?.mediaType).toBe("image/png");
		expect(image?.data).toBe(base64);
	});

	it("drops a ref whose blob file is missing instead of emitting a broken payload", async () => {
		const sessionId = "blob-projection-missing";
		persistSessionMessages(sessionId, [
			{
				id: "img-2",
				role: "assistant",
				ts: 1,
				content: [
					{
						type: "image_ref",
						mediaType: "image/png",
						blobId: "0".repeat(64),
					},
				],
			},
		]);

		const projected = (await readSessionMessages(
			{ liveSessions: new Map() } as Parameters<typeof readSessionMessages>[0],
			sessionId,
		)) as ProjectedMessage[];
		expect(projected.some((message) => message.images?.length)).toBe(false);
	});
});
