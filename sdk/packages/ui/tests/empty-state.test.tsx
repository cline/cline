// @vitest-environment jsdom
import { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmptyState } from "../components/empty-state.js";

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

describe("EmptyState", () => {
	it("omits empty message slots without dropping numeric descriptions", async () => {
		await render(
			<EmptyState
				title=""
				description={
					<>
						{false}
						{true}
					</>
				}
			/>,
		);
		expect(
			container.querySelector(".cline-ui-empty-state__message"),
		).toBeNull();
		await render(<EmptyState title={false} description={0} />);
		expect(
			container.querySelector('[data-slot="empty-state-title"]'),
		).toBeNull();
		expect(
			container.querySelector('[data-slot="empty-state-description"]')
				?.textContent,
		).toBe("0");
	});

	it("preserves existing description-only children and forwards native root props", async () => {
		const ref = createRef<HTMLDivElement>();
		await render(
			<EmptyState
				ref={ref}
				className="host-empty"
				aria-label="Plugin inventory"
				hidden
			>
				No plugins installed.
			</EmptyState>,
		);
		expect(ref.current).toBe(container.firstElementChild);
		expect(ref.current?.textContent).toBe("No plugins installed.");
		expect(ref.current?.dataset.align).toBe("left");
		expect(ref.current?.hidden).toBe(true);
		expect(ref.current?.classList.contains("host-empty")).toBe(true);
		expect(ref.current?.getAttribute("aria-label")).toBe("Plugin inventory");
		expect(container.querySelector("h3, button, [role='status']")).toBeNull();
	});

	it("supports a centered title with an explicit description instead of fallback children", async () => {
		await render(
			<EmptyState
				align="center"
				title="No plugins installed"
				headingLevel={4}
				description={<p>Browse the marketplace.</p>}
			>
				Fallback description
			</EmptyState>,
		);
		expect(container.firstElementChild?.getAttribute("data-align")).toBe(
			"center",
		);
		expect(container.firstElementChild?.hasAttribute("title")).toBe(false);
		expect(container.querySelector("h4")?.textContent).toBe(
			"No plugins installed",
		);
		expect(container.querySelector("p")?.textContent).toBe(
			"Browse the marketplace.",
		);
		expect(container.textContent).not.toContain("Fallback description");
		expect(container.querySelector("button")).toBeNull();
	});

	it("runs its neutral secondary action without submitting a form and respects disabled state", async () => {
		const onAction = vi.fn();
		const onSubmit = vi.fn((event) => event.preventDefault());
		const view = (disabled = false) => (
			<form onSubmit={onSubmit}>
				<EmptyState
					description="No rules found."
					action={{ label: "Add rule", onClick: onAction, disabled }}
				/>
			</form>
		);
		await render(view());
		const button = container.querySelector<HTMLButtonElement>("button");
		expect(button?.type).toBe("button");
		expect(button?.classList.contains("cline-ui-button-neutral")).toBe(true);
		expect(button?.classList.contains("cline-ui-button-secondary")).toBe(true);
		await act(async () => button?.click());
		expect(onAction).toHaveBeenCalledOnce();
		expect(onSubmit).not.toHaveBeenCalled();
		await render(view(true));
		expect(button?.disabled).toBe(true);
		await act(async () => button?.click());
		expect(onAction).toHaveBeenCalledOnce();
	});
});
