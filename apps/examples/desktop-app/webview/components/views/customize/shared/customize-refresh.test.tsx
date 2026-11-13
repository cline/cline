// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CustomizeRefreshButton,
	CustomizeRefreshProvider,
	useCustomizeRefresh,
} from "./customize-refresh";

type Category = { name: string; refresh: () => Promise<void> };

function CategoryRefresh({ name, refresh }: Category) {
	const sharedRefresh = useCustomizeRefresh(refresh);
	return sharedRefresh ? null : (
		<button onClick={() => void refresh()} type="button">
			Refresh {name}
		</button>
	);
}

function ManageRefresh({
	enabled,
	categories,
}: {
	enabled: boolean;
	categories: Category[];
}) {
	return (
		<CustomizeRefreshProvider enabled={enabled}>
			<CustomizeRefreshButton />
			{categories.map((category) => (
				<CategoryRefresh key={category.name} {...category} />
			))}
		</CustomizeRefreshProvider>
	);
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.unstubAllGlobals();
});

function sharedButton() {
	return container.querySelector<HTMLButtonElement>(
		'[aria-label="Refresh customizations"]',
	);
}

describe("shared Customize refresh", () => {
	it("refreshes every category once and stays busy until all settle, including failures", async () => {
		let rejectConnectors!: (reason: Error) => void;
		let finishTools!: () => void;
		const refreshConnectors = vi.fn(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectConnectors = reject;
				}),
		);
		const refreshTools = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishTools = resolve;
				}),
		);
		await act(async () => {
			root.render(
				<ManageRefresh
					enabled
					categories={[
						{ name: "Connectors", refresh: refreshConnectors },
						{ name: "Tools", refresh: refreshTools },
					]}
				/>,
			);
		});
		expect(container.querySelectorAll("button")).toHaveLength(1);
		const button = sharedButton();
		if (!button) throw new Error("Missing shared refresh button");
		await act(async () => {
			button.click();
			button.click();
		});
		expect(refreshConnectors).toHaveBeenCalledOnce();
		expect(refreshTools).toHaveBeenCalledOnce();
		expect(button.disabled).toBe(true);
		expect(button.getAttribute("aria-busy")).toBe("true");

		await act(async () =>
			rejectConnectors(new Error("Connectors unavailable")),
		);
		expect(button.disabled).toBe(true);
		expect(button.getAttribute("aria-busy")).toBe("true");

		await act(async () => finishTools());
		expect(button.disabled).toBe(false);
		expect(button.getAttribute("aria-busy")).not.toBe("true");
	});

	it("restores local controls when disabled and removes handlers when categories change or unmount", async () => {
		const refreshConnectors = vi.fn(async () => {});
		const refreshTools = vi.fn(async () => {});
		const refreshSkills = vi.fn(async () => {});
		await act(async () => {
			root.render(
				<ManageRefresh
					enabled
					categories={[
						{ name: "Connectors", refresh: refreshConnectors },
						{ name: "Tools", refresh: refreshTools },
					]}
				/>,
			);
		});

		await act(async () => {
			root.render(
				<ManageRefresh
					enabled={false}
					categories={[{ name: "Tools", refresh: refreshTools }]}
				/>,
			);
		});
		expect(sharedButton()).toBeNull();
		const localButtons = container.querySelectorAll("button");
		expect(localButtons).toHaveLength(1);
		expect(localButtons[0].textContent).toBe("Refresh Tools");
		await act(async () => localButtons[0].click());
		expect(refreshTools).toHaveBeenCalledOnce();

		await act(async () => {
			root.render(
				<ManageRefresh
					enabled
					categories={[{ name: "Skills", refresh: refreshSkills }]}
				/>,
			);
		});
		expect(container.querySelectorAll("button")).toHaveLength(1);
		await act(async () => sharedButton()?.click());
		expect(refreshSkills).toHaveBeenCalledOnce();
		expect(refreshConnectors).not.toHaveBeenCalled();
		expect(refreshTools).toHaveBeenCalledOnce();

		await act(async () => {
			root.render(<ManageRefresh enabled categories={[]} />);
		});
		await act(async () => sharedButton()?.click());
		expect(refreshSkills).toHaveBeenCalledOnce();
		expect(refreshConnectors).not.toHaveBeenCalled();
		expect(refreshTools).toHaveBeenCalledOnce();
	});
});
