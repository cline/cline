import { NavigationContext } from "expo-router/react-navigation";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CloudSessionApiError,
	CloudSessionGateway,
} from "@/cloud/rest/CloudSessionGateway";
import type { ConnectionDescriptor } from "@/connection";
import { asRemoteSessionId } from "@/session";
import {
	cloudStartStore,
	isCloudStartAuthenticationError,
} from "@/state/cloud-starts";
import { render } from "../ui/__testing__/render";
import { containsText, findByLabel } from "./__testing__/harness";
import { CloudProvisioningScreen } from "./CloudProvisioningScreen";

const target = {
	id: "target",
	mode: "cloud" as const,
	repoUrl: "https://github.com/cline/cline",
	label: "cline/cline",
	modelId: "cline/model",
};
const descriptor: ConnectionDescriptor = {
	mode: "cloud",
	url: "https://api.example/session/one",
	remoteSessionId: "one",
};
const attachments = { userImages: ["data:image/jpeg;base64,/9j/"] };
beforeEach(() => act(() => cloudStartStore.clear()));

describe("provisioning recovery product coverage", () => {
	it("retains a ready job while covered by another route and opens it once on explicit return", async () => {
		let focused = true;
		const listeners = new Map<string, Set<() => void>>();
		const navigation = {
			isFocused: () => focused,
			addListener: (name: string, listener: () => void) => {
				const set = listeners.get(name) ?? new Set<() => void>();
				set.add(listener);
				listeners.set(name, set);
				return () => set.delete(listener);
			},
		};
		let finish!: (value: ConnectionDescriptor) => void;
		const jobId = cloudStartStore.start({
			target,
			message: "Keep this notification-covered request",
			attachments,
			provision: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		});
		const onReady = vi.fn();
		const screen = render(
			<NavigationContext.Provider value={navigation as never}>
				<CloudProvisioningScreen
					jobId={jobId}
					onBack={vi.fn()}
					onReady={onReady}
				/>
			</NavigationContext.Provider>,
		);
		act(() => {
			focused = false;
			for (const listener of listeners.get("blur") ?? []) listener();
		});
		await act(async () => {
			finish(descriptor);
		});
		expect(onReady).not.toHaveBeenCalled();
		expect(cloudStartStore.getSnapshot()[0]).toMatchObject({
			id: jobId,
			phase: "ready",
			message: "Keep this notification-covered request",
			attachments,
		});
		act(() => {
			focused = true;
			for (const listener of listeners.get("focus") ?? []) listener();
		});
		expect(onReady).toHaveBeenCalledOnce();
		expect(onReady.mock.calls[0]?.[0]).toMatchObject({
			id: jobId,
			descriptor,
			attachments,
		});
		expect(cloudStartStore.getSnapshot()).toHaveLength(0);
		act(() => {
			for (const listener of listeners.get("focus") ?? []) listener();
		});
		expect(onReady).toHaveBeenCalledOnce();
		screen.unmount();
	});
	it("uses HTTP401 authority rather than treating generic or HTTP403 permission text as expired sign-in", () => {
		expect(
			isCloudStartAuthenticationError(
				new CloudSessionApiError("Unauthorized", 401),
			),
		).toBe(true);
		expect(
			isCloudStartAuthenticationError(
				new CloudSessionApiError("Unauthorized", 403),
			),
		).toBe(false);
		expect(isCloudStartAuthenticationError(new Error("Unauthorized"))).toBe(
			false,
		);
	});
	it("retains text and image through a safe retry and Back while the same job finishes once", async () => {
		let finish = (_value: ConnectionDescriptor) => {};
		const provision = vi
			.fn()
			.mockRejectedValueOnce(new Error("Repository unavailable before create"))
			.mockImplementationOnce(
				(
					progress: (value: { status: "provisioning"; phase: string }) => void,
				) => {
					progress({ status: "provisioning", phase: "cloning_repo" });
					return new Promise<ConnectionDescriptor>((resolve) => {
						finish = resolve;
					});
				},
			);
		const launch = vi.fn(async (value: ConnectionDescriptor) => value);
		const jobId = cloudStartStore.start({
			target,
			message: "Keep the original caption",
			attachments,
			provision,
			launch,
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
		await act(async () => {
			await vi.waitFor(() =>
				expect(cloudStartStore.getSnapshot()[0]?.phase).toBe("error"),
			);
		});
		act(() => findByLabel(screen.root, "Try again")?.props.onPress());
		expect(provision).toHaveBeenCalledTimes(2);
		expect(containsText(screen.root, "Keep the original caption")).toBe(true);
		expect(Boolean(findByLabel(screen.root, "Attached image 1"))).toBe(true);
		expect(containsText(screen.root, "Cloning your repository…")).toBe(true);
		act(() => findByLabel(screen.root, "All sessions")?.props.onPress());
		expect(onBack).toHaveBeenCalledOnce();
		screen.unmount();
		await act(async () => {
			finish(descriptor);
		});
		expect(cloudStartStore.getSnapshot()[0]).toMatchObject({
			id: jobId,
			phase: "ready",
			submitted: true,
			message: "Keep the original caption",
			attachments,
		});
		expect(launch).toHaveBeenCalledExactlyOnceWith(descriptor);
		expect(onReady).not.toHaveBeenCalled();
		const reopened = render(
			<CloudProvisioningScreen
				jobId={jobId}
				onBack={onBack}
				onReady={onReady}
			/>,
		);
		expect(onReady).toHaveBeenCalledOnce();
		expect(onReady.mock.calls[0]?.[0]).toMatchObject({
			id: jobId,
			message: "Keep the original caption",
			attachments,
			submitted: true,
		});
		act(() =>
			reopened.renderer.update(
				<CloudProvisioningScreen
					jobId={jobId}
					onBack={onBack}
					onReady={onReady}
				/>,
			),
		);
		expect(onReady).toHaveBeenCalledOnce();
		expect(cloudStartStore.getSnapshot()).toHaveLength(0);
	});
	it("recognizes real lifecycle HTTP401 metadata even when its human body omits the status", async () => {
		const gateway = new CloudSessionGateway({
			apiBaseUrl: "https://api.example",
			getAccessToken: async () => "expired-jwt",
			fetchImpl: async () =>
				new Response(
					JSON.stringify({ success: false, error: "Unauthorized" }),
					{ status: 401 },
				),
		});
		const jobId = cloudStartStore.start({
			target,
			message: "Keep the original image request",
			attachments,
			provision: async () => descriptor,
			launch: async () => {
				await gateway.resumeSuspendedSession(asRemoteSessionId("one"));
				return descriptor;
			},
		});
		const onBack = vi.fn();
		const { root } = render(
			<CloudProvisioningScreen
				jobId={jobId}
				onBack={onBack}
				onReady={vi.fn()}
			/>,
		);
		await act(async () => {
			await vi.waitFor(() =>
				expect(cloudStartStore.getSnapshot()[0]?.phase).toBe("error"),
			);
		});
		expect(findByLabel(root, "Back to sign in")).toBeDefined();
		expect(findByLabel(root, "Try again")).toBeUndefined();
		expect(cloudStartStore.getSnapshot()[0]).toMatchObject({
			phase: "error",
			message: "Keep the original image request",
			attachments,
		});
		act(() => findByLabel(root, "Back to sign in")?.props.onPress());
		expect(onBack).toHaveBeenCalledOnce();
	});
	it("opens each ready job once when route parameters reuse the same mounted screen", async () => {
		const first = cloudStartStore.start({
			target,
			message: "First request",
			provision: async () => descriptor,
		});
		await act(async () => {});
		const onReady = vi.fn();
		const screen = render(
			<CloudProvisioningScreen
				jobId={first}
				onBack={vi.fn()}
				onReady={onReady}
			/>,
		);
		expect(onReady).toHaveBeenCalledOnce();
		let second = "";
		await act(async () => {
			second = cloudStartStore.start({
				target,
				message: "Second request",
				attachments,
				provision: async () => ({ ...descriptor, remoteSessionId: "two" }),
			});
			screen.renderer.update(
				<CloudProvisioningScreen
					jobId={second}
					onBack={vi.fn()}
					onReady={onReady}
				/>,
			);
		});
		expect(onReady).toHaveBeenCalledTimes(2);
		expect(onReady.mock.calls[1]?.[0]).toMatchObject({
			id: second,
			message: "Second request",
			attachments,
			descriptor: { remoteSessionId: "two" },
		});
		await act(async () => {
			screen.renderer.update(
				<CloudProvisioningScreen
					jobId={second}
					onBack={vi.fn()}
					onReady={onReady}
				/>,
			);
		});
		expect(onReady).toHaveBeenCalledTimes(2);
	});
	it("gives a missing job a truthful escape instead of a Starting status", () => {
		const onBack = vi.fn();
		const { root } = render(
			<CloudProvisioningScreen
				jobId="retired-job"
				onBack={onBack}
				onReady={vi.fn()}
			/>,
		);
		expect(containsText(root, "This Cloud start is no longer available.")).toBe(
			true,
		);
		expect(Boolean(findByLabel(root, "Starting"))).toBe(false);
		act(() => findByLabel(root, "Back to Home")?.props.onPress());
		expect(onBack).toHaveBeenCalledOnce();
	});
});
