import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	setTaskAlertsEnabled,
	taskAlertsEnabled,
} from "../../notifications/attention-notifications";
import { render } from "../../ui/__testing__/render";
import { containsText, findByLabel } from "../__testing__/harness";
import { TaskAlertSettings } from "./TaskAlertSettings";

vi.mock("../../notifications/attention-notifications", () => ({
	taskAlertsEnabled: vi.fn(),
	setTaskAlertsEnabled: vi.fn(),
}));
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(taskAlertsEnabled).mockResolvedValue(false);
});
describe("task alert settings", () => {
	it("asks permission only after an explicit tap, guards double taps, and explains denial", async () => {
		let answer = (_enabled: boolean) => {};
		vi.mocked(setTaskAlertsEnabled).mockImplementation(
			() =>
				new Promise<boolean>((resolve) => {
					answer = resolve;
				}),
		);
		const screen = render(<TaskAlertSettings />);
		await act(async () => {});
		expect(setTaskAlertsEnabled).not.toHaveBeenCalled();
		act(() => {
			findByLabel(screen.root, "Enable task alerts")?.props.onPress();
			findByLabel(screen.root, "Enable task alerts")?.props.onPress();
		});
		expect(setTaskAlertsEnabled).toHaveBeenCalledExactlyOnceWith(true);
		await act(async () => answer(false));
		expect(containsText(screen.root, "Notifications are disabled")).toBe(true);
		expect(
			findByLabel(screen.root, "Open notification settings"),
		).toBeDefined();
		expect(containsText(screen.root, "puts the app to sleep")).toBe(true);
	});
	it("lets a permission/storage failure be retried and handles unmount during the request", async () => {
		vi.mocked(setTaskAlertsEnabled)
			.mockRejectedValueOnce(new Error("storage failure"))
			.mockResolvedValueOnce(true);
		const screen = render(<TaskAlertSettings />);
		await act(async () => {});
		await act(async () =>
			findByLabel(screen.root, "Enable task alerts")?.props.onPress(),
		);
		expect(containsText(screen.root, "Could not update task alerts")).toBe(
			true,
		);
		await act(async () =>
			findByLabel(screen.root, "Enable task alerts")?.props.onPress(),
		);
		expect(findByLabel(screen.root, "Turn off task alerts")).toBeDefined();
		let finish = (_enabled: boolean) => {};
		vi.mocked(setTaskAlertsEnabled).mockImplementationOnce(
			() =>
				new Promise<boolean>((resolve) => {
					finish = resolve;
				}),
		);
		act(() =>
			findByLabel(screen.root, "Turn off task alerts")?.props.onPress(),
		);
		screen.unmount();
		await act(async () => finish(false));
	});
});
