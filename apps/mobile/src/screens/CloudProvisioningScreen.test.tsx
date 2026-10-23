import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloudStartStore } from "@/state/cloud-starts";
import { render } from "../ui/__testing__/render";
import { containsText } from "./__testing__/harness";
import { CloudProvisioningScreen } from "./CloudProvisioningScreen";

beforeEach(() => act(() => cloudStartStore.clear()));

describe("CloudProvisioningScreen", () => {
	it("opens All sessions with the chat sidebar icon while the start keeps running", async () => {
		let finish!: (descriptor: {
			mode: "cloud";
			url: string;
			remoteSessionId: string;
		}) => void;
		const provision = new Promise<{
			mode: "cloud";
			url: string;
			remoteSessionId: string;
		}>((resolve) => {
			finish = resolve;
		});
		const jobId = cloudStartStore.start({
			target: {
				id: "target",
				mode: "cloud",
				repoUrl: "https://github.com/cline/cline",
				label: "cline/cline",
				modelId: "cline/model",
			},
			message: "Keep starting in the background",
			provision: () => provision,
		});
		const onBack = vi.fn();
		const onReady = vi.fn();
		const screen = render(
			<CloudProvisioningScreen
				jobId={jobId}
				onBack={onBack}
				onReady={onReady}
			/>,
		);
		const sessions = screen.root
			.findAll(
				(node) =>
					typeof node.type === "string" &&
					node.props.accessibilityLabel === "All sessions",
			)
			.at(-1)!;
		expect(sessions).toBeDefined();
		expect(
			screen.root.findAll((node) => node.props.accessibilityLabel === "Back"),
		).toHaveLength(0);
		act(() => sessions.props.onPress());
		expect(onBack).toHaveBeenCalledOnce();
		expect(cloudStartStore.getSnapshot()[0]).toMatchObject({
			id: jobId,
			phase: "provisioning",
		});
		screen.unmount();
		await act(async () => {
			finish({
				mode: "cloud",
				url: "https://sandbox.example/hub",
				remoteSessionId: "remote-background",
			});
			await provision;
		});
		expect(cloudStartStore.getSnapshot()[0]).toMatchObject({
			id: jobId,
			phase: "ready",
		});
		expect(onReady).not.toHaveBeenCalled();
	});

	it("shows the queued prompt immediately and opens the exact ready workspace", async () => {
		let finish:
			| ((descriptor: {
					mode: "cloud";
					url: string;
					remoteSessionId: string;
			  }) => void)
			| undefined;
		const provision = new Promise<{
			mode: "cloud";
			url: string;
			remoteSessionId: string;
		}>((resolve) => {
			finish = resolve;
		});
		const jobId = cloudStartStore.start({
			target: {
				id: "target",
				mode: "cloud",
				repoUrl: "https://github.com/cline/cline",
				label: "cline/cline",
				modelId: "cline/model",
			},
			message: "Fix the failing test",
			provision: () => provision,
		});
		const onReady = vi.fn();
		const { root } = render(
			<CloudProvisioningScreen
				jobId={jobId}
				onBack={() => {}}
				onReady={onReady}
			/>,
		);
		expect(containsText(root, "Fix the failing test")).toBe(true);
		expect(containsText(root, "Starting your workspace…")).toBe(true);
		expect(
			containsText(root, "You can use other sessions while this starts."),
		).toBe(true);
		expect(containsText(root, "Idle")).toBe(false);

		await act(async () => {
			finish?.({
				mode: "cloud",
				url: "https://sandbox.example/hub",
				remoteSessionId: "remote-1",
			});
			await provision;
		});
		expect(onReady).toHaveBeenCalledWith(
			expect.objectContaining({
				phase: "ready",
				message: "Fix the failing test",
				descriptor: expect.objectContaining({ remoteSessionId: "remote-1" }),
			}),
		);
		expect(cloudStartStore.getSnapshot()).toHaveLength(0);
	});

	it("sends an authentication failure back to sign-in without a futile retry", async () => {
		const provision = Promise.reject(
			new Error("Not signed in to Cline Cloud."),
		);
		const jobId = cloudStartStore.start({
			target: {
				id: "target",
				mode: "cloud",
				repoUrl: "https://github.com/cline/cline",
				label: "cline/cline",
				modelId: "cline/model",
			},
			message: "Keep this request",
			provision: () => provision,
		});
		const onBack = vi.fn();
		const { root } = render(
			<CloudProvisioningScreen
				jobId={jobId}
				onBack={onBack}
				onReady={() => {}}
			/>,
		);

		await act(async () => {
			await provision.catch(() => {});
		});

		expect(containsText(root, "Sign in to continue with Cline Cloud.")).toBe(
			true,
		);
		expect(
			containsText(
				root,
				"Your request is saved. Return Home, sign in, then retry it.",
			),
		).toBe(true);
		expect(containsText(root, "Try again")).toBe(false);

		const backToSignIn = root.find(
			(node) => node.props.accessibilityLabel === "Back to sign in",
		);
		act(() => backToSignIn.props.onPress());
		expect(onBack).toHaveBeenCalledOnce();
		expect(cloudStartStore.getSnapshot()[0]).toEqual(
			expect.objectContaining({
				phase: "error",
				message: "Keep this request",
			}),
		);
	});

	it("shows an image-only start instead of an empty conversation bubble", () => {
		const jobId = cloudStartStore.start({
			target: {
				id: "target",
				mode: "cloud",
				repoUrl: "https://github.com/cline/cline",
				label: "cline/cline",
				modelId: "cline/model",
			},
			message: "",
			attachments: { userImages: ["data:image/jpeg;base64,/9j/"] },
			provision: () => new Promise(() => {}),
		});
		const { root } = render(
			<CloudProvisioningScreen
				jobId={jobId}
				onBack={() => {}}
				onReady={() => {}}
			/>,
		);
		expect(containsText(root, "Image attached")).toBe(true);
		expect(containsText(root, "1 image")).toBe(true);
		expect(
			root.findAll(
				(node) => node.props.accessibilityLabel === "Attached image 1",
			),
		).not.toHaveLength(0);
	});
});
