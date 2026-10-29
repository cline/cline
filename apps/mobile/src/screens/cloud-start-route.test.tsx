import { useEffect } from "react";
import * as Native from "react-native";
import { act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudSessionGateway } from "@/cloud";
import type { ConnectionDescriptor } from "@/connection";
import { descriptorKey, SavedEndpointsStore } from "@/connection";
import { initialSnapshot } from "@/connection/controller";
import { cloudStartStore } from "@/state/cloud-starts";
import { EndpointsProvider } from "@/state/endpoints";
import { ExecutionTargetStore } from "@/state/execution-target-store";
import { ExecutionTargetsProvider } from "@/state/execution-targets";
import ChatRoute from "../../app/chat";
import { render } from "../ui/__testing__/render";
import type { ChatScreenProps } from "./ChatScreen";
import { CloudProvisioningScreen } from "./CloudProvisioningScreen";
import { SessionSidebar } from "./home/SessionSidebar";

const state = vi.hoisted(() => ({
	key: "",
	connection: vi.fn(),
	chat: vi.fn(),
	replace: vi.fn(),
	setParams: vi.fn(),
	mountChat: vi.fn(),
	unmountChat: vi.fn(),
	dismissTo: vi.fn(),
	focused: true,
}));
vi.mock("expo-router", () => ({
	useFocusEffect: (callback: () => void | (() => void)) =>
		useEffect(callback, [callback]),
	useLocalSearchParams: () => ({ endpointKey: state.key }),
	useRouter: () => ({
		replace: state.replace,
		setParams: state.setParams,
		dismissTo: state.dismissTo,
		back: vi.fn(),
	}),
	useNavigation: () => ({
		addListener: () => () => {},
		isFocused: () => state.focused,
	}),
}));
vi.mock("@/connection", async (original) => ({
	...(await original<typeof import("@/connection")>()),
	useSessionConnection: (...args: unknown[]) => state.connection(...args),
}));
vi.mock("@/screens", () => ({
	ChatScreen: (props: unknown) => {
		useEffect(() => {
			state.mountChat();
			return state.unmountChat;
		}, []);
		state.chat(props);
		return null;
	},
}));
vi.mock("@/cloud", async (original) => ({
	...(await original<typeof import("@/cloud")>()),
	CloudSetupGateway: class {
		listRecommendedModels = async () => [];
	},
}));

