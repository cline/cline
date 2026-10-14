// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	AgentSessionOverview,
	AgentSessionRow,
	AgentSessionRowEditor,
} from "../components/agent-session-row.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});
afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

describe("AgentSessionRow host integration", () => {
	it("forwards the root ref and trigger events without adding wrappers", async () => {
		const ref = createRef<HTMLDivElement>();
		const onContextMenu = vi.fn();
		const onSelect = vi.fn();
		await act(async () =>
			root.render(
				<AgentSessionRow
					ref={ref}
					label="Task"
					data-state="open"
					onContextMenu={onContextMenu}
					onSelect={onSelect}
				/>,
			),
		);
		expect(ref.current).toBe(container.firstElementChild);
		expect(ref.current?.dataset.state).toBe("open");
		await act(async () => {
			ref.current?.dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true }),
			);
			container.querySelector("button")?.click();
		});
		expect(onContextMenu).toHaveBeenCalledOnce();
		expect(onSelect).toHaveBeenCalledOnce();
	});

	it("keeps the host action outside the navigation button and preserves cancellation", async () => {
		const onSelect = vi.fn();
		const onDelete = vi.fn();
		const onWrapperClick = vi.fn();
		await act(async () =>
			root.render(
				<AgentSessionRow
					label="Task"
					timestamp="2m"
					onSelect={onSelect}
					onClick={onWrapperClick}
					action={
						<button
							type="button"
							onClick={(event) => {
								event.stopPropagation();
								onDelete();
							}}
						>
							Delete
						</button>
					}
				/>,
			),
		);
		const [navigation, action] = container.querySelectorAll("button");
		expect(navigation.parentElement).toBe(action.parentElement);
		await act(async () => action.click());
		expect(onDelete).toHaveBeenCalledOnce();
		expect(onSelect).not.toHaveBeenCalled();
		expect(onWrapperClick).not.toHaveBeenCalled();
	});

	it("renders host link semantics without nesting the sibling action", async () => {
		await act(async () =>
			root.render(
				<AgentSessionRow
					action={<button type="button">Delete</button>}
					label="Task"
					renderControl={({ className, children }) => (
						<a
							aria-label="Open Task"
							className={className}
							href="/sessions/task"
							rel="noreferrer"
							target="_blank"
						>
							{children}
						</a>
					)}
					timestamp="2m"
				/>,
			),
		);
		const link = container.querySelector<HTMLAnchorElement>("a");
		const action = container.querySelector<HTMLButtonElement>("button");
		expect(link?.getAttribute("href")).toBe("/sessions/task");
		expect(link?.getAttribute("target")).toBe("_blank");
		expect(link?.getAttribute("aria-label")).toBe("Open Task");
		expect(link?.textContent).toBe("Task2m");
		expect(link?.querySelector("button")).toBeNull();
		expect(link?.parentElement).toBe(action?.parentElement);
	});

	it("keeps timestamps visible when the host does not provide an overlaid action", async () => {
		await act(async () =>
			root.render(<AgentSessionRow label="Task" timestamp="2m" />),
		);
		expect(
			container.querySelector('[class="group-hover/row:invisible"]'),
		).toBeNull();
		expect(container.textContent).toContain("2m");
	});

	it("disables native row activation without disabling host-owned actions implicitly", async () => {
		const onSelect = vi.fn();
		await act(async () =>
			root.render(
				<AgentSessionRow label="Task" disabled onSelect={onSelect} />,
			),
		);
		await act(async () => container.querySelector("button")?.click());
		expect(onSelect).not.toHaveBeenCalled();
		expect(container.querySelector("button")?.disabled).toBe(true);
	});

	it.each([
		["pending", true, "bg-yellow-400", false],
		["provisioning", true, "bg-yellow-400", true],
		["running", true, "bg-green-500", false],
		["idle", true, "bg-blue-500", false],
		["idle", false, null, false],
	] as const)("preserves desktop status precedence for %s/unread=%s", async (status, unread, color, pulsing) => {
		await act(async () =>
			root.render(
				<AgentSessionRow label="Task" status={status} unread={unread} />,
			),
		);
		const dot = container.querySelector('[aria-hidden="true"]');
		if (color) {
			expect(dot?.classList.contains(color)).toBe(true);
			expect(dot?.classList.contains("animate-pulse")).toBe(pulsing);
		} else {
			expect(dot).toBeNull();
		}
	});

	it("keeps rename input and metadata host-owned", async () => {
		const onKeyDown = vi.fn();
		await act(async () =>
			root.render(
				<>
					<AgentSessionRowEditor active>
						<input defaultValue="Rename" onKeyDown={onKeyDown} />
						<span>Saving</span>
					</AgentSessionRowEditor>
					<AgentSessionOverview
						title="Task"
						items={[
							["Workspace", "repo", "/projects/repo"],
							["Cost", "$1.20"],
						]}
					/>
				</>,
			),
		);
		const input = container.querySelector("input");
		if (!input) throw new Error("Missing host rename input");
		await act(async () =>
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			),
		);
		expect(onKeyDown).toHaveBeenCalledOnce();
		expect(input.parentElement?.children.length).toBe(2);
		expect(
			container.querySelector('[title="/projects/repo"]')?.textContent,
		).toBe("repo");
		expect(container.textContent).toContain("Cost$1.20");
	});
});
