// @vitest-environment jsdom
import { act, createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "../components/empty-state.js";
import { createDomFixture } from "./dom-test-utils.js";

const dom = createDomFixture();
const { render } = dom;

describe("EmptyState", () => {
	it("renders host-owned illustration semantics above the message and actions", async () => {
		await render(
			<EmptyState
				align="center"
				size="lg"
				surface="transparent"
				media={
					<img
						src="illustration.svg"
						alt="A calendar with no scheduled events"
					/>
				}
				title="No schedules"
				description="Create your first schedule."
				action={{ label: "Create schedule", onClick: () => {} }}
			/>,
		);
		const media = dom.container.querySelector(
			'[data-slot="empty-state-media"]',
		);
		expect(media?.querySelector("img")?.alt).toBe(
			"A calendar with no scheduled events",
		);
		expect(media?.closest('[aria-hidden="true"]')).toBeNull();
		expect(dom.container.firstElementChild?.firstElementChild).toBe(media);
		expect(dom.container.querySelector("h3")?.textContent).toBe("No schedules");
		expect(dom.container.querySelector("button")?.textContent).toBe(
			"Create schedule",
		);
		await render(
			<EmptyState
				media={
					<>
						{false}
						{null}
					</>
				}
			>
				No schedules
			</EmptyState>,
		);
		expect(
			dom.container.querySelector('[data-slot="empty-state-media"]'),
		).toBeNull();
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
		expect(ref.current).toBe(dom.container.firstElementChild);
		expect(ref.current?.textContent).toBe("No plugins installed.");
		expect(ref.current?.hidden).toBe(true);
		expect(ref.current?.classList.contains("host-empty")).toBe(true);
		expect(ref.current?.getAttribute("aria-label")).toBe("Plugin inventory");
		expect(
			dom.container.querySelector("h3, button, [role='status']"),
		).toBeNull();
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
		expect(dom.container.querySelector("h4")?.textContent).toBe(
			"No plugins installed",
		);
		expect(dom.container.querySelector("p")?.textContent).toBe(
			"Browse the marketplace.",
		);
		expect(dom.container.textContent).not.toContain("Fallback description");
		expect(dom.container.querySelector("button")).toBeNull();
	});

	it("keeps actions independent, honors disabled state, and never submits a form", async () => {
		const onBrowse = vi.fn();
		const onAdd = vi.fn();
		const onSubmit = vi.fn((event) => event.preventDefault());
		const view = (disabled?: "browse" | "add") => (
			<form onSubmit={onSubmit}>
				<EmptyState
					align="center"
					description="No MCP servers found."
					action={{
						label: "Browse marketplace",
						onClick: onBrowse,
						disabled: disabled === "browse",
					}}
					secondaryAction={{
						label: "Add MCP Server",
						onClick: onAdd,
						disabled: disabled === "add",
					}}
				/>
			</form>
		);
		await render(view());
		const [browse, add] =
			dom.container.querySelectorAll<HTMLButtonElement>("button");
		expect(browse?.textContent).toBe("Browse marketplace");
		expect(add?.textContent).toBe("Add MCP Server");
		await act(async () => add?.click());
		expect(onAdd).toHaveBeenCalledOnce();
		expect(onBrowse).not.toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();
		await render(view("add"));
		expect(add?.disabled).toBe(true);
		expect(browse?.disabled).toBe(false);
		await act(async () => {
			browse?.click();
			add?.click();
		});
		expect(onBrowse).toHaveBeenCalledOnce();
		expect(onAdd).toHaveBeenCalledOnce();
		expect(onSubmit).not.toHaveBeenCalled();
		await render(view("browse"));
		expect(browse?.disabled).toBe(true);
		expect(add?.disabled).toBe(false);
		await act(async () => {
			browse?.click();
			add?.click();
		});
		expect(onBrowse).toHaveBeenCalledOnce();
		expect(onAdd).toHaveBeenCalledTimes(2);
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