beforeEach(() => {
	act(() => cloudStartStore.clear());
	vi.clearAllMocks();
	state.focused = true;
	state.connection.mockReturnValue({
		...initialSnapshot(),
		setApprovalPolicy: vi.fn(),
	});
});
describe("Cloud receipt opened from session history", () => {
	it("preserves sidebar search and identity when route params actually switch conversations", async () => {
		const dimensions = vi
			.spyOn(Native, "useWindowDimensions")
			.mockReturnValue({ width: 1024, height: 844, scale: 2, fontScale: 1 });
		try {
			const endpoints = new SavedEndpointsStore();
			const a: ConnectionDescriptor = {
				mode: "cloud",
				url: "https://core.example/session/A",
				remoteSessionId: "A",
			};
			const b: ConnectionDescriptor = {
				...a,
				url: "https://core.example/session/B",
				remoteSessionId: "B",
			};
			await endpoints.save(a);
			await endpoints.save(b);
			state.key = descriptorKey(a);
			const element = () => (
				<EndpointsProvider store={endpoints}>
					<ChatRoute />
				</EndpointsProvider>
			);
			const screen = render(element());
			await act(async () => {});
			const sidebar = screen.root.findAll(
				(node) => node.type === SessionSidebar,
			)[0]!;
			const search = () =>
				screen.root
					.findAll(
						(node) =>
							typeof node.type === "string" &&
							node.props.accessibilityLabel === "Search sessions",
					)
					.at(-1)!;
			act(() => search().props.onChangeText("retained search"));
			state.setParams.mockImplementation((params) => {
				state.key = params.endpointKey;
				screen.renderer.update(element());
			});
			for (const descriptor of [b, a, b]) {
				await act(async () =>
					sidebar.props.onOpen({ key: descriptorKey(descriptor), descriptor }),
				);
				expect(
					screen.root.findAll((node) => node.type === SessionSidebar)[0],
				).toBe(sidebar);
				expect(search().props.value).toBe("retained search");
				expect(state.connection.mock.lastCall?.[0].remoteSessionId).toBe(
					descriptor.remoteSessionId,
				);
			}
			expect(state.mountChat).toHaveBeenCalledTimes(4);
			expect(state.unmountChat).toHaveBeenCalledTimes(3);
			expect(sidebar.props.activeStatus).toBeUndefined(); // connecting is not Idle
			act(() => sidebar.props.onOpen({ key: descriptorKey(b), descriptor: b }));
			expect(state.setParams).toHaveBeenCalledTimes(3);
			expect(state.replace).not.toHaveBeenCalled();
			screen.unmount();
		} finally {
			state.setParams.mockReset();
			dimensions.mockRestore();
		}
	});
	it("keeps chat and connection inputs stable across resizing, and guards wide navigation during initial submission", async () => {
		let width = 390;
		const dimensions = vi
			.spyOn(Native, "useWindowDimensions")
			.mockImplementation(() => ({
				width,
				height: 844,
				scale: 2,
				fontScale: 1,
			}));
		try {
			const descriptor: ConnectionDescriptor = {
				mode: "cloud",
				url: "https://core.example/session/B",
				remoteSessionId: "B",
			};
			state.key = descriptorKey(descriptor);
			const endpoints = new SavedEndpointsStore();
			await endpoints.save(descriptor);
			const element = () => (
				<EndpointsProvider store={endpoints}>
					<ChatRoute />
				</EndpointsProvider>
			);
			const screen = render(element());
			await act(async () => {});
			const firstConnectionInputs = state.connection.mock.calls[0];
			const chatProps = () => state.chat.mock.lastCall?.[0] as ChatScreenProps;
			width = 874;
			await act(async () => {
				screen.renderer.update(element());
			});
			const phoneSidebar = screen.root.find(
				(node) => node.type === SessionSidebar,
			);
			expect(phoneSidebar.props.presentation).toBe("drawer");
			expect(phoneSidebar.props.open).toBe(false);
			expect(chatProps().onSwitchSession).toBeDefined();
			act(() => chatProps().onSwitchSession?.());
			expect(phoneSidebar.props.open).toBe(true);
			act(() => phoneSidebar.props.onClose());
			expect(phoneSidebar.props.open).toBe(false);
			width = 1024;
			await act(async () => {
				screen.renderer.update(element());
			});
			const sidebar = () =>
				screen.root.findAll(
					(node) => node.type === SessionSidebar && node.props.open,
				);
			expect(sidebar()).toHaveLength(1);
			expect(sidebar()[0]?.props.presentation).toBe("inline");
			expect(chatProps().onSwitchSession).toBeUndefined();
			const sameRow = { key: state.key, descriptor };
			act(() => sidebar()[0]?.props.onOpen(sameRow));
			expect(state.replace).not.toHaveBeenCalled();
			expect(sidebar()).toHaveLength(1);
			act(() => chatProps().onInitialSubmissionBusyChange?.(true));
			expect(sidebar()).toHaveLength(0);
			act(() => chatProps().onInitialSubmissionBusyChange?.(false));
			expect(sidebar()).toHaveLength(1);
			act(() => sidebar()[0]?.props.onClose());
			expect(sidebar()).toHaveLength(0);
			const dismiss = vi.spyOn(Native.Keyboard, "dismiss");
			act(() => chatProps().onSwitchSession?.());
			expect(dismiss).not.toHaveBeenCalled();
			dismiss.mockRestore();
			expect(sidebar()).toHaveLength(1);
			act(() =>
				sidebar()[0]?.props.onOpen({
					key: "other",
					descriptor: { ...descriptor, remoteSessionId: "C" },
				}),
			);
			expect(state.setParams).toHaveBeenCalledOnce();
			expect(state.replace).not.toHaveBeenCalled();
			expect(sidebar()).toHaveLength(1);
			width = 390;
			await act(async () => {
				screen.renderer.update(element());
			});
			expect(sidebar()).toHaveLength(0);
			expect(state.mountChat).toHaveBeenCalledOnce();
			expect(state.unmountChat).not.toHaveBeenCalled();
			for (const args of state.connection.mock.calls) {
				expect(args[0]).toBe(firstConnectionInputs?.[0]);
				expect(args[1]).toBe(firstConnectionInputs?.[1]);
			}
			screen.unmount();
		} finally {
			dimensions.mockRestore();
		}
	});
	it("blocks a competing chat sender through provisioning and durable clear", async () => {
		const descriptor: ConnectionDescriptor = {
			mode: "cloud",
			url: "https://core.example/session/A",
			remoteSessionId: "A",
			pendingInitialMessage: "Send once",
		};
		state.key = descriptorKey(descriptor);
		const endpoints = new SavedEndpointsStore();
		await endpoints.save(descriptor);
		let provisioned = (_value: ConnectionDescriptor) => {};
		let cleared = () => {};
		const saving = new Promise<void>((resolve) => {
			cleared = resolve;
		});
		const launch = vi.fn(async (value: ConnectionDescriptor) => {
			await saving;
			const clean = { ...value };
			delete clean.pendingInitialMessage;
			await endpoints.save(clean);
			return clean;
		});
		const id = cloudStartStore.start({
			target: {
				id: "target",
				mode: "cloud",
				label: "repo",
				repoUrl: "https://github.com/cline/cline",
				modelId: "test",
			},
			message: "Send once",
			provision: () =>
				new Promise((resolve) => {
					provisioned = resolve;
				}),
			launch,
		});
		cloudStartStore.bindDescriptor(id, descriptor);
		const screen = render(
			<EndpointsProvider store={endpoints}>
				<ChatRoute />
			</EndpointsProvider>,
		);
		expect(
			screen.root.findAll((node) => node.type === CloudProvisioningScreen),
		).toHaveLength(1);
		expect(state.connection).not.toHaveBeenCalled();
		await act(async () => {
			provisioned(descriptor);
		});
		expect(launch).toHaveBeenCalledOnce();
		expect(state.connection).not.toHaveBeenCalled();
		await act(async () => {
			cleared();
		});
		expect(state.connection).toHaveBeenCalled();
		expect(state.chat).toHaveBeenLastCalledWith(
			expect.objectContaining({ initialMessage: undefined }),
		);
		expect(state.replace).not.toHaveBeenCalled();
		expect(launch).toHaveBeenCalledOnce();
	});
});

