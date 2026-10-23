import { AppState } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ScanHandoffRoute from "../../app/scan";
import { render } from "../ui/__testing__/render";

const camera = vi.hoisted(() => ({
	permission: {
		granted: false,
		canAskAgain: false,
		status: "denied",
		expires: "never",
	},
	requestPermission: vi.fn(),
	getPermission: vi.fn(),
}));

vi.mock("expo-camera", () => {
	const { createElement } = require("react");
	return {
		CameraView: (props: Record<string, unknown>) =>
			createElement("CameraView", props),
		useCameraPermissions: () => [
			camera.permission,
			camera.requestPermission,
			camera.getPermission,
		],
	};
});

function press(root: ReactTestInstance, label: string): void {
	const node = root.findAll(
		(candidate) =>
			typeof candidate.type === "string" &&
			candidate.props.accessibilityLabel === label,
	)[0];
	if (!node) throw new Error(`No pressable labelled "${label}"`);
	node.props.onPress();
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("ScanHandoffRoute camera recovery", () => {
	it("rechecks permission after Settings and opens the scanner when granted", async () => {
		let onAppStateChange: ((state: string) => void) | undefined;
		vi.mocked(AppState.addEventListener).mockImplementation(
			(_event, listener) => {
				onAppStateChange = listener as (state: string) => void;
				return { remove: vi.fn() } as never;
			},
		);
		camera.getPermission.mockImplementation(async () => {
			camera.permission.granted = true;
			camera.permission.status = "granted";
			return { ...camera.permission };
		});
		const { root } = render(<ScanHandoffRoute />);

		await act(async () => press(root, "Scan QR Code"));
		expect(onAppStateChange).toBeDefined();

		await act(async () => {
			onAppStateChange?.("active");
			await Promise.resolve();
		});

		expect(camera.getPermission).toHaveBeenCalledOnce();
		expect(
			root.findAll(
				(node) => typeof node.type === "string" && node.type === "CameraView",
			),
		).toHaveLength(1);
	});
});
