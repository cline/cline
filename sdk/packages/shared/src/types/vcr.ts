/** A single recorded HTTP interaction (nock-compatible shape). */
export interface VcrRecording {
	scope: string;
	method: string;
	path: string;
	body?: string;
	status: number;
	response: unknown;
	responseIsBinary: boolean;
	/** Content-Type header from the original response (captured at record time). */
	contentType?: string;
}
