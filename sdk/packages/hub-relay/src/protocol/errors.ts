import { RELAY_CLOSE_CODES, type RelayErrorCode } from "./frames";

/** A typed relay failure, surfaced to host and phone callers alike. */
export class RelayError extends Error {
	readonly code: RelayErrorCode;
	readonly closeCode: number;
	readonly channelId?: string;

	constructor(
		code: RelayErrorCode,
		message: string,
		options: { channelId?: string } = {},
	) {
		super(message);
		this.name = "RelayError";
		this.code = code;
		this.closeCode = RELAY_CLOSE_CODES[code];
		if (options.channelId) {
			this.channelId = options.channelId;
		}
	}
}

export function isRelayError(value: unknown): value is RelayError {
	return value instanceof RelayError;
}

const CLOSE_CODE_TO_ERROR = new Map<number, RelayErrorCode>(
	(Object.entries(RELAY_CLOSE_CODES) as [RelayErrorCode, number][]).map(
		([code, closeCode]) => [closeCode, code],
	),
);

/**
 * Best-effort reverse mapping for peers that only see a websocket close code
 * (the error frame can be lost if the relay closes in the same tick).
 */
export function relayErrorCodeForCloseCode(
	closeCode: number,
): RelayErrorCode | undefined {
	return CLOSE_CODE_TO_ERROR.get(closeCode);
}
