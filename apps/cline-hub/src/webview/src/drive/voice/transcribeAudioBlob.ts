import type { SttBackend } from "@cline/shared";

export class LocalSttError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "LocalSttError";
		this.code = code;
	}
}

/**
 * Transcribe a MediaRecorder blob for non–Web-Speech STT backends.
 * Local default: OpenAI-compatible `/v1/audio/transcriptions` on a loopback
 * whisper server (e.g. whisper.cpp server, faster-whisper).
 */
export async function transcribeAudioBlob(input: {
	blob: Blob;
	backend: SttBackend;
	config?: Record<string, unknown>;
	fetchImpl?: typeof fetch;
}): Promise<string> {
	const { backend, blob } = input;
	const fetchImpl = input.fetchImpl ?? fetch;
	const config = input.config ?? {};

	switch (backend.kind) {
		case "webSpeech":
			throw new LocalSttError(
				"wrong_backend",
				"Web Speech does not use MediaRecorder blobs.",
			);
		case "local-worker":
			return await transcribeViaOpenAiCompatible(blob, config, fetchImpl, true);
		case "cloud-api":
			return await transcribeViaOpenAiCompatible(blob, config, fetchImpl, false);
		default: {
			const _exhaustive: never = backend;
			return _exhaustive;
		}
	}
}

async function transcribeViaOpenAiCompatible(
	blob: Blob,
	config: Record<string, unknown>,
	fetchImpl: typeof fetch,
	requireLoopback: boolean,
): Promise<string> {
	const baseUrl =
		typeof config.baseUrl === "string" && config.baseUrl.trim()
			? config.baseUrl.trim().replace(/\/+$/, "")
			: "http://127.0.0.1:8080/v1";
	const model =
		typeof config.model === "string" && config.model.trim()
			? config.model.trim()
			: "whisper-1";

	if (requireLoopback && !isLoopbackHttpUrl(baseUrl)) {
		throw new LocalSttError(
			"non_loopback_stt",
			`Local STT baseUrl must be loopback. Got ${baseUrl}`,
		);
	}

	const form = new FormData();
	form.append("file", blob, "utterance.webm");
	form.append("model", model);

	// Do not read apiKey from Drive facet config (secrets stay out of .cline/drive).
	let response: Response;
	try {
		response = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
			method: "POST",
			body: form,
		});
	} catch (error) {
		throw new LocalSttError(
			"stt_unreachable",
			`STT server unreachable at ${baseUrl}. Start a local whisper server or set providers.sttConfig.baseUrl. (${String(error)})`,
		);
	}

	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new LocalSttError(
			"stt_http_error",
			`STT server returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
		);
	}

	const contentType = response.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const json = (await response.json()) as { text?: unknown };
		if (typeof json.text === "string" && json.text.trim()) {
			return json.text.trim();
		}
		throw new LocalSttError("stt_empty", "STT server returned empty text.");
	}

	const text = (await response.text()).trim();
	if (!text) {
		throw new LocalSttError("stt_empty", "STT server returned empty text.");
	}
	return text;
}

export function isLoopbackHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return false;
		}
		const host = parsed.hostname.toLowerCase();
		return (
			host === "127.0.0.1" ||
			host === "localhost" ||
			host === "::1" ||
			host === "[::1]"
		);
	} catch {
		return false;
	}
}
