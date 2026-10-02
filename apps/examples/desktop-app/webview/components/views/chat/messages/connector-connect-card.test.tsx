// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposioStatusResponse } from "@/lib/composio-types";
import { ConnectorConnectCards } from "./connector-connect-card";

const fetchComposioStatus =
	vi.fn<(options?: { refresh?: boolean }) => Promise<ComposioStatusResponse>>();
const openExternalUrl = vi.fn<(url: string) => Promise<void>>();

vi.mock("@/lib/composio", () => ({
	fetchComposioStatus: (options?: { refresh?: boolean }) =>
		fetchComposioStatus(options),
}));
vi.mock("@/lib/desktop-client", () => ({
	openExternalUrl: (url: string) => openExternalUrl(url),
}));

const GMAIL_LINK = "https://connect.composio.dev/link/gmail-abc";

function status(
	gmailStatus: "not_connected" | "connected",
): ComposioStatusResponse {
	return {
		configured: true,
		integrations: [
			{
				toolkit: "gmail",
				name: "Gmail",
				description: "Read, search, draft, and send email.",
				recommended: true,
				status: gmailStatus,
				logo: "https://logos.composio.dev/api/gmail",
			},
		],
	};
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.useFakeTimers();
	fetchComposioStatus.mockReset();
	openExternalUrl.mockReset().mockResolvedValue();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
});

async function render() {
	await act(async () => {
		root.render(
			<ConnectorConnectCards
				links={[{ toolkit: "gmail", redirectUrl: GMAIL_LINK }]}
			/>,
		);
	});
}

function connectButton(): HTMLButtonElement | undefined {
	return [...container.querySelectorAll("button")].find((button) =>
		button.textContent?.includes("Connect"),
	);
}

describe("ConnectorConnectCards", () => {
	it("opens the Connect Link in the browser and waits for the connection", async () => {
		fetchComposioStatus.mockResolvedValue(status("not_connected"));
		await render();

		expect(container.textContent).toContain("Gmail");
		expect(container.textContent).toContain("Read, search, draft");
		// A local read, then one reconciliation with Composio; no polling
		// before the user acts.
		expect(fetchComposioStatus.mock.calls).toEqual([
			[undefined],
			[{ refresh: true }],
		]);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(12_000);
		});
		expect(fetchComposioStatus).toHaveBeenCalledTimes(2);

		await act(async () => {
			connectButton()?.click();
		});
		expect(openExternalUrl).toHaveBeenCalledWith(GMAIL_LINK);
		expect(container.textContent).toContain("Finish connecting Gmail");

		fetchComposioStatus.mockResolvedValue(status("connected"));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(4_000);
		});
		expect(fetchComposioStatus).toHaveBeenCalledTimes(3);
		expect(fetchComposioStatus).toHaveBeenLastCalledWith({ refresh: true });
		expect(container.textContent).toContain("Connected");
		expect(connectButton()).toBeUndefined();

		// Polling stops once the connection landed.
		const calls = fetchComposioStatus.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(12_000);
		});
		expect(fetchComposioStatus.mock.calls.length).toBe(calls);
	});

	it("shows a toolkit connected elsewhere as connected after reconciling", async () => {
		// Local state has not seen the connection yet; the refresh imports it.
		fetchComposioStatus.mockImplementation(async (options) =>
			status(options?.refresh ? "connected" : "not_connected"),
		);
		await render();

		expect(container.textContent).toContain("Connected");
		expect(connectButton()).toBeUndefined();
		expect(fetchComposioStatus).toHaveBeenCalledTimes(2);
	});

	it("names toolkits the status does not know about", async () => {
		fetchComposioStatus.mockResolvedValue({
			configured: true,
			integrations: [],
		});
		await act(async () => {
			root.render(
				<ConnectorConnectCards
					links={[{ toolkit: "slack", redirectUrl: "https://x.test/slack" }]}
				/>,
			);
		});
		expect(container.textContent).toContain("Slack");
		expect(container.textContent).toContain("Connect your Slack account");
	});
});
