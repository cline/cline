// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteEnvironmentProfile } from "@/lib/remote-environments";
import {
	buildEnvironmentSelectorModel,
	EnvironmentSelector,
} from "./environment-selector";

const profiles: RemoteEnvironmentProfile[] = [
	{
		id: "pi-server",
		name: "Raspberry Pi",
		host: "pi.example.com",
		user: "pi",
	},
	{
		id: "build-box",
		name: "Build box",
		host: "builder.example.com",
		user: "ubuntu",
		port: 2200,
	},
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	if (!("ResizeObserver" in globalThis)) {
		Object.assign(globalThis, {
			ResizeObserver: class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		});
	}
	Element.prototype.scrollIntoView ??= () => {};
	Element.prototype.hasPointerCapture ??= () => false;
	Element.prototype.setPointerCapture ??= () => {};
	Element.prototype.releasePointerCapture ??= () => {};
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

async function click(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);
		await Promise.resolve();
	});
}

async function pointerDown(element: Element): Promise<void> {
	await act(async () => {
		element.dispatchEvent(
			new MouseEvent("pointerdown", {
				bubbles: true,
				cancelable: true,
				button: 0,
			}),
		);
		await Promise.resolve();
	});
}

function trigger(): HTMLButtonElement {
	const element = container.querySelector<HTMLButtonElement>(
		"#environment-selector-btn",
	);
	expect(element).not.toBeNull();
	return element as HTMLButtonElement;
}

function menuItemContaining(text: string): HTMLElement {
	const item = Array.from(
		document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
	).find((candidate) => candidate.textContent?.includes(text));
	expect(item).toBeDefined();
	return item as HTMLElement;
}

describe("buildEnvironmentSelectorModel", () => {
	it("builds a sorted remote catalog and identifies the connected profile", () => {
		const model = buildEnvironmentSelectorModel("pi-server", [
			...profiles,
			{ ...profiles[0], name: "Duplicate Pi" },
			{ ...profiles[0], id: undefined, name: "Unsaved" },
		]);

		expect(model).toMatchObject({
			activeKind: "remote",
			activeLabel: "Raspberry Pi",
			local: { id: "local", selected: false },
		});
		expect(model.remotes).toEqual([
			expect.objectContaining({
				id: "build-box",
				label: "Build box",
				destination: "ubuntu@builder.example.com:2200",
				selected: false,
			}),
			expect.objectContaining({
				id: "pi-server",
				label: "Raspberry Pi",
				status: "Connected",
				selected: true,
			}),
		]);
	});

	it("does not mislabel an unloaded remote environment as Local", () => {
		expect(buildEnvironmentSelectorModel("remote-loading", [])).toMatchObject({
			activeKind: "remote",
			activeLabel: "Remote SSH",
			local: { selected: false },
		});
	});
});

describe("EnvironmentSelector", () => {
	it("renders every environment tier and routes selections and host setup", async () => {
		const onSelectEnvironment = vi.fn(async () => undefined);
		const onAddSshHost = vi.fn();
		await act(async () => {
			root.render(
				<EnvironmentSelector
					activeEnvironmentId="pi-server"
					onAddSshHost={onAddSshHost}
					onSelectEnvironment={onSelectEnvironment}
					profiles={profiles}
				/>,
			);
		});

		expect(trigger().textContent?.trim()).toBe("");
		expect(trigger().getAttribute("aria-label")).toBe(
			"Environment: Raspberry Pi",
		);
		expect(trigger().title).toBe("Environment: Raspberry Pi");
		expect(document.body.textContent).not.toContain("Raspberry Pi");
		await pointerDown(trigger());
		expect(document.body.textContent).toContain("Raspberry Pi");
		expect(document.body.textContent).toContain("Local");
		expect(document.body.textContent).toContain("Remote SSH");
		expect(document.body.textContent).toContain("Build box");
		expect(document.body.textContent).not.toContain(
			"ubuntu@builder.example.com:2200",
		);
		expect(document.body.textContent).toContain("Connected");
		expect(document.body.textContent).toContain("Cloud");
		expect(document.body.textContent).toContain("Coming soon");
		expect(
			menuItemContaining("Cloud").getAttribute("data-disabled"),
		).not.toBeNull();

		await click(menuItemContaining("Local"));
		await vi.waitFor(() => {
			expect(onSelectEnvironment).toHaveBeenCalledWith("local");
		});

		await pointerDown(trigger());
		await click(document.querySelector('[aria-label="Add SSH host"]')!);
		expect(onAddSshHost).toHaveBeenCalledTimes(1);
	});

	it("selects Cloud when enabled and returns through the same menu", async () => {
		const onSelectEnvironment = vi.fn(async () => undefined);
		const onSelectExecutionTarget = vi.fn(async () => undefined);
		await act(async () => {
			root.render(
				<EnvironmentSelector
					activeEnvironmentId="local"
					cloudEnabled
					onAddSshHost={vi.fn()}
					onSelectEnvironment={onSelectEnvironment}
					onSelectExecutionTarget={onSelectExecutionTarget}
					profiles={profiles}
				/>,
			);
		});

		await pointerDown(trigger());
		const cloudItem = menuItemContaining("Cloud");
		expect(cloudItem.textContent).not.toContain("Coming soon");
		expect(cloudItem.getAttribute("data-disabled")).toBeNull();
		await click(cloudItem);
		expect(onSelectExecutionTarget).toHaveBeenCalledWith("cloud");

		await act(async () => {
			root.render(
				<EnvironmentSelector
					activeEnvironmentId="local"
					cloudEnabled
					executionTarget="cloud"
					onAddSshHost={vi.fn()}
					onSelectEnvironment={onSelectEnvironment}
					onSelectExecutionTarget={onSelectExecutionTarget}
					profiles={profiles}
				/>,
			);
		});

		expect(trigger().getAttribute("aria-label")).toBe("Environment: Cloud");
		await pointerDown(trigger());
		expect(menuItemContaining("Cloud").getAttribute("aria-current")).toBe(
			"true",
		);
		await click(menuItemContaining("Local"));
		expect(onSelectExecutionTarget).toHaveBeenLastCalledWith("local");
		expect(onSelectEnvironment).not.toHaveBeenCalled();
	});

	it("reopens the menu after a rejected environment switch", async () => {
		const onSelectEnvironment = vi
			.fn()
			.mockRejectedValue(new Error("SSH unavailable"));
		await act(async () => {
			root.render(
				<EnvironmentSelector
					activeEnvironmentId="local"
					onAddSshHost={vi.fn()}
					onSelectEnvironment={onSelectEnvironment}
					profiles={profiles}
				/>,
			);
		});

		await pointerDown(trigger());
		await click(menuItemContaining("Build box"));
		await vi.waitFor(() => {
			expect(onSelectEnvironment).toHaveBeenCalledWith("build-box");
			expect(menuItemContaining("Build box")).toBeDefined();
		});
		expect(trigger().disabled).toBe(false);
	});
});
