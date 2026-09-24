// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
	AgentChangedFile,
	AgentChangesPanel,
} from "../components/agent-changes.js";

it("keeps file actions separate from disclosure and forwards panel focus/close", async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const closeRef = createRef<HTMLButtonElement>();
	const onClose = vi.fn();
	const onCopy = vi.fn();
	const onOpen = vi.fn();
	try {
		await act(async () =>
			root.render(
				<AgentChangesPanel
					title="Changes"
					fileCount="1+"
					onClose={onClose}
					closeButtonRef={closeRef}
					notice="One omitted edit"
				>
					<AgentChangedFile
						path="src/a.ts"
						additions={2}
						deletions={1}
						onCopyPath={onCopy}
						actions={
							<button type="button" onClick={onOpen}>
								Open editor
							</button>
						}
					>
						<pre>changed content</pre>
					</AgentChangedFile>
				</AgentChangesPanel>,
			),
		);
		expect(container.textContent).toContain("Files: 1+");
		expect(container.textContent).toContain("One omitted edit");
		const toggle = container.querySelector<HTMLButtonElement>(
			".cline-ui-agent-changes__toggle",
		);
		expect(toggle).not.toBeNull();
		expect(container.querySelector("pre")?.textContent).toBe("changed content");
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>(
					'[aria-label="Copy file path for src/a.ts"]',
				)
				?.click(),
		);
		expect(onCopy).toHaveBeenCalledOnce();
		expect(container.querySelector("pre")?.textContent).toBe("changed content");
		await act(async () =>
			Array.from(container.querySelectorAll("button"))
				.find((button) => button.textContent === "Open editor")
				?.click(),
		);
		expect(onOpen).toHaveBeenCalledOnce();
		expect(container.querySelector("pre")?.textContent).toBe("changed content");
		await act(async () => toggle?.click());
		expect(container.querySelector("pre")).toBeNull();
		await act(async () => toggle?.click());
		expect(container.querySelector("pre")?.textContent).toBe("changed content");
		closeRef.current?.focus();
		expect(document.activeElement).toBe(closeRef.current);
		await act(async () => closeRef.current?.click());
		expect(onClose).toHaveBeenCalledOnce();
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});
