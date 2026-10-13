// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AgentCommandOutput } from "../components/agent-command-output.js";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});
it("retains host-rendered output and shows the cursor only while running", async () => {
	await act(async () =>
		root.render(
			<AgentCommandOutput output="raw" isRunning>
				<span data-ansi>formatted</span>
			</AgentCommandOutput>,
		),
	);
	const log = container.querySelector('[role="log"]');
	expect(log?.getAttribute("aria-live")).toBe("off");
	expect(log?.hasAttribute("tabindex")).toBe(false);
	expect(log?.querySelector("[data-ansi]")?.textContent).toBe("formatted");
	expect(log?.querySelector("[aria-hidden]")).not.toBeNull();
	await act(async () =>
		root.render(<AgentCommandOutput output="finished" isRunning={false} />),
	);
	expect(log?.textContent).toBe("finished");
	expect(log?.querySelector("[aria-hidden]")).toBeNull();
});
it("follows output until scrolled 24px from the tail, resumes within 24px, and resets empty output", async () => {
	async function render(output: string) {
		await act(async () =>
			root.render(<AgentCommandOutput output={output} isRunning />),
		);
	}
	await render("one");
	const log = container.querySelector<HTMLDivElement>('[role="log"]')!;
	Object.defineProperties(log, {
		scrollHeight: { configurable: true, value: 500 },
		clientHeight: { configurable: true, value: 100 },
	});
	await render("two");
	expect(log.scrollTop).toBe(500);
	log.scrollTop = 376;
	await act(async () =>
		log.dispatchEvent(new Event("scroll", { bubbles: true })),
	);
	await render("three");
	expect(log.scrollTop).toBe(376);
	log.scrollTop = 377;
	await act(async () =>
		log.dispatchEvent(new Event("scroll", { bubbles: true })),
	);
	await render("four");
	expect(log.scrollTop).toBe(500);
	await render("");
	expect(log.scrollTop).toBe(0);
});
