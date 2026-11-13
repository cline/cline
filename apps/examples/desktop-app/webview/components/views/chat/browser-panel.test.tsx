// @vitest-environment jsdom
import { createHmac } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPanel, normalizeBrowserUrl, toFrameSrc } from "./browser-panel";

const { openExternalUrl } = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock("@/lib/desktop-client", () => ({
	openExternalUrl,
	resolveDesktopBackendWsEndpoint: async () =>
		"ws://127.0.0.1:3126/transport?approval_token=tok",
}));

// What the sidecar derives for the same approval token.
const previewToken = (approvalToken: string) =>
	createHmac("sha256", approvalToken).update("preview-file").digest("hex");

describe("normalizeBrowserUrl", () => {
	it.each([
		["3000", "http://localhost:3000/"],
		["localhost:5173/app", "http://localhost:5173/app"],
		["127.0.0.1:8080", "http://127.0.0.1:8080/"],
		["example.com", "https://example.com/"],
		["http://example.com/x", "http://example.com/x"],
		[
			"file:///workspace/cline/snake.html",
			"file:///workspace/cline/snake.html",
		],
	])("reads %s as %s", (input, expected) => {
		expect(normalizeBrowserUrl(input)).toBe(expected);
	});

	it.each([
		"",
		"   ",
		"javascript:alert(1)",
		"file://remote-host/share/x.html",
	])("rejects %j", (input) => {
		expect(normalizeBrowserUrl(input)).toBeNull();
	});
});

describe("toFrameSrc", () => {
	const ws = "ws://127.0.0.1:3126/transport?approval_token=a b";

	it("routes file URLs through the sidecar with the preview token", async () => {
		expect(
			await toFrameSrc("file:///workspace/my%20app/index.html#top", ws),
		).toBe(
			`http://127.0.0.1:3126/preview-file/${previewToken("a b")}/workspace/my%20app/index.html#top`,
		);
	});

	it("keeps a Windows drive path intact", async () => {
		expect(await toFrameSrc("file:///C:/Users/me/app/index.html", ws)).toBe(
			`http://127.0.0.1:3126/preview-file/${previewToken("a b")}/C:/Users/me/app/index.html`,
		);
	});

	it("never puts the approval token in the frame address", async () => {
		expect(await toFrameSrc("file:///workspace/x.html", ws)).not.toMatch(
			/a%20b|a b|approval_token/,
		);
	});

	it("refuses when the endpoint carries no token", async () => {
		await expect(
			toFrameSrc("file:///workspace/x.html", "ws://127.0.0.1:3126/transport"),
		).rejects.toThrow();
	});

	it("leaves web URLs alone", async () => {
		expect(await toFrameSrc("http://localhost:3000/", ws)).toBe(
			"http://localhost:3000/",
		);
	});
});

describe("BrowserPanel", () => {
	let root: Root;
	let container: HTMLDivElement;

	beforeEach(() => {
		Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
		window.localStorage.clear();
		openExternalUrl.mockReset();
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	const render = () =>
		act(async () => root.render(<BrowserPanel onClose={vi.fn()} />));

	const submit = async (value: string) => {
		const input = container.querySelector<HTMLInputElement>("input");
		const setValue = Object.getOwnPropertyDescriptor(
			HTMLInputElement.prototype,
			"value",
		)?.set;
		await act(async () => {
			setValue?.call(input, value);
			input?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		await act(async () => {
			container
				.querySelector("form")
				?.dispatchEvent(
					new Event("submit", { bubbles: true, cancelable: true }),
				);
		});
	};

	it("loads a submitted URL in a frame that cannot navigate the app", async () => {
		await render();
		expect(container.querySelector("iframe")).toBeNull();
		await submit("3000");
		const frame = container.querySelector("iframe");
		expect(frame?.getAttribute("src")).toBe("http://localhost:3000/");
		expect(frame?.getAttribute("sandbox")).not.toContain(
			"allow-top-navigation",
		);
	});

	it("reopens on the last URL", async () => {
		await render();
		await submit("localhost:5173");
		await act(async () => root.unmount());
		root = createRoot(container);
		await render();
		expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
			"http://localhost:5173/",
		);
	});

	it("loads a workspace file through the sidecar route", async () => {
		await render();
		await submit("file:///workspace/cline/snake.html");
		await vi.waitFor(() =>
			expect(container.querySelector("iframe")?.getAttribute("src")).toBe(
				`http://127.0.0.1:3126/preview-file/${previewToken("tok")}/workspace/cline/snake.html`,
			),
		);
		// The system browser can't be handed a file address.
		expect(
			container
				.querySelector('button[aria-label="Open in browser"]')
				?.hasAttribute("disabled"),
		).toBe(true);
	});

	it("flags an unusable URL instead of loading it", async () => {
		await render();
		await submit("javascript:alert(1)");
		expect(container.querySelector("iframe")).toBeNull();
		expect(container.querySelector("input")?.getAttribute("aria-invalid")).toBe(
			"true",
		);
	});
});
