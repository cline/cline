import { afterEach, expect, it, vi } from "vitest";
import { createArtifactFetcher } from "./fetch";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const cloudSessionId = "session/one";
const artifactId = "reports/résumé #1?.bin";
const path =
	"/api/v1/session/session%2Fone/artifacts/download-url?name=reports%2Fr%C3%A9sum%C3%A9%20%231%3F.bin";
const signedUrl = "https://storage.example/file?signature=synthetic";
function authorized(url = signedUrl) {
	return Response.json({
		success: true,
		data: { url, expiresAt: new Date(Date.now() + 60_000).toISOString() },
	});
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
	const fetchArtifact = createArtifactFetcher({ request, cloudSessionId });
	const result = await fetchArtifact({ artifactId, signal: controller.signal });
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

it("reuses a valid URL but downloads the latest bytes each time", async () => {
	const request = vi.fn(async () => authorized());
	let contents = "first upload";
	const storage = vi.fn(async () => new Response(contents));
	vi.stubGlobal("fetch", storage);
	const fetchArtifact = createArtifactFetcher({ request, cloudSessionId });
	expect(await (await fetchArtifact({ artifactId })).text()).toBe(
		"first upload",
	);
	contents = "replacement upload";
	expect(await (await fetchArtifact({ artifactId })).text()).toBe(
		"replacement upload",
	);
	expect(request).toHaveBeenCalledOnce();
	expect(storage).toHaveBeenCalledTimes(2);
});

it("refreshes a cached URL before expiry", async () => {
	const now = Date.now();
	const clock = vi.spyOn(Date, "now").mockReturnValue(now);
	const request = vi.fn(async () => authorized());
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("file")),
	);
	const fetchArtifact = createArtifactFetcher({ request, cloudSessionId });
	await (await fetchArtifact({ artifactId })).text();
	clock.mockReturnValue(now + 30_000);
	await (await fetchArtifact({ artifactId })).text();
	expect(request).toHaveBeenCalledTimes(2);
});

it("does not remember a missing file before upload completes", async () => {
	const request = vi
		.fn()
		.mockResolvedValueOnce(new Response(null, { status: 404 }))
		.mockImplementation(async () => authorized());
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("uploaded")),
	);
	const fetchArtifact = createArtifactFetcher({ request, cloudSessionId });
	await expect(fetchArtifact({ artifactId })).rejects.toThrow("HTTP 404");
	expect(await (await fetchArtifact({ artifactId })).text()).toBe("uploaded");
	await (await fetchArtifact({ artifactId })).text();
	expect(request).toHaveBeenCalledTimes(2);
});

it("evicts a cached URL when storage no longer has the file", async () => {
	const request = vi.fn(async () => authorized());
	const storage = vi
		.fn()
		.mockResolvedValueOnce(new Response("original"))
		.mockResolvedValueOnce(new Response(null, { status: 404 }))
		.mockResolvedValueOnce(new Response("recreated"));
	vi.stubGlobal("fetch", storage);
	const fetchArtifact = createArtifactFetcher({ request, cloudSessionId });
	await (await fetchArtifact({ artifactId })).text();
	await expect(fetchArtifact({ artifactId })).rejects.toThrow("HTTP 404");
	expect(await (await fetchArtifact({ artifactId })).text()).toBe("recreated");
	expect(request).toHaveBeenCalledTimes(2);
});

it("keeps artifact and account/session caches separate", async () => {
	const request = vi.fn(async () => authorized());
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("file")),
	);
	const first = createArtifactFetcher({ request, cloudSessionId });
	const second = createArtifactFetcher({
		request,
		cloudSessionId: "another-session",
	});
	const newAccount = createArtifactFetcher({ request, cloudSessionId });
	await (await first({ artifactId })).text();
	await (await first({ artifactId: "another-file" })).text();
	await (await second({ artifactId })).text();
	await (await newAccount({ artifactId })).text();
	await (await first({ artifactId })).text();
	expect(request).toHaveBeenCalledTimes(4);
});

it("bounds the number of cached URLs", async () => {
	const request = vi.fn(async () => authorized());
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response("file")),
	);
	const fetchArtifact = createArtifactFetcher({ request, cloudSessionId });
	for (let id = 0; id < 129; id++)
		await (await fetchArtifact({ artifactId: String(id) })).text();
	await (await fetchArtifact({ artifactId: "0" })).text();
	expect(request).toHaveBeenCalledTimes(130);
});

it.each([
	false,
	true,
])("refreshes a cached URL after 403, even with broken cleanup (%s)", async (broken) => {
	const cancel = vi.fn();
	const expired = new Response(
		new ReadableStream({
			cancel,
			start(controller) {
				if (broken) controller.error(new Error("Response body interrupted"));
			},
		}),
		{ status: 403 },
	);
	const request = vi
		.fn()
		.mockResolvedValueOnce(authorized(`${signedUrl}-expired`))
		.mockImplementationOnce(async () => {
			if (!broken) expect(cancel).toHaveBeenCalledOnce();
			return authorized(`${signedUrl}-fresh`);
		});
	const storage = vi
		.fn()
		.mockResolvedValueOnce(new Response("original"))
		.mockResolvedValueOnce(expired)
		.mockResolvedValueOnce(new Response("file"));
	vi.stubGlobal("fetch", storage);
	const fetchArtifact = createArtifactFetcher({ request, cloudSessionId });
	await (await fetchArtifact({ artifactId })).text();
	const result = await fetchArtifact({ artifactId });
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
	const fetchArtifact = createArtifactFetcher({ request, cloudSessionId });
	await expect(fetchArtifact({ artifactId })).rejects.toThrow(
		"Artifact service returned HTTP 403",
	);
	expect(request).toHaveBeenCalledOnce();
	expect(storage).not.toHaveBeenCalled();
});

it.each([403, 404])("bounds retries for storage HTTP %i", async (status) => {
	const request = vi.fn(async () => authorized());
	const storage = vi.fn(async () => new Response(null, { status }));
	vi.stubGlobal("fetch", storage);
	const fetchArtifact = createArtifactFetcher({ request, cloudSessionId });
	await expect(fetchArtifact({ artifactId })).rejects.toThrow(
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
	{ success: true, data: { url: signedUrl, expiresAt: "invalid" } },
])("rejects invalid authorization responses before fetching storage", async (body) => {
	const storage = vi.fn();
	vi.stubGlobal("fetch", storage);
	await expect(
		createArtifactFetcher({
			cloudSessionId,
			request: async () =>
				Response.json({
					...body,
					data: {
						expiresAt: new Date(Date.now() + 60_000).toISOString(),
						...body.data,
					},
				}),
		})({ artifactId }),
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
		createArtifactFetcher({ request, cloudSessionId })({
			artifactId,
			signal: controller.signal,
		}),
	).rejects.toThrow("Run stopped");
	expect(storage).not.toHaveBeenCalled();
});
