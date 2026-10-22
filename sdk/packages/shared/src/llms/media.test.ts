import { describe, expect, it } from "vitest";
import {
	createMediaBudgetState,
	GeneratedMediaSchema,
	imageBase64DecodedByteLength,
	imageBase64LengthForDecodedBytes,
	isCanonicalBase64,
	validateAndReserveBase64Media,
	validateAndReserveImageMedia,
	validateImageMedia,
} from "./media";

describe("generated media", () => {
	it("validates stable inline, remote, and artifact sources", () => {
		expect(
			GeneratedMediaSchema.parse({
				id: "media_inline",
				modality: "image",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
				sizeBytes: 5,
			}),
		).toMatchObject({ source: { type: "base64" } });
		expect(
			GeneratedMediaSchema.parse({
				id: "media_remote",
				modality: "audio",
				mediaType: "audio/mpeg",
				source: { type: "url", url: "https://example.com/result.mp3" },
			}),
		).toMatchObject({ source: { type: "url" } });
		expect(
			GeneratedMediaSchema.parse({
				id: "media_artifact",
				modality: "video",
				mediaType: "video/mp4",
				source: { type: "artifact", artifactId: "artifact_123" },
			}),
		).toMatchObject({ source: { type: "artifact" } });
	});

	it("rejects unsafe remote sources", () => {
		expect(
			GeneratedMediaSchema.safeParse({
				id: "unsafe",
				modality: "file",
				mediaType: "text/html",
				source: { type: "url", url: "javascript:alert(1)" },
			}).success,
		).toBe(false);
	});

	it("rejects media whose modality disagrees with its MIME type", () => {
		expect(
			GeneratedMediaSchema.safeParse({
				id: "mismatch",
				modality: "audio",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
			}).success,
		).toBe(false);
	});
});

describe("media validation", () => {
	it("accepts raw canonical base64 for supported image types", () => {
		const result = validateImageMedia("image/png", "aGVsbG8=");

		expect(result).toMatchObject({
			ok: true,
			mediaType: "image/png",
			base64: "aGVsbG8=",
			encodedBytes: 8,
			decodedBytes: 5,
		});
	});

	it("accepts matching data URLs and returns raw base64", () => {
		const result = validateImageMedia(
			"image/png",
			"data:image/png;base64,aGVsbG8=",
		);

		expect(result).toMatchObject({
			ok: true,
			mediaType: "image/png",
			base64: "aGVsbG8=",
		});
	});

	it("accepts case-insensitive data URL schemes", () => {
		const result = validateImageMedia(
			"image/png",
			"DATA:image/png;base64,aGVsbG8=",
		);

		expect(result).toMatchObject({
			ok: true,
			mediaType: "image/png",
			base64: "aGVsbG8=",
		});
	});

	it("rejects MIME mismatches, unsupported types, malformed base64, and byte overflow", () => {
		expect(
			validateImageMedia("image/png", "data:image/jpeg;base64,/9j/"),
		).toMatchObject({ ok: false, reason: "media_type_mismatch" });
		expect(validateImageMedia("image/svg+xml", "PHN2Zz4=")).toMatchObject({
			ok: false,
			reason: "unsupported_media_type",
		});
		expect(validateImageMedia("image/png", "not-base64")).toMatchObject({
			ok: false,
			reason: "invalid_base64",
		});
		expect(
			validateImageMedia("image/png", "QUJDRA==", { maxEncodedBytes: 4 }),
		).toMatchObject({ ok: false, reason: "encoded_limit" });
		expect(
			validateImageMedia("image/png", "QUJDRA==", { maxDecodedBytes: 3 }),
		).toMatchObject({ ok: false, reason: "decoded_limit" });
	});

	it("rejects oversized encoded payloads before base64 syntax validation", () => {
		expect(
			validateImageMedia("image/png", "not-base64-and-too-long", {
				maxEncodedBytes: 4,
			}),
		).toMatchObject({ ok: false, reason: "encoded_limit" });
		expect(
			validateImageMedia("image/png", "data:image/png;base64,not-base64", {
				maxEncodedBytes: 4,
			}),
		).toMatchObject({ ok: false, reason: "encoded_limit" });
	});

	it("tracks aggregate media budget while reserving valid images", () => {
		const state = createMediaBudgetState();
		const first = validateAndReserveImageMedia(
			"image/png",
			"QUJDRA==",
			{ maxTotalMediaBytes: 8 },
			state,
		);
		const second = validateAndReserveImageMedia(
			"image/png",
			"QUJDRA==",
			{ maxTotalMediaBytes: 8 },
			state,
		);

		expect(first).toMatchObject({ ok: true });
		expect(second).toMatchObject({ ok: false, reason: "total_limit" });
		expect(state).toMatchObject({
			totalEncodedBytes: 8,
			keptImages: 1,
			omittedImages: 1,
			omittedReasons: { total_limit: 1 },
		});
	});

	it("computes decoded and encoded base64 sizes without decoding bytes", () => {
		expect(imageBase64DecodedByteLength("QUJDRA==")).toBe(4);
		expect(imageBase64LengthForDecodedBytes(4)).toBe(8);
	});

	it("checks canonical base64 strings without decoding bytes", () => {
		expect(isCanonicalBase64("QUJDRA==")).toBe(true);
		expect(isCanonicalBase64("not-base64")).toBe(false);
		expect(isCanonicalBase64("")).toBe(false);
	});

	it("validates non-image base64 and shares the aggregate media budget", () => {
		const state = createMediaBudgetState();
		const audio = validateAndReserveBase64Media(
			" aGVsbG8= ",
			{ maxTotalMediaBytes: 12 },
			state,
		);
		const video = validateAndReserveBase64Media(
			"QUJDRA==",
			{ maxTotalMediaBytes: 12 },
			state,
		);

		expect(audio).toEqual({
			ok: true,
			base64: "aGVsbG8=",
			encodedBytes: 8,
			decodedBytes: 5,
		});
		expect(video).toMatchObject({ ok: false, reason: "total_limit" });
		expect(state.totalEncodedBytes).toBe(8);
		expect(
			validateAndReserveBase64Media("not-base64", {}, state),
		).toMatchObject({ ok: false, reason: "invalid_base64" });
	});
});