it("saves a chat's accepted model as its account default, but preserves it when the runtime rejects a change", async () => {
	const endpoints = new SavedEndpointsStore();
	const targets = new ExecutionTargetStore();
	await targets.saveCloudModel("personal/model");
	const descriptor: ConnectionDescriptor = {
		mode: "cloud",
		url: "https://core.example/session/model",
		remoteSessionId: "model",
		organizationId: "team",
		modelId: "old/model",
	};
	await endpoints.save(descriptor);
	state.key = descriptorKey(descriptor);
	const updateModel = vi.fn().mockResolvedValue(undefined);
	state.connection.mockReturnValue({
		...initialSnapshot(),
		setApprovalPolicy: vi.fn(),
		updateModel,
	});
	const screen = render(
		<ExecutionTargetsProvider store={targets}>
			<EndpointsProvider store={endpoints}>
				<ChatRoute />
			</EndpointsProvider>
		</ExecutionTargetsProvider>,
	);
	await act(async () => {});
	const props = (): ChatScreenProps => state.chat.mock.lastCall?.[0];
	await act(async () => props().onModelChange?.("accepted/model"));
	expect(targets.get().cloudModelPreferences).toEqual([
		{ organizationId: "team", modelId: "accepted/model" },
		{ modelId: "personal/model" },
	]);
	updateModel.mockRejectedValueOnce(new Error("Model unavailable"));
	await act(async () => {
		await expect(props().onModelChange?.("rejected/model")).rejects.toThrow(
			"Model unavailable",
		);
	});
	expect(targets.get().cloudModelPreferences[0]?.modelId).toBe(
		"accepted/model",
	);
	screen.unmount();
});

