export const IMAGE_OMITTED_PLACEHOLDER =
	"[media omitted: invalid or exceeds size limit]";

export const SUPPORTED_IMAGE_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
] as const;

export const DEFAULT_MAX_IMAGE_BASE64_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_IMAGE_ENCODED_BYTES = DEFAULT_MAX_IMAGE_BASE64_BYTES;
export const DEFAULT_MAX_IMAGE_DECODED_BYTES = 6 * 1024 * 1024;
export const DEFAULT_MAX_TOTAL_MEDIA_BYTES = 8 * 1024 * 1024;

export interface ImageMediaLimits {
	maxEncodedBytes?: number;
	maxDecodedBytes?: number;
	supportedMediaTypes?: readonly string[];
}

export interface ImageMediaValidationSuccess {
	ok: true;
	mediaType: string;
	base64: string;
	encodedBytes: number;
	decodedBytes: number;
}

export interface ImageMediaValidationFailure {
	ok: false;
	reason:
		| "unsupported_media_type"
		| "media_type_mismatch"
		| "invalid_base64"
		| "encoded_limit"
		| "decoded_limit"
		| "total_limit";
	message: string;
}

export type ImageMediaValidationResult =
	| ImageMediaValidationSuccess
	| ImageMediaValidationFailure;

export interface MediaBudgetOptions {
	maxImageEncodedBytes?: number;
	maxImageDecodedBytes?: number;
	maxTotalMediaBytes?: number;
}

export interface ResolvedMediaBudget {
	maxImageEncodedBytes: number;
	maxImageDecodedBytes: number;
	maxTotalMediaBytes: number;
}

export interface MediaBudgetState {
	totalEncodedBytes: number;
	keptImages: number;
	omittedImages: number;
	omittedReasons: Partial<
		Record<ImageMediaValidationFailure["reason"], number>
	>;
}

export function imageBase64EncodedByteLength(base64: string): number {
	return base64.length;
}

export function imageBase64DecodedByteLength(base64: string): number {
	const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
	return Math.floor((base64.length * 3) / 4) - padding;
}

export function imageFileMaxDecodedBytesForBase64Limit(
	maxBase64Bytes = DEFAULT_MAX_IMAGE_BASE64_BYTES,
): number {
	return Math.floor((maxBase64Bytes * 3) / 4);
}

export function imageBase64LengthForDecodedBytes(decodedBytes: number): number {
	return Math.ceil(decodedBytes / 3) * 4;
}

export function resolveMediaBudget(
	options: MediaBudgetOptions = {},
): ResolvedMediaBudget {
	return {
		maxImageEncodedBytes:
			options.maxImageEncodedBytes ?? DEFAULT_MAX_IMAGE_ENCODED_BYTES,
		maxImageDecodedBytes:
			options.maxImageDecodedBytes ?? DEFAULT_MAX_IMAGE_DECODED_BYTES,
		maxTotalMediaBytes:
			options.maxTotalMediaBytes ?? DEFAULT_MAX_TOTAL_MEDIA_BYTES,
	};
}

export function createMediaBudgetState(): MediaBudgetState {
	return {
		totalEncodedBytes: 0,
		keptImages: 0,
		omittedImages: 0,
		omittedReasons: {},
	};
}

function recordOmittedImage(
	state: MediaBudgetState,
	reason: ImageMediaValidationFailure["reason"],
): void {
	state.omittedImages += 1;
	state.omittedReasons[reason] = (state.omittedReasons[reason] ?? 0) + 1;
}

export function reserveImageMediaBytes(
	encodedBytes: number,
	decodedBytes: number,
	budget: MediaBudgetOptions,
	state: MediaBudgetState,
): ImageMediaValidationFailure | null {
	const resolved = resolveMediaBudget(budget);
	if (encodedBytes > resolved.maxImageEncodedBytes) {
		const failure: ImageMediaValidationFailure = {
			ok: false,
			reason: "encoded_limit",
			message: `Image media exceeds the ${resolved.maxImageEncodedBytes} byte encoded limit`,
		};
		recordOmittedImage(state, failure.reason);
		return failure;
	}
	if (decodedBytes > resolved.maxImageDecodedBytes) {
		const failure: ImageMediaValidationFailure = {
			ok: false,
			reason: "decoded_limit",
			message: `Image media exceeds the ${resolved.maxImageDecodedBytes} byte decoded limit`,
		};
		recordOmittedImage(state, failure.reason);
		return failure;
	}
	if (state.totalEncodedBytes + encodedBytes > resolved.maxTotalMediaBytes) {
		const failure: ImageMediaValidationFailure = {
			ok: false,
			reason: "total_limit",
			message: `Image media exceeds the ${resolved.maxTotalMediaBytes} byte total media limit`,
		};
		recordOmittedImage(state, failure.reason);
		return failure;
	}

	state.totalEncodedBytes += encodedBytes;
	state.keptImages += 1;
	return null;
}

export function isBase64Char(charCode: number): boolean {
	return (
		(charCode >= 65 && charCode <= 90) ||
		(charCode >= 97 && charCode <= 122) ||
		(charCode >= 48 && charCode <= 57) ||
		charCode === 43 ||
		charCode === 47
	);
}

export function isCanonicalBase64(base64: string): boolean {
	return base64.length > 0 && isCanonicalBase64Range(base64, 0, base64.length);
}

