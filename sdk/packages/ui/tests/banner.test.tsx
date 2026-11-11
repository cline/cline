// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Banner } from "../components/banner.js";
import { createDomFixture } from "./dom-test-utils.js";

const dom = createDomFixture();
const { render } = dom;

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("Banner", () => {
	it("adjusts wrapped actions only while dismissal is available", async () => {
		const observe = vi.fn();
		const disconnect = vi.fn();
		vi.stubGlobal(
			"ResizeObserver",
			class {
				observe = observe;
				disconnect = disconnect;
			},
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
			dom.container.querySelector('[data-slot="banner-actions"]');

		await render(view(false));
		expect(observe).not.toHaveBeenCalledWith(dom.container.firstElementChild);
		expect(actionRow()?.hasAttribute("data-wrapped")).toBe(false);

		await render(view(true));
		expect(observe).toHaveBeenCalledWith(dom.container.firstElementChild);
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
		expect(dom.container.querySelector(".cline-ui-banner__body")).toBeNull();
		await render(<Banner description={0} />);
		expect(
			dom.container.querySelector('[data-slot="banner-description"]')
				?.textContent,
		).toBe("0");
	});

	it("announces notices as status updates and errors as alerts", async () => {
		await render(
			<Banner title="Connection notice" description="Check your account." />,
		);
		expect(dom.container.firstElementChild?.getAttribute("role")).toBe(
			"status",
		);
		expect(dom.container.textContent).toBe(
			"Connection noticeCheck your account.",
		);
		await render(<Banner tone="error">Connection failed.</Banner>);
		expect(dom.container.firstElementChild?.getAttribute("role")).toBe("alert");
	});

	it("allows hosts to override announcements for static or repeated notices", async () => {
		await render(
			<Banner tone="error" role="note" aria-live="off">
				An existing configuration issue.
			</Banner>,
		);
		expect(dom.container.firstElementChild?.getAttribute("role")).toBe("note");
		expect(dom.container.firstElementChild?.getAttribute("aria-live")).toBe(
			"off",
		);
	});

	it("supports description-only children and respects an explicit description", async () => {
		await render(<Banner>Unable to save.</Banner>);
		expect(
			dom.container.querySelector('[data-slot="banner-description"]')
				?.textContent,
		).toBe("Unable to save.");
		expect(
			dom.container.querySelector('[data-slot="banner-title"]'),
		).toBeNull();
		await render(
			<Banner description={<a href="/settings">Open settings</a>}>
				Unused fallback
			</Banner>,
		);
		expect(dom.container.textContent).toBe("Open settings");
		expect(dom.container.querySelector("a")?.getAttribute("href")).toBe(
			"/settings",
		);
		await render(<Banner description={null}>Unused fallback</Banner>);
		expect(dom.container.textContent).toBe("");
	});

	it("forwards action names and disabled state", async () => {
		await render(
			<Banner
				actions={[
					{
						id: "connect",
						label: "Connected",
						"aria-label": "Connect account",
						disabled: true,
					},
				]}
			/>,
		);
		const button = dom.container.querySelector("button");
		expect(button?.disabled).toBe(true);
		expect(button?.getAttribute("aria-label")).toBe("Connect account");
		expect(button?.textContent).toBe("Connected");
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
		const [retry, remove] = dom.container.querySelectorAll("button");
		expect(retry.classList.contains("cline-ui-button-neutral")).toBe(true);
		expect(remove.classList.contains("cline-ui-button-destructive")).toBe(true);
	});

	it("keeps dismissal optional and independent without hiding itself or submitting a form", async () => {
		await render(
			<Banner dismissLabel="Close notice">Connection notice.</Banner>,
		);
		expect(dom.container.querySelector("button")).toBeNull();

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
		const retry = dom.container.querySelector<HTMLButtonElement>(
			'[data-slot="banner-actions"] button',
		);
		const dismiss = dom.container.querySelector<HTMLButtonElement>(
			'button[aria-label="Dismiss connection notice"]',
		);
		const banner = dom.container.querySelector('[data-slot="banner"]');
		await act(async () => retry?.click());
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onDismiss).not.toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();

		await act(async () => dismiss?.click());
		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(dom.container.querySelector('[data-slot="banner"]')).toBe(banner);
		expect(banner?.hasAttribute("hidden")).toBe(false);
	});
});
