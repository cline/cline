// @vitest-environment jsdom
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Banner } from "../components/banner.js";

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
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

describe("Banner", () => {
	it("adjusts wrapped actions only while dismissal is available", async () => {
		const observe = vi.fn();
		const disconnect = vi.fn();
		vi.stubGlobal(
			"ResizeObserver",
			vi.fn(function () {
				return { observe, disconnect };
			}),
		);
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
			function (this: HTMLElement) {
				return new DOMRect(
					0,
					this.matches('[data-slot="banner-actions"]') ? 40 : 0,
					200,
					32,
				);
			},
		);
		const view = (dismissible: boolean) => (
			<Banner
				title="Connection notice"
				actions={[{ id: "retry", label: "Retry" }]}
				onDismiss={dismissible ? () => {} : undefined}
			/>
		);
		const actionRow = () =>
			container.querySelector('[data-slot="banner-actions"]');

		await render(view(false));
		expect(observe).not.toHaveBeenCalledWith(container.firstElementChild);
		expect(actionRow()?.hasAttribute("data-wrapped")).toBe(false);

		await render(view(true));
		expect(observe).toHaveBeenCalledWith(container.firstElementChild);
		expect(actionRow()?.getAttribute("data-wrapped")).toBe("true");

		await render(view(false));
		expect(actionRow()?.hasAttribute("data-wrapped")).toBe(false);
		expect(disconnect).toHaveBeenCalled();
	});

	it("omits structurally empty content and preserves numeric notices", async () => {
		await render(
			<Banner
				title=""
				description={
					<>
						{false}
						{true}
					</>
				}
				icon={[]}
			/>,
		);
		expect(container.querySelector(".cline-ui-banner__body")).toBeNull();
		await render(<Banner description={0} />);
		expect(
			container.querySelector('[data-slot="banner-description"]')?.textContent,
		).toBe("0");
	});

	it("announces notices as status updates and errors as alerts", async () => {
		await render(
			<Banner title="Connection notice" description="Check your account." />,
		);
		expect(container.firstElementChild?.getAttribute("role")).toBe("status");
		expect(container.textContent).toBe("Connection noticeCheck your account.");
		await render(<Banner tone="error">Connection failed.</Banner>);
		expect(container.firstElementChild?.getAttribute("role")).toBe("alert");
	});

	it("allows hosts to override announcements for static or repeated notices", async () => {
		await render(
			<Banner tone="error" role="note" aria-live="off">
				An existing configuration issue.
			</Banner>,
		);
		expect(container.firstElementChild?.getAttribute("role")).toBe("note");
		expect(container.firstElementChild?.getAttribute("aria-live")).toBe("off");
	});

	it("supports description-only children and respects an explicit description", async () => {
		await render(<Banner>Unable to save.</Banner>);
		expect(
			container.querySelector('[data-slot="banner-description"]')?.textContent,
		).toBe("Unable to save.");
		expect(container.querySelector('[data-slot="banner-title"]')).toBeNull();
		await render(
			<Banner description={<a href="/settings">Open settings</a>}>
				Unused fallback
			</Banner>,
		);
		expect(container.textContent).toBe("Open settings");
		expect(container.querySelector("a")?.getAttribute("href")).toBe(
			"/settings",
		);
		await render(<Banner description={null}>Unused fallback</Banner>);
		expect(container.textContent).toBe("");
	});

	it("leaves action state and behavior in the consumer", async () => {
		function Example() {
			const [connected, setConnected] = useState(false);
			return (
				<Banner
					tone={connected ? "success" : "warning"}
					title={connected ? "Connected" : "Authorization required"}
					actions={[
						{
							id: "connect",
							label: connected ? "Connected" : "Connect",
							"aria-label": "Connect account",
							disabled: connected,
							onClick: () => setConnected(true),
						},
					]}
				/>
			);
		}
		await render(<Example />);
		const button = container.querySelector<HTMLButtonElement>("button");
		expect(button?.disabled).toBe(false);
		expect(button?.getAttribute("aria-label")).toBe("Connect account");
		await act(async () => button?.click());
		expect(button?.disabled).toBe(true);
		expect(button?.textContent).toBe("Connected");
		expect(
			container.querySelector('[data-slot="banner-title"]')?.textContent,
		).toBe("Connected");
	});

	it("keeps destructive actions distinct from ordinary banner actions", async () => {
		await render(
			<Banner
				tone="warning"
				actions={[
					{ id: "retry", label: "Retry" },
					{ id: "remove", label: "Remove", destructive: true },
				]}
			/>,
		);
		const [retry, remove] = container.querySelectorAll("button");
		expect(retry.classList.contains("cline-ui-button-neutral")).toBe(true);
		expect(remove.classList.contains("cline-ui-button-destructive")).toBe(true);
	});

	it("keeps dismissal optional and independent without hiding itself or submitting a form", async () => {
		await render(
			<Banner dismissLabel="Close notice">Connection notice.</Banner>,
		);
		expect(container.querySelector("button")).toBeNull();

		const onDismiss = vi.fn();
		const onRetry = vi.fn();
		const onSubmit = vi.fn();
		await render(
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onSubmit();
				}}
			>
				<Banner
					onDismiss={onDismiss}
					dismissLabel="Dismiss connection notice"
					actions={[{ id: "retry", label: "Retry", onClick: onRetry }]}
				>
					Connection failed.
				</Banner>
			</form>,
		);
		const retry = container.querySelector<HTMLButtonElement>(
			'[data-slot="banner-actions"] button',
		);
		const dismiss = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Dismiss connection notice"]',
		);
		const banner = container.querySelector('[data-slot="banner"]');
		await act(async () => retry?.click());
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onDismiss).not.toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();

		await act(async () => dismiss?.click());
		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(container.querySelector('[data-slot="banner"]')).toBe(banner);
		expect(banner?.hasAttribute("hidden")).toBe(false);
	});
});