it("leaves the active chat after deletion even while endpoint persistence is pending", async () => {
	const persistence = {
		getItem: async () => null,
		setItem: vi.fn(async () => {}),
		deleteItem: async () => {},
	};
	const endpoints = new SavedEndpointsStore(persistence);
	const descriptor: ConnectionDescriptor = {
		mode: "cloud",
		url: "https://core.example/session/deleted-chat",
		remoteSessionId: "deleted-chat",
	};
	await endpoints.save(descriptor);
	state.key = descriptorKey(descriptor);
	const deletion = vi
		.spyOn(CloudSessionGateway.prototype, "deleteRemoteSession")
		.mockResolvedValue(undefined);
	const write = Promise.withResolvers<void>();
	const screen = render(
		<EndpointsProvider store={endpoints}>
			<ChatRoute />
		</EndpointsProvider>,
	);
	try {
		await act(async () => {});
		const sidebar = screen.root.find((node) => node.type === SessionSidebar);
		persistence.setItem.mockReturnValueOnce(write.promise);
		let pending!: Promise<void>;
		await act(async () => {
			pending = sidebar.props.onDeleteSession({
				key: state.key,
				descriptor,
			});
		});
		expect(endpoints.get(state.key)).toBeUndefined();
		await act(async () => {
			write.resolve();
			await pending;
		});
		expect(deletion).toHaveBeenCalledExactlyOnceWith("deleted-chat");
		expect(state.dismissTo).toHaveBeenCalledExactlyOnceWith("/");
	} finally {
		write.resolve();
		screen.unmount();
		deletion.mockRestore();
	}
});

it.each([
	"blurred by newer route",
	"same route changed to B",
])("does not dismiss a newer chat when Stop A completes after %s", async (boundary) => {
	const endpoints = new SavedEndpointsStore();
	const a: ConnectionDescriptor = {
		mode: "cloud",
		url: "https://core.example/session/action-A",
		remoteSessionId: "action-A",
	};
	const b: ConnectionDescriptor = {
		...a,
		url: "https://core.example/session/action-B",
		remoteSessionId: "action-B",
	};
	await endpoints.save(a);
	await endpoints.save(b);
	state.key = descriptorKey(a);
	let finish!: () => void;
	const gate = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const stop = vi
		.spyOn(CloudSessionGateway.prototype, "suspendRemoteSession")
		.mockImplementation(async () => {
			await gate;
		});
	try {
		const element = () => (
			<EndpointsProvider store={endpoints}>
				<ChatRoute />
			</EndpointsProvider>
		);
		const screen = render(element());
		await act(async () => {});
		const sidebar = screen.root.find((node) => node.type === SessionSidebar);
		let pending!: Promise<void>;
		act(() => {
			pending = sidebar.props.onStopWorkspace({
				key: descriptorKey(a),
				descriptor: a,
			});
		});
		if (boundary === "blurred by newer route") state.focused = false;
		else {
			state.key = descriptorKey(b);
			act(() => screen.renderer.update(element()));
		}
		await act(async () => {
			finish();
			await pending;
		});
		expect(stop).toHaveBeenCalledOnce();
		expect(state.dismissTo).not.toHaveBeenCalled();
		expect(endpoints.get(descriptorKey(b))).toBeDefined();
		screen.unmount();
	} finally {
		stop.mockRestore();
	}
});
