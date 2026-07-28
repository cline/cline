import { describe, expect, it, vi } from "vitest";
import {
	isLoopbackHttpUrl,
	LocalSttError,
	transcribeAudioBlob,
} from "./transcribeAudioBlob";

describe("isLoopbackHttpUrl", () => {
	it("accepts localhost http", () => {
		expect(isLoopbackHttpUrl("http://127.0.0.1:8080/v1")).toBe(true);
		expect(isLoopbackHttpUrl("http://localhost:9000")).toBe(true);
	});

	it("rejects remote hosts", () => {
		expect(isLoopbackHttpUrl("https://api.openai.com/v1")).toBe(false);
	});
});

describe("transcribeAudioBlob", () => {
	it("posts to local whisper-compatible endpoint", async () => {
		const fetchImpl = vi.fn(async () => {
			return new Response(JSON.stringify({ text: " fix the flaky test " }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;

		const text = await transcribeAudioBlob({
			blob: new Blob(["audio"], { type: "audio/webm" }),
			backend: { kind: "local-worker", engine: "whisper-cpp" },
			config: { baseUrl: "http://127.0.0.1:8080/v1" },
			fetchImpl,
		});

		expect(text).toBe("fix the flaky test");
		expect(fetchImpl).toHaveBeenCalledOnce();
		const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(url).toBe("http://127.0.0.1:8080/v1/audio/transcriptions");
		expect(init.method).toBe("POST");
	});

	it("rejects non-loopback baseUrl for local-worker", async () => {
		await expect(
			transcribeAudioBlob({
				blob: new Blob(["audio"]),
				backend: { kind: "local-worker", engine: "whisper-cpp" },
				config: { baseUrl: "https://api.openai.com/v1" },
			}),
		).rejects.toBeInstanceOf(LocalSttError);
	});
});
