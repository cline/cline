// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	AgentUxVerification,
	type UxScreenshotRenderer,
} from "../components/agent-ux-verification.js";
import type { UxVerificationReport } from "@cline/shared/browser";

const report: UxVerificationReport = {
	kind: "ux_verification",
	version: 1,
	title: "Verify composer",
	subtitle: "Chrome · local browser",
	checks: [
		{
			id: "composer",
			title: "Composer is visible",
			subtitle: "The send button remains reachable",
			status: "passed",
			screenshot: {
				id: "frame-one",
				modality: "image",
				mediaType: "image/png",
				source: { type: "base64", data: "aGVsbG8=" },
			},
		},
		{
			id: "login",
			title: "Login requires user action",
			subtitle: "Sign-in prevented this check",
			status: "blocked",
		},
	],
};
let root: Root;
let container: HTMLDivElement;
const revoke = vi.fn();
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		addEventListener() {},
		removeEventListener() {},
	}));
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
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	Object.defineProperties(URL, {
		createObjectURL: {
			configurable: true,
			value: vi.fn(() => "blob:ux-evidence"),
		},
		revokeObjectURL: { configurable: true, value: revoke },
	});
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
it("renders evidence and derived counts, with host-owned expansion", async () => {
	const expand = vi.fn();
	await act(async () =>
		root.render(
			<AgentUxVerification
				output={report}
				state="completed"
				onExpandScreenshot={expand}
			/>,
		),
	);
	expect(container.textContent).toContain("1/2 checks passed");
	expect(container.querySelector("img")?.src).toBe("blob:ux-evidence");
	await act(async () =>
		(
			container.querySelector(
				'[aria-label="Expand screenshot"]',
			) as HTMLButtonElement
		).click(),
	);
	expect(expand).toHaveBeenCalledWith(report.checks[0]);
	expect(
		container
			.querySelector('[aria-label="Previous screenshot"]')
			?.hasAttribute("disabled"),
	).toBe(true);
});
it("shows honest pending and invalid states", async () => {
	for (const state of ["running", "completed", "error"] as const) {
		await act(async () =>
			root.render(<AgentUxVerification output={null} state={state} />),
		);
		expect(container.textContent).not.toContain("checks passed");
		expect(container.textContent).toContain(
			state === "running" ? "Verifying UX" : "could not be completed",
		);
	}
});
it("does not bind remote screenshot URLs without a host renderer", async () => {
	const remote = {
		...report,
		checks: [
			{
				...report.checks[0],
				screenshot: {
					id: "private-frame",
					modality: "image",
					mediaType: "image/png",
					source: { type: "url", url: "https://example.com/private.png" },
				},
			},
		],
	};
	await act(async () =>
		root.render(<AgentUxVerification output={remote} state="completed" />),
	);
	expect(container.querySelector("img")).toBeNull();
	expect(container.textContent).toContain("host image resolver");
});
it("requires screenshot evidence for a passed check", async () => {
	await act(async () =>
		root.render(
			<AgentUxVerification
				output={{
					...report,
					checks: [{ ...report.checks[0], screenshot: undefined }],
				}}
				state="completed"
			/>,
		),
	);
	expect(container.textContent).toContain("could not be completed");
});
it("toggles playback with Space on the carousel and pauses on arrow navigation", async () => {
	await act(async () =>
		root.render(<AgentUxVerification output={report} state="completed" />),
	);
	const carousel = container.querySelector(
		'[aria-roledescription="carousel"]',
	) as HTMLElement;
	const key = async (target: HTMLElement, value: string, repeat = false) => {
		const event = new KeyboardEvent("keydown", {
			key: value,
			bubbles: true,
			cancelable: true,
			repeat,
		});
		await act(async () => {
			target.dispatchEvent(event);
		});
		return event;
	};
	carousel.focus();
	expect((await key(carousel, " ")).defaultPrevented).toBe(true);
	expect(
		container.querySelector('[aria-label="Pause slideshow"]'),
	).not.toBeNull();
	await key(carousel, " ", true);
	expect(
		container.querySelector('[aria-label="Pause slideshow"]'),
	).not.toBeNull();
	await key(carousel, " ");
	expect(
		container.querySelector('[aria-label="Play slideshow"]'),
	).not.toBeNull();
	await key(carousel, " ");
	await key(carousel, "ArrowRight");
	expect(
		container.querySelector('[aria-label="Play slideshow"]'),
	).not.toBeNull();
	const next = container.querySelector(
		'[aria-label="Next screenshot"]',
	) as HTMLButtonElement;
	expect((await key(next, " ")).defaultPrevented).toBe(false);
});
it("shows an unavailable state when native screenshot loading fails", async () => {
	await act(async () =>
		root.render(<AgentUxVerification output={report} state="completed" />),
	);
	const image = container.querySelector("img")!;
	await act(async () => {
		image.dispatchEvent(new Event("error"));
	});
	expect(container.textContent).toContain("Screenshot could not be loaded");
});
it("renders canonical inline media using its own ID and metadata", async () => {
	const screenshot = {
		...report.checks[0].screenshot!,
		name: "Captured menu",
		sizeBytes: 5,
	};
	await act(async () =>
		root.render(
			<AgentUxVerification
				output={{ ...report, checks: [{ ...report.checks[0], screenshot }] }}
				state="completed"
			/>,
		),
	);
	const image = container.querySelector("img");
	expect(image?.getAttribute("data-media-id")).toBe("frame-one");
	expect(image?.alt).toBe("Captured menu");
	expect(image?.src).toBe("blob:ux-evidence");
});
it("leaves unresolved artifact screenshots to the host without fetching or fabricating an image URL", async () => {
	const screenshot = {
		id: "cloud-frame",
		modality: "image",
		mediaType: "image/png",
		source: { type: "artifact", artifactId: "capture/one" },
	};
	await act(async () =>
		root.render(
			<AgentUxVerification
				output={{ ...report, checks: [{ ...report.checks[0], screenshot }] }}
				state="completed"
			/>,
		),
	);
	expect(container.querySelector("img")).toBeNull();
	expect(container.textContent).toContain(
		"Screenshot requires a host image resolver",
	);
});
it("passes canonical artifact media unchanged to a host screenshot renderer", async () => {
	const screenshot = {
		id: "cloud-frame",
		modality: "image",
		mediaType: "image/png",
		name: "Menu screenshot",
		sizeBytes: 123,
		source: { type: "artifact", artifactId: "capture/one" },
	};
	const output = { ...report, checks: [{ ...report.checks[0], screenshot }] };
	const renderer = vi.fn<UxScreenshotRenderer>((_check, className) => (
		<span className={className}>Host image component</span>
	));
	await act(async () =>
		root.render(
			<AgentUxVerification
				output={output}
				state="completed"
				renderScreenshot={renderer}
			/>,
		),
	);
	expect(renderer).toHaveBeenCalled();
	for (const [check] of renderer.mock.calls) {
		expect(check.screenshot).toEqual(screenshot);
	}
	expect(output.checks[0].screenshot.source).toEqual({
		type: "artifact",
		artifactId: "capture/one",
	});
	expect(container.textContent).toContain("Host image component");
});
it("uses the default inline renderer when the host declines a source", async () => {
	await act(async () =>
		root.render(
			<AgentUxVerification
				output={report}
				state="completed"
				renderScreenshot={() => undefined}
			/>,
		),
	);
	expect(container.querySelector("img")?.src).toBe("blob:ux-evidence");
	await act(async () => {
		container.querySelector("img")!.dispatchEvent(new Event("error"));
	});
	expect(container.textContent).toContain("Screenshot could not be loaded");
});
it("tells host renderers whether evidence is a slide or a non-interactive thumbnail", async () => {
	const renderer = vi.fn<UxScreenshotRenderer>(
		(_check, _className, presentation) => <span>{presentation}</span>,
	);
	await act(async () =>
		root.render(
			<AgentUxVerification
				output={report}
				state="completed"
				renderScreenshot={renderer}
			/>,
		),
	);
	expect(new Set(renderer.mock.calls.map((call) => call[2]))).toEqual(
		new Set(["slide", "thumbnail"]),
	);
	const thumbnail = container.querySelector('[aria-label^="Show check"]')!;
	expect(thumbnail.textContent).toContain("thumbnail");
});