function isCanonicalBase64Range(
	base64: string,
	start: number,
	end: number,
): boolean {
	const length = end - start;
	if (length % 4 !== 0) {
		return false;
	}

	let paddingStart = end;
	if (
		length >= 2 &&
		base64.charCodeAt(end - 2) === 61 &&
		base64.charCodeAt(end - 1) === 61
	) {
		paddingStart -= 2;
	} else if (length >= 1 && base64.charCodeAt(end - 1) === 61) {
		paddingStart -= 1;
	}

	for (let i = start; i < paddingStart; i++) {
		if (!isBase64Char(base64.charCodeAt(i))) {
			return false;
		}
	}
	for (let i = paddingStart; i < end; i++) {
		if (base64.charCodeAt(i) !== 61) {
			return false;
		}
	}
	return true;
}

function startsWithDataScheme(
	data: string,
	start: number,
	end: number,
): boolean {
	return (
		end - start >= 5 &&
		(data.charCodeAt(start) | 32) === 100 &&
		(data.charCodeAt(start + 1) | 32) === 97 &&
		(data.charCodeAt(start + 2) | 32) === 116 &&
		(data.charCodeAt(start + 3) | 32) === 97 &&
		data.charCodeAt(start + 4) === 58
	);
}

function trimmedRange(data: string): { start: number; end: number } {
	let start = 0;
	let end = data.length;
	while (start < end && /\s/.test(data[start] ?? "")) {
		start += 1;
	}
	while (end > start && /\s/.test(data[end - 1] ?? "")) {
		end -= 1;
	}
	return { start, end };
}

function parseBase64DataUrlRange(
	data: string,
	start: number,
	end: number,
):
	| {
			mediaType: string;
			base64Start: number;
			base64End: number;
	  }
	| undefined {
	if (!startsWithDataScheme(data, start, end)) {
		return undefined;
	}
	const metadataStart = start + "data:".length;
	const commaIndex = data.indexOf(",", metadataStart);
	if (commaIndex === -1 || commaIndex >= end) {
		return undefined;
	}
	if (commaIndex - metadataStart > 128) {
		return undefined;
	}
	const metadata = data.slice(metadataStart, commaIndex).toLowerCase();
	const base64Marker = ";base64";
	if (!metadata.endsWith(base64Marker)) {
		return undefined;
	}
	const mediaType = metadata.slice(0, -base64Marker.length);
	if (!mediaType || mediaType.includes(";")) {
		return undefined;
	}
	return {
		mediaType,
		base64Start: commaIndex + 1,
		base64End: end,
	};
}

export function validateImageMedia(
	mediaType: string | undefined,
	data: string,
	limits: ImageMediaLimits = {},
): ImageMediaValidationResult {
	const maxEncodedBytes =
		limits.maxEncodedBytes ?? DEFAULT_MAX_IMAGE_ENCODED_BYTES;
	const maxDecodedBytes =
		limits.maxDecodedBytes ?? DEFAULT_MAX_IMAGE_DECODED_BYTES;
	const supportedMediaTypes = new Set(
		limits.supportedMediaTypes ?? SUPPORTED_IMAGE_MEDIA_TYPES,
	);

	let effectiveMediaType = mediaType?.toLowerCase();
	const range = trimmedRange(data);
	let base64Start = range.start;
	let base64End = range.end;
	const dataUrl = parseBase64DataUrlRange(data, range.start, range.end);
	if (dataUrl) {
		if (effectiveMediaType && effectiveMediaType !== dataUrl.mediaType) {
			return {
				ok: false,
				reason: "media_type_mismatch",
				message: `Image media type ${mediaType} does not match data URL type ${dataUrl.mediaType}`,
			};
		}
		effectiveMediaType = dataUrl.mediaType;
		base64Start = dataUrl.base64Start;
		base64End = dataUrl.base64End;
	}

	if (!effectiveMediaType || !supportedMediaTypes.has(effectiveMediaType)) {
		return {
			ok: false,
			reason: "unsupported_media_type",
			message: `Unsupported image media type: ${mediaType ?? "unknown"}`,
		};
	}

	const encodedBytes = base64End - base64Start;
	if (encodedBytes === 0) {
		return {
			ok: false,
			reason: "invalid_base64",
			message: "Image media must contain valid base64",
		};
	}

	if (encodedBytes > maxEncodedBytes) {
		return {
			ok: false,
			reason: "encoded_limit",
			message: `Image media exceeds the ${maxEncodedBytes} byte encoded limit`,
		};
	}

	if (!isCanonicalBase64Range(data, base64Start, base64End)) {
		return {
			ok: false,
			reason: "invalid_base64",
			message: "Image media must contain valid base64",
		};
	}

	const base64 = data.slice(base64Start, base64End);
	const decodedBytes = imageBase64DecodedByteLength(base64);
	if (decodedBytes > maxDecodedBytes) {
		return {
			ok: false,
			reason: "decoded_limit",
			message: `Image media exceeds the ${maxDecodedBytes} byte decoded limit`,
		};
	}

	return {
		ok: true,
		mediaType: effectiveMediaType,
		base64,
		encodedBytes,
		decodedBytes,
	};
}

export function validateAndReserveImageMedia(
	mediaType: string | undefined,
	data: string,
	budget: MediaBudgetOptions,
	state: MediaBudgetState,
): ImageMediaValidationResult {
	const validation = validateImageMedia(mediaType, data, {
		maxEncodedBytes: budget.maxImageEncodedBytes,
		maxDecodedBytes: budget.maxImageDecodedBytes,
	});
	if (!validation.ok) {
		recordOmittedImage(state, validation.reason);
		return validation;
	}

	const failure = reserveImageMediaBytes(
		validation.encodedBytes,
		validation.decodedBytes,
		budget,
		state,
	);
	if (failure) {
		return failure;
	}

	return validation;
}
