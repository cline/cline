// @vitest-environment jsdom
import { act, createRef, type ReactNode, useState } from "react";
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
});
async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

describe("Banner", () => {
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
		expect(container.querySelector('[role="alert"]')).toBeNull();
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
		await render(
			<form>
				<Example />
			</form>,
		);
		const button = container.querySelector<HTMLButtonElement>("button");
		expect(button?.type).toBe("button");
		expect(button?.disabled).toBe(false);
		expect(button?.getAttribute("aria-label")).toBe("Connect account");
		await act(async () => button?.click());
		expect(button?.disabled).toBe(true);
		expect(button).toBe(container.querySelector("button"));
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
		expect(container.querySelector(".cline-ui-button-accent")).toBeNull();
		expect(remove.hasAttribute("destructive")).toBe(false);
	});

	it("omits the action row when no actions are provided", async () => {
		await render(<Banner actions={[]}>No actions available.</Banner>);
		expect(container.querySelector('[data-slot="banner-actions"]')).toBeNull();
	});

	it("offers dismissal only with a callback and leaves visibility to the host", async () => {
		await render(
			<Banner dismissLabel="Close notice">Connection notice.</Banner>,
		);
		expect(container.querySelector("button")).toBeNull();

		const onDismiss = vi.fn();
		await render(<Banner onDismiss={onDismiss}>Connection notice.</Banner>);
		const banner = container.querySelector('[data-slot="banner"]');
		const dismiss = container.querySelector<HTMLButtonElement>(
			'button[aria-label="Dismiss banner"]',
		);
		expect(dismiss).not.toBeNull();
		await act(async () => dismiss?.click());
		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(container.querySelector('[data-slot="banner"]')).toBe(banner);
		expect(banner?.hasAttribute("hidden")).toBe(false);
	});

	it("keeps dismissal independent from actions without submitting a form", async () => {
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
		await act(async () => retry?.click());
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onDismiss).not.toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();

		await act(async () => dismiss?.click());
		expect(onDismiss).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("forwards native attributes and refs without swallowing accessibility or hidden state", async () => {
		const ref = createRef<HTMLDivElement>();
		await render(
			<Banner
				ref={ref}
				id="connection-notice"
				className="host-banner"
				style={{ maxWidth: 320 }}
				aria-label="Account status"
				hidden
			>
				Connected
			</Banner>,
		);
		expect(ref.current).toBe(container.firstElementChild);
		expect(ref.current?.id).toBe("connection-notice");
		expect(ref.current?.classList.contains("host-banner")).toBe(true);
		expect(ref.current?.style.maxWidth).toBe("320px");
		expect(ref.current?.getAttribute("aria-label")).toBe("Account status");
		expect(ref.current?.hidden).toBe(true);
	});
});
