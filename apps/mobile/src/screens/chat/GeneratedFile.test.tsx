import type { GeneratedMedia } from "@cline/shared";
import { Directory, File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../ui/__testing__/render";
import { GeneratedFile, shareGeneratedFile } from "./GeneratedFile";

const media: GeneratedMedia = {
	id: "file",
	modality: "file",
	name: "../../report.csv",
	mediaType: "text/csv",
	source: { type: "base64", data: "YSxiCg==" },
};
beforeEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
	vi.mocked(Sharing.shareAsync).mockResolvedValue();
});

describe("generated file sharing", () => {
	it("shares validated bytes with a safe private filename and keeps them available to the recipient", async () => {
		const write = vi.spyOn(File.prototype, "write");
		const remove = vi.spyOn(File.prototype, "delete");
		await shareGeneratedFile(media);
		expect(write).toHaveBeenCalledWith("YSxiCg==", { encoding: "base64" });
		expect(Sharing.shareAsync).toHaveBeenCalledWith(
			expect.stringMatching(
				/^file:\/\/\/cache\/shared-generated-files\/[^/]+\/report\.csv$/,
			),
			expect.objectContaining({ mimeType: "text/csv" }),
		);
		expect(remove).not.toHaveBeenCalled();
	});
	it("does not write malformed base64, oversized content, or remote references", async () => {
		const write = vi.spyOn(File.prototype, "write");
		for (const source of [
			{ type: "base64", data: "not-base64!" },
			{ type: "base64", data: "AAAA".repeat(3 * 1024 * 1024) },
			{ type: "url", url: "https://example.com/file.csv" },
		] as const) {
			await expect(shareGeneratedFile({ ...media, source })).rejects.toThrow();
		}
		expect(write).not.toHaveBeenCalled();
		expect(Sharing.shareAsync).not.toHaveBeenCalled();
	});
	it("cleans up after a failed native share and exposes a retryable action", async () => {
		const remove = vi.spyOn(Directory.prototype, "delete");
		vi.mocked(Sharing.shareAsync).mockRejectedValueOnce(
			new Error("Share failed. Try again."),
		);
		const { root } = render(<GeneratedFile media={media} />);
		const press = () =>
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === "Save or share file",
				)[0]!
				.props.onPress();
		await act(async () => {
			press();
		});
		expect(remove).toHaveBeenCalledOnce();
		expect(
			root.findAll((node) => node.props.accessibilityRole === "alert").length,
		).toBeGreaterThan(0);
		await act(async () => {
			press();
		});
		expect(Sharing.shareAsync).toHaveBeenCalledTimes(2);
	});
	it("keeps the cache until sharing finishes and deduplicates rapid taps", async () => {
		let finish!: () => void;
		vi.mocked(Sharing.shareAsync).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const remove = vi.spyOn(File.prototype, "delete");
		const { root } = render(<GeneratedFile media={media} />);
		const button = root.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === "Save or share file",
		)[0]!;
		await act(async () => {
			button.props.onPress();
			button.props.onPress();
		});
		expect(Sharing.shareAsync).toHaveBeenCalledOnce();
		expect(remove).not.toHaveBeenCalled();
		await act(async () => {
			finish();
		});
		expect(remove).not.toHaveBeenCalled();
	});
	it("prunes expired shares while retaining recent recipient files and bounding cache bytes", async () => {
		const expired = new File(
			"file:///cache",
			`${Date.now() - 25 * 60 * 60 * 1000}-old.csv`,
		);
		const recent = new File("file:///cache", `${Date.now()}-recent.csv`);
		const removeExpired = vi.spyOn(expired, "delete");
		const removeRecent = vi.spyOn(recent, "delete");
		vi.spyOn(Directory.prototype, "list").mockReturnValue([expired, recent]);
		await shareGeneratedFile(media);
		expect(removeExpired).toHaveBeenCalledOnce();
		expect(removeRecent).not.toHaveBeenCalled();
		Object.defineProperty(recent, "size", { value: 64 * 1024 * 1024 });
		await expect(shareGeneratedFile(media)).rejects.toThrow("cache is full");
	});
	it("bounds and expires files in unique share directories as well as legacy cache files", async () => {
		const expired = new Directory(
			"file:///cache",
			`${Date.now() - 25 * 60 * 60 * 1000}-old`,
		);
		const recent = new Directory("file:///cache", `${Date.now()}-recent`);
		const recipient = new File(recent, "report.csv");
		const removeExpired = vi.spyOn(expired, "delete");
		const removeRecent = vi.spyOn(recent, "delete");
		vi.spyOn(Directory.prototype, "list").mockImplementation(function (
			this: Directory,
		) {
			if (this === recent) return [recipient];
			return [expired, recent];
		});
		await shareGeneratedFile(media);
		expect(removeExpired).toHaveBeenCalledOnce();
		expect(removeRecent).not.toHaveBeenCalled();
		Object.defineProperty(recipient, "size", { value: 64 * 1024 * 1024 });
		await expect(shareGeneratedFile(media)).rejects.toThrow("cache is full");
	});
	it("reports unavailable sharing without writing a file", async () => {
		vi.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
		const write = vi.spyOn(File.prototype, "write");
		await expect(shareGeneratedFile(media)).rejects.toThrow("not available");
		expect(write).not.toHaveBeenCalled();
	});
});
