import { afterEach, expect, it, vi } from "vitest";
import { fetchArtifact } from "./fetch";

afterEach(() => vi.unstubAllGlobals());

const identity = {
	cloudSessionId: "session/one",
	artifactId: "reports/résumé #1?.bin",
};
const path =
	"/api/v1/session/session%2Fone/artifacts/download-url?name=reports%2Fr%C3%A9sum%C3%A9%20%231%3F.bin";
const signedUrl = "https://storage.example/file?signature=synthetic";
function authorized(url = signedUrl) {
	return Response.json({ success: true, data: { url } });
}

it("returns the original byte stream without forwarding API credentials", async () => {
	const bytes = new Uint8Array([0, 127, 128, 255]);
	const stored = new Response(bytes, {
		headers: { "Content-Type": "application/octet-stream" },
	});
	const storage = vi.fn(async () => stored);
	vi.stubGlobal("fetch", storage);
	const request = vi.fn(async () => authorized());
	const controller = new AbortController();
	const result = await fetchArtifact({
		...identity,
		request,
		signal: controller.signal,
	});
	expect(request).toHaveBeenCalledExactlyOnceWith(path, {
		method: "GET",
		redirect: "error",
		cache: "no-store",
		signal: expect.any(AbortSignal),
	});
	expect(storage).toHaveBeenCalledExactlyOnceWith(signedUrl, {
		method: "GET",
		credentials: "omit",
		redirect: "error",
		cache: "no-store",
		signal: controller.signal,
	});
	expect(result).toBe(stored);
	expect(result.bodyUsed).toBe(false);
	expect(new Uint8Array(await result.arrayBuffer())).toEqual(bytes);
});

it("authorizes each retrieval instead of caching a signed URL", async () => {
	const request = vi
		.fn()
		.mockResolvedValueOnce(authorized(`${signedUrl}-first`))
		.mockResolvedValueOnce(authorized(`${signedUrl}-second`));
	const storage = vi.fn(
		async (_url: string | URL | Request) => new Response("file"),
	);
	vi.stubGlobal("fetch", storage);
	for (let i = 0; i < 2; i++) {
		const result = await fetchArtifact({ ...identity, request });
		await result.body?.cancel();
	}
	expect(request).toHaveBeenCalledTimes(2);
	expect(storage.mock.calls.map(([url]) => url)).toEqual([
		`${signedUrl}-first`,
		`${signedUrl}-second`,
	]);
});

it("discards an expired response and obtains a fresh URL once", async () => {
	const cancel = vi.fn();
	const expired = new Response(new ReadableStream({ cancel }), { status: 403 });
	const request = vi
		.fn()
		.mockResolvedValueOnce(authorized(`${signedUrl}-expired`))
		.mockImplementationOnce(async () => {
			expect(cancel).toHaveBeenCalledOnce();
			return authorized(`${signedUrl}-fresh`);
		});
	const storage = vi
		.fn()
		.mockResolvedValueOnce(expired)
		.mockResolvedValueOnce(new Response("file"));
	vi.stubGlobal("fetch", storage);
	const result = await fetchArtifact({ ...identity, request });
	expect(await result.text()).toBe("file");
	expect(request).toHaveBeenCalledTimes(2);
	expect(storage).toHaveBeenLastCalledWith(
		`${signedUrl}-fresh`,
		expect.any(Object),
	);
});

it("does not fetch storage when session access is denied", async () => {
	const storage = vi.fn();
	vi.stubGlobal("fetch", storage);
	const request = vi.fn(async () => new Response(null, { status: 403 }));
	await expect(fetchArtifact({ ...identity, request })).rejects.toThrow(
		"Artifact service returned HTTP 403",
	);
	expect(request).toHaveBeenCalledOnce();
	expect(storage).not.toHaveBeenCalled();
});

it.each([403, 404])("bounds retries for storage HTTP %i", async (status) => {
	const request = vi.fn(async () => authorized());
	const storage = vi.fn(async () => new Response(null, { status }));
	vi.stubGlobal("fetch", storage);
	await expect(fetchArtifact({ ...identity, request })).rejects.toThrow(
		`Artifact download returned HTTP ${status}`,
	);
	expect(request).toHaveBeenCalledTimes(status === 403 ? 2 : 1);
	expect(storage).toHaveBeenCalledTimes(status === 403 ? 2 : 1);
});

it.each([
	{ success: true, data: { url: "http://storage.example/file" } },
	{
		success: true,
		data: { url: "https://user:password@storage.example/file" },
	},
	{ success: true, data: {} },
	{ success: false, data: { url: signedUrl } },
])("rejects invalid authorization responses before fetching storage", async (body) => {
	const storage = vi.fn();
	vi.stubGlobal("fetch", storage);
	await expect(
		fetchArtifact({ ...identity, request: async () => Response.json(body) }),
	).rejects.toThrow("Artifact service returned an invalid download URL");
	expect(storage).not.toHaveBeenCalled();
});

it("stops before storage if cancelled during authorization", async () => {
	const controller = new AbortController();
	const storage = vi.fn();
	vi.stubGlobal("fetch", storage);
	const request = vi.fn(async (_path: string, init: RequestInit) => {
		controller.abort(new Error("Run stopped"));
		expect(init.signal?.aborted).toBe(true);
		return authorized();
	});
	await expect(
		fetchArtifact({ ...identity, request, signal: controller.signal }),
	).rejects.toThrow("Run stopped");
	expect(storage).not.toHaveBeenCalled();
});
