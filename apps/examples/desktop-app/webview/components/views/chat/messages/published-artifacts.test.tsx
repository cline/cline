// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	PublishedArtifacts,
	parsePublishedArtifacts,
} from "./published-artifacts";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	open: vi.fn(),
	user: { id: "one" },
	accountReady: true,
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
	openExternalUrl: mocks.open,
}));
vi.mock("@/contexts/account-context", () => ({
	useAccount: () => ({
		user: mocks.user,
		accountReady: mocks.accountReady,
		activeOrganization: null,
	}),
}));
const files = parsePublishedArtifacts(
	JSON.stringify({
		files: [
			{ path: "/tmp/report.txt", artifactId: " report/雪 " },
			{
				path: "/tmp/missing.txt",
				error: { code: "FILE_NOT_FOUND", message: "Local file does not exist" },
			},
		],
	}),
);
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	mocks.user = { id: "one" };
	mocks.accountReady = true;
	mocks.invoke.mockReset().mockResolvedValue({
		url: "https://storage.example/file?signed=1",
		expiresAt: "2030-01-01T00:00:00Z",
	});
	mocks.open.mockReset().mockResolvedValue(undefined);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
async function render() {
	if (!files) throw new Error("Fixture must parse");
	await act(async () =>
		root.render(<PublishedArtifacts files={files} sessionId="ses-one" />),
	);
}
async function click() {
	await act(async () => container.querySelector("button")?.click());
}

it("downloads a persisted publication and keeps per-file errors visible", async () => {
	mocks.accountReady = false;
	await render();
	expect(container.querySelector("button")?.disabled).toBe(true);
	await click();
	expect(mocks.invoke).not.toHaveBeenCalled();
	mocks.accountReady = true;
	await render();
	expect(container.querySelector("button")?.disabled).toBe(false);
	expect(container.textContent).toContain("Local file does not exist");
	expect(container.querySelectorAll("button")).toHaveLength(1);
	expect(mocks.invoke).not.toHaveBeenCalled();
	await click();
	expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("resolve_artifact", {
		sessionId: "ses-one",
		artifactId: " report/雪 ",
	});
	expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
		"https://storage.example/file?signed=1",
	);
	expect(
		parsePublishedArtifacts({
			files: [{ path: "bad", artifactId: "id", error: "invalid" }],
		}),
	).toBeUndefined();
});

it("requests a new URL when retrying a failed download", async () => {
	mocks.invoke.mockRejectedValueOnce(new Error("Unavailable"));
	await render();
	await click();
	expect(container.textContent).toContain("Retry download");
	expect(mocks.open).not.toHaveBeenCalled();
	await click();
	expect(mocks.invoke).toHaveBeenCalledTimes(2);
	expect(mocks.open).toHaveBeenCalledOnce();
});

it("does not open a pending download after the account changes", async () => {
	let resolve: (value: unknown) => void = () => {};
	mocks.invoke.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	await render();
	await click();
	mocks.user = { id: "two" };
	await render();
	await act(async () =>
		resolve({ url: "https://storage.example/old-account" }),
	);
	expect(mocks.open).not.toHaveBeenCalled();
});
