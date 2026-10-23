import * as Native from "react-native";
import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StateView } from "@/ui";
import { render } from "@/ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { ChatErrorState } from "./ChatErrorState";

afterEach(() => vi.restoreAllMocks());

describe("ChatErrorState", () => {
	it("keeps recovery actions and technical details available in the compact landscape layout", async () => {
		let width = 874;
		let height = 402;
		vi.spyOn(Native, "useWindowDimensions").mockImplementation(() => ({
			width,
			height,
			scale: 3,
			fontScale: 1,
		}));
		const onRetry = vi.fn();
		const onChooseAnotherSession = vi.fn();
		const props = {
			error: Object.assign(new Error("Connection refused"), {
				code: "hub_connect_failed",
			}),
			onRetry,
			onChooseAnotherSession,
		};
		const { root, renderer } = render(<ChatErrorState {...props} />);
		expect(root.findAll((node) => node.type === StateView)).toHaveLength(0);
		expect(containsText(root, "Can't reach this session")).toBe(true);
		const press = (label: string) =>
			root
				.find(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === label,
				)
				.props.onPress();
		await act(async () => press("Retry"));
		expect(onRetry).toHaveBeenCalledOnce();
		act(() => press("Choose another session"));
		expect(onChooseAnotherSession).toHaveBeenCalledOnce();
		act(() => press("Technical error details, expand"));
		expect(containsText(root, "Connection refused")).toBe(true);
		expect(
			root.findAll((node) => node.type === Native.ScrollView).length,
		).toBeGreaterThan(0);
		act(() => {
			width = 402;
			height = 874;
			renderer.update(<ChatErrorState {...props} />);
		});
		expect(root.findAll((node) => node.type === StateView)).toHaveLength(1);
	});

	it("reserves version advice for protocol errors, not missing sessions", () => {
		const { root } = render(
			<ChatErrorState
				error={Object.assign(new Error("gone"), {
					name: "RemoteSessionExpiredError",
				})}
				onRetry={vi.fn()}
				onNewChat={vi.fn()}
			/>,
		);
		expect(containsText(root, "New chat")).toBe(true);
		expect(containsText(root, "one side is updated")).toBe(false);
	});
	it("invokes actionable Cloud sign-in and catches failures", async () => {
		const onSignIn = vi.fn(async () => {
			throw new Error("Browser could not open");
		});
		const onRetry = vi.fn();
		const { root } = render(
			<ChatErrorState
				connectionKind="cloud"
				error={Object.assign(new Error("expired"), {
					name: "CloudSessionApiError",
					status: 401,
				})}
				onRetry={onRetry}
				onSignIn={onSignIn}
			/>,
		);
		await act(async () =>
			root
				.findAll(
					(node) =>
						typeof node.type === "string" &&
						node.props.accessibilityLabel === "Sign in",
				)
				.at(-1)!
				.props.onPress(),
		);
		expect(onSignIn).toHaveBeenCalledOnce();
		expect(onRetry).not.toHaveBeenCalled();
		expect(containsText(root, "Browser could not open")).toBe(true);
	});
	it("renders both Connect GitHub and retry for a missing integration", () => {
		const { root } = render(
			<ChatErrorState
				error={Object.assign(new Error("GitHub missing"), {
					name: "GitHubIntegrationRequiredError",
				})}
				onRetry={vi.fn()}
				onConnectGitHub={vi.fn()}
			/>,
		);
		expect(containsText(root, "Connect GitHub")).toBe(true);
		expect(containsText(root, "Retry")).toBe(true);
	});
});
