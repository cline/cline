// @vitest-environment jsdom
import { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCard } from "../components/item-card.js";
import { Switch } from "../components/switch.js";

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
async function render(node: ReactNode) {
	await act(async () => root.render(node));
}
function primary() {
	return container.querySelector<HTMLButtonElement>(
		'[data-slot="item-card-primary"]',
	)!;
}

describe("ItemCard", () => {
	it("exposes separate root and primary button refs for focus restoration", async () => {
		const rootRef = createRef<HTMLDivElement>();
		const actionRef = createRef<HTMLButtonElement>();
		await render(
			<ItemCard
				ref={rootRef}
				title="Calendar"
				primaryAction={{ ref: actionRef, onClick: () => {} }}
			/>,
		);
		expect(rootRef.current).toBe(container.firstElementChild);
		expect(actionRef.current).toBe(primary());
		await act(async () => actionRef.current?.focus());
		expect(document.activeElement).toBe(primary());
		await render(<ItemCard ref={rootRef} title="Calendar" />);
		expect(actionRef.current).toBeNull();
		expect(rootRef.current).toBe(container.firstElementChild);
	});
	it("uses a named native primary button and keeps all other interactives independent", async () => {
		const open = vi.fn(),
			action = vi.fn(),
			footer = vi.fn(),
			content = vi.fn(),
			toggle = vi.fn();
		await render(
			<ItemCard
				title="Calendar"
				count={3}
				description="Schedule events"
				primaryAction={{ onClick: open }}
				actions={
					<>
						<button type="button" onClick={action}>
							Connect
						</button>
						<Switch aria-label="Enable calendar" onCheckedChange={toggle} />
					</>
				}
				footer={
					<button type="button" onClick={footer}>
						Author
					</button>
				}
			>
				<button type="button" onClick={content}>
					Retry
				</button>
			</ItemCard>,
		);
		expect(primary().type).toBe("button");
		expect(
			container.querySelector('[data-slot="item-card-count"]')?.textContent,
		).toBe("3");
		expect(
			document.getElementById(primary().getAttribute("aria-labelledby")!)
				?.textContent,
		).toBe("Calendar");
		expect(
			document.getElementById(primary().getAttribute("aria-describedby")!)
				?.textContent,
		).toBe("Schedule events");
		expect(primary().querySelector("button, input, a")).toBeNull();
		await act(async () => {
			for (const button of container.querySelectorAll<HTMLButtonElement>(
				'button:not([data-slot="item-card-primary"])',
			))
				button.click();
			container.querySelector<HTMLInputElement>("input")!.click();
		});
		expect(open).not.toHaveBeenCalled();
		expect(action).toHaveBeenCalledOnce();
		expect(footer).toHaveBeenCalledOnce();
		expect(content).toHaveBeenCalledOnce();
		expect(toggle).toHaveBeenCalledWith(true);
		await act(async () => primary().click());
		expect(open).toHaveBeenCalledOnce();
	});
	it("preserves native disabled behavior without disabling independent actions", async () => {
		const open = vi.fn(),
			action = vi.fn();
		await render(
			<ItemCard
				title="Calendar"
				primaryAction={{
					onClick: open,
					disabled: true,
					label: "View Calendar details",
				}}
				actions={
					<button type="button" onClick={action}>
						Cancel
					</button>
				}
			/>,
		);
		expect(primary().disabled).toBe(true);
		expect(primary().getAttribute("aria-label")).toBe("View Calendar details");
		await act(async () => {
			primary().click();
			container
				.querySelector<HTMLButtonElement>(
					'[data-slot="item-card-actions"] button',
				)!
				.click();
		});
		expect(open).not.toHaveBeenCalled();
		expect(action).toHaveBeenCalledOnce();
	});
	it("omits absent and conditional slots instead of reserving empty layout space", async () => {
		const emptySlot = <>{false}</>;
		const emptyChildren = <>{[null, false, undefined]}</>;
		await render(
			<ItemCard
				title="Rule"
				icon={emptySlot}
				description=""
				actions={emptySlot}
				badges={[]}
				footer={emptySlot}
			>
				{emptyChildren}
			</ItemCard>,
		);
		expect(
			container.querySelector(
				'[data-slot="item-card-count"], [data-slot="item-card-content"], [data-slot="item-card-footer"], [data-slot="item-card-actions"], .cline-ui-item-card__icon, .cline-ui-item-card__description, .cline-ui-item-card__badges',
			),
		).toBeNull();
	});
});
