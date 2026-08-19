/** A single recorded HTTP interaction. */
export interface VcrRecording {
	scope: string;
	method: string;
	path: string;
	body?: string;
	/** Sanitized canonical request body used as an optional playback contract. */
	requestBody?: string;
	status: number;
	response: unknown;
	responseIsBinary: boolean;
	/** Content-Type header from the original response (captured at record time). */
	contentType?: string;
}
