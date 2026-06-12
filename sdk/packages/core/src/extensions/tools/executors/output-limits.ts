import type { ImageContent, TextContent } from "@cline/shared";
import type { ToolOperationResult } from "../types";

export const DEFAULT_MAX_INLINE_IMAGES_PER_TOOL_RESULT = 3;
export const DEFAULT_MAX_IMAGE_PAYLOAD_BYTES_PER_TOOL_RESULT = 512 * 1024;

interface LimitReadFilesImageOptions {
	maxInlineImages: number;
	maxImagePayloadBytes: number;
}

interface ImageDimensions {
	width: number;
	height: number;
}

export function limitReadFilesToolOperationImages(
	operations: ToolOperationResult[],
	options: LimitReadFilesImageOptions,
): ToolOperationResult[] {
	const maxInlineImages = normalizeLimit(options.maxInlineImages);
	const maxImagePayloadBytes = normalizeLimit(options.maxImagePayloadBytes);
	let inlineImages = 0;
	let imagePayloadBytes = 0;
	let changed = false;

	const next = operations.map((operation) => {
		if (!operation.success || !Array.isArray(operation.result)) {
			return operation;
		}

		let omittedImage = false;
		const result: unknown[] = [];
		for (const item of operation.result) {
			if (!isImageContent(item)) {
				result.push(item);
				continue;
			}

			const payloadBytes = imagePayloadByteLength(item);
			if (
				inlineImages < maxInlineImages &&
				imagePayloadBytes + payloadBytes <= maxImagePayloadBytes
			) {
				inlineImages += 1;
				imagePayloadBytes += payloadBytes;
				result.push(item);
				continue;
			}

			omittedImage = true;
			changed = true;
			result.push(imageOmittedTextBlock(item, operation.query));
		}

		if (!omittedImage) {
			return operation;
		}

		return {
			...operation,
			result: result.filter(
				(item) =>
					!(
						isTextContent(item) &&
						item.text.trim() === "Successfully read image"
					),
			),
		};
	});

	return changed ? next : operations;
}

export function imagePayloadByteLength(
	image: Pick<ImageContent, "data">,
): number {
	return Buffer.byteLength(image.data, "utf8");
}

function imageOmittedTextBlock(
	image: ImageContent,
	filePath: string,
): TextContent {
	const bytes = Buffer.from(image.data, "base64");
	const lines = [
		"Image omitted due to budget.",
		`Path: ${filePath}`,
		`Media type: ${image.mediaType}`,
		`Byte size: ${bytes.byteLength}`,
	];
	const dimensions = getImageDimensions(bytes, image.mediaType);
	if (dimensions) {
		lines.push(`Dimensions: ${dimensions.width}x${dimensions.height}`);
	}
	return { type: "text", text: lines.join("\n") };
}

function isImageContent(value: unknown): value is ImageContent {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.type === "image" &&
		typeof record.data === "string" &&
		typeof record.mediaType === "string"
	);
}

function isTextContent(value: unknown): value is TextContent {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return record.type === "text" && typeof record.text === "string";
}

function normalizeLimit(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function getImageDimensions(
	buffer: Buffer,
	mediaType: string,
): ImageDimensions | undefined {
	if (mediaType === "image/png" && isPng(buffer)) {
		return {
			width: buffer.readUInt32BE(16),
			height: buffer.readUInt32BE(20),
		};
	}
	if (mediaType === "image/gif" && isGif(buffer)) {
		return {
			width: buffer.readUInt16LE(6),
			height: buffer.readUInt16LE(8),
		};
	}
	if (mediaType === "image/jpeg") {
		return getJpegDimensions(buffer);
	}
	if (mediaType === "image/webp") {
		return getWebpDimensions(buffer);
	}
	return undefined;
}

function isPng(buffer: Buffer): boolean {
	return (
		buffer.length >= 24 &&
		buffer.readUInt32BE(0) === 0x89504e47 &&
		buffer.readUInt32BE(4) === 0x0d0a1a0a
	);
}

function isGif(buffer: Buffer): boolean {
	return (
		buffer.length >= 10 &&
		(buffer.toString("ascii", 0, 6) === "GIF87a" ||
			buffer.toString("ascii", 0, 6) === "GIF89a")
	);
}

function getJpegDimensions(buffer: Buffer): ImageDimensions | undefined {
	if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
		return undefined;
	}

	let offset = 2;
	while (offset + 9 < buffer.length) {
		if (buffer[offset] !== 0xff) {
			offset += 1;
			continue;
		}

		const marker = buffer[offset + 1];
		offset += 2;
		if (marker === 0xd9 || marker === 0xda || offset + 2 > buffer.length) {
			break;
		}
		const segmentLength = buffer.readUInt16BE(offset);
		if (segmentLength < 2 || offset + segmentLength > buffer.length) {
			break;
		}
		if (isJpegStartOfFrame(marker) && segmentLength >= 7) {
			return {
				height: buffer.readUInt16BE(offset + 3),
				width: buffer.readUInt16BE(offset + 5),
			};
		}
		offset += segmentLength;
	}
	return undefined;
}

function isJpegStartOfFrame(marker: number): boolean {
	return (
		(marker >= 0xc0 && marker <= 0xc3) ||
		(marker >= 0xc5 && marker <= 0xc7) ||
		(marker >= 0xc9 && marker <= 0xcb) ||
		(marker >= 0xcd && marker <= 0xcf)
	);
}

function getWebpDimensions(buffer: Buffer): ImageDimensions | undefined {
	if (
		buffer.length < 30 ||
		buffer.toString("ascii", 0, 4) !== "RIFF" ||
		buffer.toString("ascii", 8, 12) !== "WEBP"
	) {
		return undefined;
	}

	const chunkType = buffer.toString("ascii", 12, 16);
	if (chunkType === "VP8X") {
		return {
			width: 1 + buffer.readUIntLE(24, 3),
			height: 1 + buffer.readUIntLE(27, 3),
		};
	}
	if (chunkType === "VP8 ") {
		return {
			width: buffer.readUInt16LE(26) & 0x3fff,
			height: buffer.readUInt16LE(28) & 0x3fff,
		};
	}
	if (chunkType === "VP8L" && buffer[20] === 0x2f) {
		const bits = buffer.readUInt32LE(21);
		return {
			width: (bits & 0x3fff) + 1,
			height: ((bits >> 14) & 0x3fff) + 1,
		};
	}
	return undefined;
}
