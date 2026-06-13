import { describe, expect, it } from "vitest";
import {
	createMediaBudgetState,
	imageBase64DecodedByteLength,
	imageBase64LengthForDecodedBytes,
	validateAndReserveImageMedia,
	validateImageMedia,
} from "./media";

describe("image media validation", () => {
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
});
