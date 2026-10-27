// @vitest-environment jsdom

import type { GeneratedMedia } from "@cline/shared/browser";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CloudArtifactImage } from "./cloud-artifact-image";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	user: { id: "account-one" },
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
}));
vi.mock("@/contexts/account-context", () => ({
	useAccount: () => ({ user: mocks.user }),
}));

const media: GeneratedMedia = {
	id: "image-one",
	modality: "image",
	mediaType: "image/png",
	name: "Completed form",
	source: { type: "artifact", artifactId: "frame-one" },
};
const download = {
	url: "https://storage.example/image.png?signature=first",
	expiresAt: "2030-01-01T00:00:00Z",
};
let container: HTMLDivElement;
let root: Root;
let reveal: () => void;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	mocks.user = { id: "account-one" };
	mocks.invoke.mockReset().mockResolvedValue(download);
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
				reveal = () => callback([{ isIntersecting: true }]);
			}
			observe() {}
			disconnect() {}
		},
	);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
async function render(sessionId = "ses-one") {
	await act(async () =>
		root.render(<CloudArtifactImage media={media} sessionId={sessionId} />),
	);
}

it("loads visible artifacts directly, preserves the reference, and resolves again on reopening", async () => {
	await render();
	expect(mocks.invoke).not.toHaveBeenCalled();
	await act(async () => reveal());
	expect(mocks.invoke).toHaveBeenCalledWith("get_cloud_artifact_url", {
		sessionId: "ses-one",
		artifactId: "frame-one",
	});
	expect(container.querySelector("img")?.src).toBe(download.url);
	expect(container.querySelector("img")?.getAttribute("referrerpolicy")).toBe(
		"no-referrer",
	);
	expect(media.source).toEqual({ type: "artifact", artifactId: "frame-one" });
	await act(async () => root.render(null));
	await render();
	await act(async () => reveal());
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
});

it("refreshes an expired image URL once and offers an explicit retry after another failure", async () => {
	const now = Date.parse("2029-01-01T00:00:00Z");
	const clock = vi.spyOn(Date, "now").mockReturnValue(now);
	mocks.invoke.mockResolvedValueOnce({
		...download,
		expiresAt: new Date(now + 1000).toISOString(),
	});
	await render();
	await act(async () => reveal());
	clock.mockReturnValue(now + 2000);
	await act(async () =>
		container.querySelector("img")?.dispatchEvent(new Event("error")),
	);
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
	await act(async () =>
		container.querySelector("img")?.dispatchEvent(new Event("error")),
	);
	expect(container.textContent).toContain("Image unavailable");
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
	await act(async () => container.querySelector("button")?.click());
	expect(mocks.invoke).toHaveBeenCalledTimes(3);
	expect(container.querySelector("img")?.src).toBe(download.url);
});

it("discards late URLs when the account or session changes", async () => {
	let resolve: (result: typeof download) => void = () => {};
	mocks.invoke.mockReturnValueOnce(
		new Promise<typeof download>((done) => {
			resolve = done;
		}),
	);
	await render();
	await act(async () => reveal());
	mocks.user = { id: "account-two" };
	await render("ses-two");
	await act(async () => resolve(download));
	expect(container.querySelector("img")).toBeNull();
	await act(async () => reveal());
	expect(mocks.invoke).toHaveBeenLastCalledWith("get_cloud_artifact_url", {
		sessionId: "ses-two",
		artifactId: "frame-one",
	});
});

it("shows an error without looping when access is denied", async () => {
	mocks.invoke.mockRejectedValue(new Error("Forbidden"));
	await render();
	await act(async () => reveal());
	expect(container.textContent).toContain("Image unavailable");
	expect(container.querySelector("img")).toBeNull();
	expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
