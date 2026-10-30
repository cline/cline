// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { ChatMessages } from "../chat-messages";
import { PublishedArtifacts } from "./published-artifacts";
import { parsePublishedArtifacts } from "./tool-summaries";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	open: vi.fn(),
	accountReady: true,
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
	openExternalUrl: mocks.open,
	isTauriAvailable: () => true,
}));
vi.mock("@/contexts/account-context", () => ({
	useAccount: () => ({
		user: { id: "one" },
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
let reveal: Array<() => void>;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	mocks.accountReady = true;
	HTMLElement.prototype.scrollTo = vi.fn();
	vi.stubGlobal(
		"matchMedia",
		vi.fn((media: string) => ({
			media,
			matches: false,
			addEventListener() {},
			removeEventListener() {},
		})),
	);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	reveal = [];
	vi.stubGlobal(
		"IntersectionObserver",
		class {
			constructor(
				callback: (entries: { isIntersecting: boolean }[]) => void,
				options?: IntersectionObserverInit,
			) {
				if (options?.rootMargin === "200px")
					reveal.push(() => callback([{ isIntersecting: true }]));
			}
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
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
	vi.unstubAllGlobals();
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
	expect(container.querySelector("button")?.textContent).toBe("Download");
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

it("previews a published image and keeps download available after preview failure", async () => {
	const images = parsePublishedArtifacts(
		JSON.stringify({
			files: [
				{ path: "/workspace/screenshot.png", artifactId: "published-frame" },
			],
		}),
	);
	if (!images) throw new Error("Fixture must parse");
	await act(async () =>
		root.render(<PublishedArtifacts files={images} sessionId="ses-one" />),
	);
	expect(container.textContent).toContain("Loading image");
	expect(mocks.invoke).not.toHaveBeenCalled();
	await act(async () => {
		for (const callback of reveal.splice(0)) callback();
	});
	expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("resolve_artifact", {
		sessionId: "ses-one",
		artifactId: "published-frame",
	});
	expect(container.querySelector("img")?.src).toBe(
		"https://storage.example/file?signed=1",
	);
	expect(container.querySelector("img")?.alt).toBe("screenshot.png");
	expect(container.querySelector("button")?.textContent).toBe("Download");
	expect(mocks.open).not.toHaveBeenCalled();
	for (let attempt = 0; attempt < 2; attempt++) {
		const image = container.querySelector("img");
		if (!image) throw new Error("Preview must exist before its load fails");
		await act(async () => image.dispatchEvent(new Event("error")));
	}
	expect(container.textContent).toContain("Image unavailable");
	const download = Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent === "Download",
	);
	expect(download).toBeDefined();
	await act(async () => download?.click());
	expect(mocks.open).toHaveBeenCalledExactlyOnceWith(
		"https://storage.example/file?signed=1",
	);
});

it("keeps published images visible after completion and reopening history without expanding work", async () => {
	const messages: ChatMessage[] = [
		{
			id: "user",
			sessionId: "ses-one",
			role: "user",
			content: "Create screenshots",
			createdAt: 1,
		},
		{
			id: "command",
			sessionId: "ses-one",
			role: "tool",
			content: JSON.stringify({
				toolName: "run_commands",
				result: "Created screenshots",
			}),
			createdAt: 2,
		},
		{
			id: "publication",
			sessionId: "ses-one",
			role: "tool",
			content: JSON.stringify({
				toolName: "publish_artifacts",
				input: {
					files: [
						{ path: "/tmp/before.png", caption: "Menu is closed" },
						{ path: "/tmp/after.png" },
					],
				},
				result: JSON.stringify({
					files: [
						{ path: "/tmp/before.png", artifactId: "before" },
						{ path: "/tmp/after.png", artifactId: "after" },
					],
				}),
			}),
			createdAt: 3,
		},
		{
			id: "answer",
			sessionId: "ses-one",
			role: "assistant",
			content: "Published screenshots",
			createdAt: 4,
		},
	];
	const stored = JSON.stringify(messages);
	for (const [index, status] of (
		["running", "completed", "completed"] as const
	).entries()) {
		if (index === 2) await act(async () => root.render(null));
		await act(async () =>
			root.render(
				<ChatMessages
					sessionId="ses-one"
					status={status}
					chatTransportState="connected"
					error={null}
					messages={messages}
					pendingAskQuestions={[]}
					pendingToolApprovals={[]}
					onAnswerAskQuestion={vi.fn()}
					onApproveToolApproval={vi.fn()}
					onRejectToolApproval={vi.fn()}
				/>,
			),
		);
		const work = container.querySelector("button.cline-chat-work-trigger");
		if (status === "completed")
			expect(work?.getAttribute("aria-expanded")).toBe("false");
		expect(
			container.querySelectorAll('[aria-label="Published images"]'),
		).toHaveLength(1);
		expect(
			container.querySelectorAll('[aria-roledescription="slide"]'),
		).toHaveLength(2);
		expect(
			container.querySelector('[aria-label="Next screenshot"]'),
		).not.toBeNull();
		await act(async () => {
			for (const callback of reveal.splice(0)) callback();
		});
		expect(
			Array.from(container.querySelectorAll("img"), (image) => image.alt),
		).toEqual(["before.png", "after.png"]);
		expect(
			Array.from(
				container.querySelectorAll("figcaption"),
				(caption) => caption.textContent,
			),
		).toEqual([
			"Menu is closed1 of 2 · before.pngDownload",
			"2 of 2 · after.pngDownload",
		]);
		expect(container.textContent).not.toContain("Verified");
	}
	expect(JSON.stringify(messages)).toBe(stored);
});
