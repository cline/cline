// @vitest-environment jsdom

import type { GeneratedMedia } from "@cline/shared/browser";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArtifactImage } from "./artifact-image";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
}));
vi.mock("@/contexts/account-context", () => ({
	useAccount: () => ({
		user: { id: "account-one" },
		accountReady: true,
		activeOrganization: null,
	}),
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
async function render() {
	await act(async () =>
		root.render(<ArtifactImage media={media} sessionId="ses-one" />),
	);
}

it("loads visible artifacts directly, preserves the reference, and resolves again on reopening", async () => {
	await render();
	expect(mocks.invoke).not.toHaveBeenCalled();
	await act(async () => reveal());
	expect(mocks.invoke).toHaveBeenCalledWith("resolve_artifact", {
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

it("loads a signed URL when the client clock is ahead of its expiry", async () => {
	vi.spyOn(Date, "now").mockReturnValue(Date.parse("2031-01-01T00:00:00Z"));
	await render();
	await act(async () => reveal());
	expect(container.querySelector("img")?.src).toBe(download.url);
	expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it("refreshes a failed image URL once and offers an explicit retry after another failure", async () => {
	await render();
	await act(async () => reveal());
	const originalImage = container.querySelector("img");
	await act(async () => {
		originalImage?.dispatchEvent(new Event("error"));
		originalImage?.dispatchEvent(new Event("error"));
	});
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
	expect(container.querySelector("img")).not.toBe(originalImage);
	await act(async () => originalImage?.dispatchEvent(new Event("error")));
	expect(container.querySelector("img")).not.toBeNull();
	await act(async () =>
		container.querySelector("img")?.dispatchEvent(new Event("error")),
	);
	expect(container.textContent).toContain("Image unavailable");
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
	await act(async () => container.querySelector("button")?.click());
	expect(mocks.invoke).toHaveBeenCalledTimes(3);
	expect(container.querySelector("img")?.src).toBe(download.url);
	await act(async () =>
		container.querySelector("img")?.dispatchEvent(new Event("error")),
	);
	expect(mocks.invoke).toHaveBeenCalledTimes(4);
});

it("shows an error without looping when access is denied", async () => {
	mocks.invoke.mockRejectedValue(new Error("Forbidden"));
	await render();
	await act(async () => reveal());
	expect(container.textContent).toContain("Image unavailable");
	expect(container.querySelector("img")).toBeNull();
	expect(mocks.invoke).toHaveBeenCalledTimes(1);
});
