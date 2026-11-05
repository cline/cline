// @vitest-environment jsdom
import type { MessageWithMetadata } from "@cline/shared";
import type { UxVerificationReport } from "@cline/shared/browser";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { type ChatMessage, ChatMessageSchema } from "@/lib/chat-schema";
import { readSessionMessagesSync } from "../../../../../sidecar/session-data/messages";
import { ChatMessages } from "../chat-messages";
import { ToolMessageBlock } from "./tool-message-block";
import {
	getReportedArtifacts,
	isUxVerificationMessage,
} from "./tool-summaries";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	open: vi.fn(),
	account: {
		user: { id: "one" },
		accountReady: true,
		activeOrganization: null,
	},
}));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: mocks.invoke },
	isTauriAvailable: () => true,
	openExternalUrl: mocks.open,
}));
vi.mock("@/contexts/account-context", () => ({
	useAccount: () => mocks.account,
}));
const report = {
	kind: "ux_verification",
	version: 1,
	title: "Verified navigation",
	subtitle: "Chrome · cloud session",
	checks: [
		{
			id: "menu",
			title: "Menu opens",
			subtitle: "The navigation menu is visible",
			status: "passed",
			screenshot: {
				id: "frame",
				modality: "image",
				mediaType: "image/png",
				source: { type: "artifact", artifactId: " frame/雪 " },
			},
		},
	],
} satisfies UxVerificationReport;
function message(result: unknown = report): ChatMessage {
	return {
		id: "report",
		sessionId: "ses-one",
		role: "tool",
		createdAt: 1,
		content: JSON.stringify({ toolName: "present_results", result }),
	};
}
let container: HTMLDivElement;
let root: Root;
let reveal: Array<() => void>;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollTo = vi.fn();
	mocks.account.user = { id: "one" };
	mocks.account.accountReady = true;
	mocks.open.mockReset().mockResolvedValue(undefined);
	mocks.invoke.mockReset().mockImplementation(async () => ({
		url: `https://storage.example/image.png?signature=${mocks.invoke.mock.calls.length}`,
		expiresAt: "2030-01-01T00:00:00Z",
	}));
	window.matchMedia = vi.fn().mockImplementation((media: string) => ({
		media,
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
	reveal = [];
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
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
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
async function render(input = message()) {
	await act(async () =>
		root.render(<ToolMessageBlock messages={[input]} isRunActive={false} />),
	);
}
async function revealImages() {
	await act(async () => {
		for (const callback of reveal.splice(0)) callback();
	});
}
function mainImage() {
	return container.querySelector<HTMLImageElement>(
		".cline-ui-ux-evidence-slide img",
	);
}
it.each([
	report,
	JSON.stringify(report),
])("renders live and saved semantic reports through real artifact image resolution", async (output) => {
	const input = message(output);
	const stored = input.content;
	await render(input);
	expect(container.textContent).toContain("Verified navigation");
	expect(mocks.invoke).not.toHaveBeenCalled();
	await revealImages();
	expect(mainImage()?.src).toContain(
		"https://storage.example/image.png?signature=",
	);
	expect(mainImage()?.getAttribute("referrerpolicy")).toBe("no-referrer");
	expect(mocks.invoke).toHaveBeenCalledWith("resolve_artifact", {
		sessionId: "ses-one",
		artifactId: " frame/雪 ",
	});
	expect(input.content).toBe(stored);
	expect(input.content).not.toContain("signature=");
});
it("recovers a failed screenshot once and exposes the existing retry action", async () => {
	await render();
	await revealImages();
	const initialRequests = mocks.invoke.mock.calls.length;
	const initial = mainImage()!;
	await act(async () => {
		initial.dispatchEvent(new Event("error"));
		initial.dispatchEvent(new Event("error"));
	});
	expect(mocks.invoke).toHaveBeenCalledTimes(initialRequests + 1);
	expect(mainImage()).not.toBe(initial);
	await act(async () => mainImage()!.dispatchEvent(new Event("error")));
	expect(container.textContent).toContain("Image unavailable");
	expect(mocks.invoke).toHaveBeenCalledTimes(initialRequests + 1);
	const download = container.querySelector<HTMLButtonElement>(
		'[aria-label="Download"]',
	)!;
	await act(async () => download.click());
	expect(mocks.open).toHaveBeenCalledOnce();
	expect(container.textContent).toContain("Image unavailable");
	const retry = Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent === "Retry",
	)!;
	await act(async () => retry.click());
	expect(mocks.invoke).toHaveBeenCalledTimes(initialRequests + 3);
	expect(mainImage()).not.toBeNull();
});
it("retains a loaded image when time advances beyond its URL expiry", async () => {
	const input = message();
	await render(input);
	await revealImages();
	const source = mainImage()?.src;
	const requests = mocks.invoke.mock.calls.length;
	vi.spyOn(Date, "now").mockReturnValue(Date.parse("2031-01-01T00:00:00Z"));
	await render({ ...input });
	expect(mainImage()?.src).toBe(source);
	expect(mocks.invoke).toHaveBeenCalledTimes(requests);
});
it("downloads the report screenshot from the carousel and expanded viewer", async () => {
	await render();
	expect(mocks.invoke).not.toHaveBeenCalled();
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>('[aria-label="Download"]')!
			.click(),
	);
	expect(mocks.invoke).toHaveBeenLastCalledWith("resolve_artifact", {
		sessionId: "ses-one",
		artifactId: " frame/雪 ",
	});
	expect(mocks.open).toHaveBeenCalledOnce();
	await revealImages();
	const expand = container.querySelector<HTMLButtonElement>(
		'[aria-label="Expand screenshot"]',
	)!;
	expand.focus();
	await act(async () => expand.click());
	await revealImages();
	let dialog = document.querySelector('[role="dialog"]')!;
	expect(dialog.textContent).toContain("Menu opens");
	expect(dialog.textContent).toContain("The navigation menu is visible");
	expect(dialog.querySelector("img")?.src).toContain(
		"https://storage.example/image.png?signature=",
	);
	const initialRequests = mocks.invoke.mock.calls.length;
	vi.spyOn(Date, "now").mockReturnValue(Date.parse("2031-01-01T00:00:00Z"));
	const downloadUrl = "https://storage.example/pending-download.png";
	const pending = Promise.withResolvers<{
		url: string;
		expiresAt: string;
	}>();
	mocks.invoke.mockImplementationOnce(() => pending.promise);
	await act(async () =>
		dialog.querySelector<HTMLButtonElement>('[aria-label="Download"]')!.click(),
	);
	expect(mocks.invoke).toHaveBeenCalledTimes(initialRequests + 1);
	expect(mocks.invoke).toHaveBeenLastCalledWith("resolve_artifact", {
		sessionId: "ses-one",
		artifactId: " frame/雪 ",
	});
	const pendingDownload = dialog.querySelector<HTMLButtonElement>(
		'[aria-label="Preparing…"]',
	)!;
	expect(pendingDownload.disabled).toBe(true);
	await act(async () =>
		(
			dialog.querySelector('[data-slot="dialog-close"]') as HTMLButtonElement
		).click(),
	);
	expect(document.querySelector('[role="dialog"]')).toBeNull();
	await vi.waitFor(() => expect(document.activeElement).toBe(expand));
	await act(async () => expand.click());
	dialog = document.querySelector('[role="dialog"]')!;
	const stillPreparing = dialog.querySelector<HTMLButtonElement>(
		'[aria-label="Preparing…"]',
	)!;
	expect(stillPreparing.disabled).toBe(true);
	await act(async () =>
		(
			dialog.querySelector('[data-slot="dialog-close"]') as HTMLButtonElement
		).click(),
	);
	expect(document.querySelector('[role="dialog"]')).toBeNull();
	await vi.waitFor(() => expect(document.activeElement).toBe(expand));
	await act(async () =>
		pending.resolve({
			url: downloadUrl,
			expiresAt: "2040-01-01T00:00:00Z",
		}),
	);
	await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
	expect(mocks.open).toHaveBeenLastCalledWith(downloadUrl);
	await act(async () => expand.click());
	dialog = document.querySelector('[role="dialog"]')!;
	const readyDownload = dialog.querySelector<HTMLButtonElement>(
		'[aria-label="Download"]',
	)!;
	const resolvedRequestCount = mocks.invoke.mock.calls.length;
	await act(async () => readyDownload.click());
	expect(mocks.invoke).toHaveBeenCalledTimes(resolvedRequestCount);
	expect(mocks.open).toHaveBeenCalledTimes(3);
	expect(mocks.open).toHaveBeenLastCalledWith(downloadUrl);
	const dialogClose = dialog.querySelector<HTMLButtonElement>(
		'[data-slot="dialog-close"]',
	)!;
	await act(async () => readyDownload.focus());
	const shiftTab = new KeyboardEvent("keydown", {
		key: "Tab",
		shiftKey: true,
		bubbles: true,
		cancelable: true,
	});
	await act(async () => readyDownload.dispatchEvent(shiftTab));
	expect(shiftTab.defaultPrevented).toBe(true);
	expect(document.activeElement).toBe(dialogClose);
	await act(async () => readyDownload.focus());
	await act(async () =>
		readyDownload.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		),
	);
	expect(document.querySelector('[role="dialog"]')).toBeNull();
	await vi.waitFor(() => expect(document.activeElement).toBe(expand));
});
it.each([
	["unmodified", {}],
	["Ctrl", { ctrlKey: true }],
	["Alt", { altKey: true }],
	["Meta", { metaKey: true }],
])("finishes the requested download and preserves focus with %s ArrowLeft", async (_label, modifiers) => {
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(640);
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(400);
	vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(
		function (this: HTMLElement) {
			return this.getAttribute("aria-roledescription") === "slide"
				? Array.from(this.parentElement?.children ?? []).indexOf(this) * 640
				: 0;
		},
	);
	const style = document.createElement("style");
	style.textContent = '[aria-roledescription="slide"] { margin-right: 0px; }';
	document.head.append(style);
	onTestFinished(() => style.remove());
	const firstDownload = {
		url: "https://storage.example/first.png",
		expiresAt: "2030-01-01T00:00:00Z",
	};
	const pending = Promise.withResolvers<typeof firstDownload>();
	const secondDownload = {
		...firstDownload,
		url: "https://storage.example/second.png",
	};
	mocks.invoke
		.mockImplementationOnce(() => pending.promise)
		.mockResolvedValue(secondDownload);
	await render(
		message({
			...report,
			checks: [
				report.checks[0],
				{
					...report.checks[0],
					id: "second",
					screenshot: {
						...report.checks[0].screenshot,
						id: "second-frame",
						source: { type: "artifact", artifactId: "second.png" },
					},
				},
			],
		}),
	);
	const download = () =>
		Array.from(
			container.querySelectorAll<HTMLButtonElement>(
				'.cline-ui-ux-evidence-actions button[aria-label="Download"]',
			),
		).find((button) => !button.closest("[hidden]"))!;
	await act(async () => download().click());
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>('[aria-label="Next screenshot"]')!
			.click(),
	);
	expect(
		container
			.querySelector('[aria-label^="Show check 2:"]')
			?.getAttribute("aria-current"),
	).toBe("true");
	await act(async () => pending.resolve(firstDownload));
	expect(mocks.open).toHaveBeenCalledExactlyOnceWith(firstDownload.url);
	await act(async () => download().click());
	expect(mocks.invoke).toHaveBeenLastCalledWith("resolve_artifact", {
		sessionId: "ses-one",
		artifactId: "second.png",
	});
	expect(mocks.open).toHaveBeenLastCalledWith(secondDownload.url);
	const focusedDownload = download();
	await act(async () => focusedDownload.focus());
	await act(async () =>
		focusedDownload.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "ArrowLeft",
				bubbles: true,
				...modifiers,
			}),
		),
	);
	expect(
		container
			.querySelector('[aria-label^="Show check 1:"]')
			?.getAttribute("aria-current"),
	).toBe("true");
	expect(document.activeElement).toBe(
		container.querySelector('[aria-roledescription="carousel"]'),
	);
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>('[aria-label="Next screenshot"]')!
			.click(),
	);
	expect(
		container
			.querySelector('[aria-label^="Show check 2:"]')
			?.getAttribute("aria-current"),
	).toBe("true");
	await act(async () =>
		container
			.querySelector<HTMLButtonElement>('[aria-label="Expand screenshot"]')!
			.click(),
	);
	const dialog = document.querySelector('[role="dialog"]')!;
	const dialogDownload = dialog.querySelector<HTMLButtonElement>(
		'[aria-label="Download"]',
	)!;
	await act(async () => dialogDownload.focus());
	await act(async () =>
		dialogDownload.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
		),
	);
	expect(
		container
			.querySelector('[aria-label^="Show check 2:"]')
			?.getAttribute("aria-current"),
	).toBe("true");
});
it("hides old images during account readiness changes and reloads under the new account", async () => {
	const input = message();
	await render(input);
	await revealImages();
	const first = mainImage()?.src;
	mocks.account.user = { id: "two" };
	mocks.account.accountReady = false;
	await render({ ...input });
	expect(mainImage()).toBeNull();
	mocks.account.accountReady = true;
	await render({ ...input });
	expect(mainImage()?.src).not.toBe(first);
	expect(mainImage()?.src).toContain(
		"https://storage.example/image.png?signature=",
	);
});
it("shows invalid reports safely without requesting artifact access", async () => {
	await render(message({ kind: "ux_verification", checks: [] }));
	expect(container.textContent).toContain("could not be completed");
	expect(mocks.invoke).not.toHaveBeenCalled();
});
it("recognizes report semantics without requiring a particular tool name", () => {
	expect(isUxVerificationMessage(message())).toBe(true);
	expect(isUxVerificationMessage(message({ files: [] }))).toBe(false);
	expect(isUxVerificationMessage({ ...message(), role: "assistant" })).toBe(
		false,
	);
});
it("uses only valid completed reports and scopes their artifact references to the session", () => {
	const valid = message(JSON.stringify(report));
	const invalid = message({ ...report, checks: [] });
	const failed = {
		...valid,
		content: JSON.stringify({ result: report, isError: true }),
	};
	const pending = { ...valid, meta: { hookEventName: "tool_call_start" } };
	expect(getReportedArtifacts([invalid, failed, pending]).size).toBe(0);
	expect(
		getReportedArtifacts([valid, { ...valid, sessionId: "ses-two" }]),
	).toEqual(
		new Map([
			["ses-one", new Set([" frame/雪 "])],
			["ses-two", new Set([" frame/雪 "])],
		]),
	);
});
it("does not reprocess settled rows when report references are unchanged", async () => {
	const input = message();
	const parse = vi.spyOn(JSON, "parse");
	async function update() {
		const reportedArtifacts = getReportedArtifacts([input]);
		parse.mockClear();
		await act(async () =>
			root.render(
				<ToolMessageBlock
					messages={[input]}
					isRunActive={false}
					reportedArtifacts={reportedArtifacts}
				/>,
			),
		);
	}
	await update();
	expect(parse.mock.calls.some(([value]) => value === input.content)).toBe(
		true,
	);
	await update();
	expect(parse.mock.calls.some(([value]) => value === input.content)).toBe(
		false,
	);
});
it.each([
	"none",
	"reported",
	"mixed",
])("keeps verification visible with %s publication files", async (publication) => {
	const input = message();
	const files = [
		{ path: "/tmp/menu.png", artifactId: " frame/雪 " },
		...(publication === "mixed"
			? [
					{ path: "/tmp/other.png", artifactId: "other" },
					{
						path: "/tmp/missing.png",
						error: { code: "NOT_FOUND", message: "File missing" },
					},
				]
			: []),
	];
	await act(async () =>
		root.render(
			<ChatMessages
				sessionId="ses-one"
				status="completed"
				chatTransportState="connected"
				error={null}
				messages={[
					{
						...input,
						id: "user",
						role: "user",
						content: "Check the navigation",
					},
					...(publication === "none"
						? []
						: [
								{
									...input,
									id: "publication",
									content: JSON.stringify({
										toolName: "publish_artifacts",
										result: { files },
									}),
								},
							]),
					input,
					{
						...input,
						id: "answer",
						role: "assistant",
						content: "Completed checks",
					},
				]}
				pendingAskQuestions={[]}
				pendingToolApprovals={[]}
				onAnswerAskQuestion={vi.fn()}
				onApproveToolApproval={vi.fn()}
				onRejectToolApproval={vi.fn()}
			/>,
		),
	);
	const work = container.querySelector<HTMLButtonElement>(
		"button.cline-chat-work-trigger",
	);
	if (publication === "reported") {
		expect(work?.getAttribute("aria-expanded")).toBe("false");
	} else {
		expect(work).toBeNull();
	}
	expect(container.textContent).toContain("Verified navigation");
	const publishedImages = container.querySelector(
		'[aria-label="Published images"]',
	);
	if (publication === "mixed") {
		expect(
			publishedImages?.querySelector('[aria-label="other.png"]'),
		).not.toBeNull();
		expect(
			publishedImages?.querySelector('[aria-label="menu.png"]'),
		).toBeNull();
		expect(container.textContent).toContain("File missing");
		expect(
			Array.from(container.querySelectorAll("button")).filter(
				(button) => button.textContent === "Download",
			),
		).toHaveLength(2);
	} else {
		expect(publishedImages).toBeNull();
	}
	await revealImages();
	expect(mainImage()?.src).toContain(
		"https://storage.example/image.png?signature=",
	);
	if (publication === "reported") {
		await act(async () => work?.click());
		expect(container.textContent).toContain("menu.png");
		expect(
			Array.from(container.querySelectorAll("button")).some(
				(button) => button.textContent === "Download",
			),
		).toBe(true);
	}
});
it.each([
	"final",
	"between",
	"next turn",
])("selects the screenshot carousel for %s history", async (placement) => {
	const tool = (
		id: string,
		name: string,
		result: unknown,
	): MessageWithMetadata[] => [
		{ role: "assistant", content: [{ type: "tool_use", id, name, input: {} }] },
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: id,
					name,
					content: JSON.stringify(result),
				},
			],
		},
	];
	const attachment: MessageWithMetadata = {
		role: "assistant",
		content: [
			{ type: "text", text: "Here is the screenshot" },
			{
				type: "image",
				mediaType: "image/png",
				data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1z8AAAAASUVORK5CYII=",
			},
		],
	};
	const source: MessageWithMetadata[] = [
		{ role: "user", content: "Verify the navigation" },
		...tool("publish", "publish_artifacts", {
			files: [{ path: "/tmp/menu.png", artifactId: " frame/雪 " }],
		}),
		...(placement !== "final" ? [attachment] : []),
		...(placement === "next turn"
			? [
					{
						role: "user",
						content: "Show the report",
					} satisfies MessageWithMetadata,
				]
			: []),
		...tool("verify", "present_results", report),
		placement === "final" ? attachment : { role: "assistant", content: "Done" },
	];
	const messages = readSessionMessagesSync(
		{ liveSessions: new Map() },
		"ses-one",
		800,
		source,
	).map((value) => ChatMessageSchema.parse(value));
	await act(async () =>
		root.render(
			<ChatMessages
				sessionId="ses-one"
				status="completed"
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
	expect(container.textContent).toContain("Verified navigation");
	expect(container.textContent).toContain("Here is the screenshot");
	expect(
		container.querySelector('[aria-label="Published images"]') !== null,
	).toBe(placement === "next turn");
	expect(container.textContent).toContain("menu.png");
	expect(
		Array.from(container.querySelectorAll("button")).some(
			(button) => button.textContent === "Download",
		),
	).toBe(true);
});
it("keeps failed thumbnails non-interactive while retaining Retry in the main image", async () => {
	mocks.invoke.mockRejectedValue(new Error("Artifact access denied"));
	await render();
	await revealImages();
	const thumbnail = container.querySelector<HTMLButtonElement>(
		'[aria-label^="Show check"]',
	)!;
	expect(thumbnail).not.toBeNull();
	expect(
		thumbnail.querySelector(
			"button, a[href], input, select, textarea, [tabindex]",
		),
	).toBeNull();
	expect(container.querySelector("button button")).toBeNull();
	const main = container.querySelector(".cline-ui-ux-evidence-slide")!;
	expect(main.textContent).toContain("Image unavailable");
	const retry = Array.from(main.querySelectorAll("button")).find(
		(button) => button.textContent === "Retry",
	);
	expect(retry).toBeDefined();
	mocks.invoke.mockResolvedValue({
		url: "https://storage.example/recovered.png",
		expiresAt: "2030-01-01T00:00:00Z",
	});
	await act(async () => retry!.click());
	expect(mainImage()?.src).toBe("https://storage.example/recovered.png");
	expect(thumbnail.querySelector("button")).toBeNull();
});
it("shows a fallback when expanded inline image bytes cannot be decoded", async () => {
	let id = 0;
	vi.stubGlobal(
		"URL",
		class extends URL {
			static createObjectURL() {
				return `blob:corrupt-inline-${id++}`;
			}
			static revokeObjectURL() {}
		},
	);
	const screenshot = {
		id: "inline",
		modality: "image",
		mediaType: "image/png",
		source: { type: "base64", data: "aGVsbG8=" },
	};
	await render(
		message({ ...report, checks: [{ ...report.checks[0], screenshot }] }),
	);
	const expand = container.querySelector<HTMLButtonElement>(
		'[aria-label="Expand screenshot"]',
	)!;
	expand.focus();
	await act(async () => expand.click());
	const dialog = document.querySelector('[role="dialog"]')!;
	const image = dialog.querySelector("img")!;
	expect(image).not.toBeNull();
	await act(async () => image.dispatchEvent(new Event("error")));
	expect(dialog.querySelector("img")).toBeNull();
	expect(dialog.textContent).toContain(
		"Generated image could not be rendered.",
	);
	expect(
		dialog.querySelector('[data-testid="generated-media-unavailable"]'),
	).not.toBeNull();
	expect(mocks.invoke).not.toHaveBeenCalled();
});
