// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CloudProvisioningOutcome,
	PROVISIONING_OPEN_GIVE_UP_ATTEMPTS,
	PROVISIONING_OUTCOME_POLL_MS,
	PROVISIONING_UNKNOWN_GIVE_UP_POLLS,
	useProvisioningOutcome,
} from "./use-provisioning-outcome";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: { invoke: invokeMock },
}));

type HarnessProps = {
	placeholderId?: string;
	onOpenReady: (sessionId: string) => Promise<boolean>;
	onResolved: () => void;
	onError: (message: string) => void;
};

let container: HTMLDivElement;
let root: Root;

function Harness(props: HarnessProps) {
	useProvisioningOutcome(props);
	return null;
}

async function renderHarness(props: HarnessProps) {
	await act(async () => {
		root.render(<Harness {...props} />);
		await Promise.resolve();
	});
}

async function advancePoll() {
	await act(async () => {
		vi.advanceTimersByTime(PROVISIONING_OUTCOME_POLL_MS);
		await Promise.resolve();
		await Promise.resolve();
	});
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	vi.useFakeTimers();
	invokeMock.mockReset();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("useProvisioningOutcome", () => {
	it("opens the ready session and resolves its placeholder", async () => {
		invokeMock.mockResolvedValue({
			status: "ready",
			sessionId: "ses-real",
		} satisfies CloudProvisioningOutcome);
		const onOpenReady = vi.fn(async () => true);
		const onResolved = vi.fn();

		await renderHarness({
			placeholderId: "cloud-provisioning-1",
			onOpenReady,
			onResolved,
			onError: vi.fn(),
		});

		expect(onOpenReady).toHaveBeenCalledWith("ses-real");
		expect(onResolved).toHaveBeenCalledOnce();
		invokeMock.mockClear();
		await advancePoll();
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it("surfaces a failed outcome and stops polling", async () => {
		invokeMock.mockResolvedValue({
			status: "failed",
			message: "Insufficient balance",
		} satisfies CloudProvisioningOutcome);
		const onError = vi.fn();

		await renderHarness({
			placeholderId: "cloud-provisioning-1",
			onOpenReady: vi.fn(async () => true),
			onResolved: vi.fn(),
			onError,
		});

		expect(onError).toHaveBeenCalledWith(
			expect.stringContaining("Insufficient balance"),
		);
		invokeMock.mockClear();
		await advancePoll();
		expect(invokeMock).not.toHaveBeenCalled();
	});

	it("bounds unknown outcomes without resetting on callback changes", async () => {
		invokeMock.mockResolvedValue(null);
		const firstError = vi.fn();
		const latestError = vi.fn();
		const base = {
			placeholderId: "cloud-provisioning-1",
			onOpenReady: vi.fn(async () => true),
			onResolved: vi.fn(),
		};

		await renderHarness({ ...base, onError: firstError });
		for (let i = 1; i < PROVISIONING_UNKNOWN_GIVE_UP_POLLS - 1; i += 1) {
			await advancePoll();
		}
		await renderHarness({
			...base,
			onOpenReady: vi.fn(async () => true),
			onResolved: vi.fn(),
			onError: latestError,
		});
		await advancePoll();

		expect(firstError).not.toHaveBeenCalled();
		expect(latestError).toHaveBeenCalledWith(
			expect.stringContaining("provisioning state was lost"),
		);
	});

	it("stops when a ready session repeatedly cannot be opened", async () => {
		invokeMock.mockResolvedValue({
			status: "ready",
			sessionId: "ses-gone",
		} satisfies CloudProvisioningOutcome);
		const onOpenReady = vi.fn(async () => false);
		const onError = vi.fn();

		await renderHarness({
			placeholderId: "cloud-provisioning-1",
			onOpenReady,
			onResolved: vi.fn(),
			onError,
		});
		for (let i = 1; i < PROVISIONING_OPEN_GIVE_UP_ATTEMPTS; i += 1) {
			await advancePoll();
		}

		expect(onOpenReady).toHaveBeenCalledTimes(
			PROVISIONING_OPEN_GIVE_UP_ATTEMPTS,
		);
		expect(onError).toHaveBeenCalledWith(
			expect.stringContaining("could not be opened automatically"),
		);
	});

	it("recovers after a temporary transport interruption", async () => {
		invokeMock
			.mockRejectedValueOnce(new Error("transport closed"))
			.mockResolvedValueOnce({
				status: "ready",
				sessionId: "ses-real",
			} satisfies CloudProvisioningOutcome);
		const onResolved = vi.fn();

		await renderHarness({
			placeholderId: "cloud-provisioning-1",
			onOpenReady: vi.fn(async () => true),
			onResolved,
			onError: vi.fn(),
		});
		await advancePoll();

		expect(onResolved).toHaveBeenCalledOnce();
	});
});
