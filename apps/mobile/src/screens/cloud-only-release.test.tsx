import type GorhomBottomSheet from "@gorhom/bottom-sheet";
import { HubClient } from "@cline/hub-client";
import { useRef } from "react";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { cloudAuthStore } from "@/cloud";
import { COMPUTER_CONNECTIONS_ENABLED } from "@/config/features";
import { SavedEndpointsStore } from "@/connection";
import { EndpointsProvider } from "@/state/endpoints";
import { ExecutionTargetStore } from "@/state/execution-target-store";
import { ExecutionTargetsProvider } from "@/state/execution-targets";
import { render } from "../ui/__testing__/render";
import { containsText } from "./__testing__/harness";
import { useCloudWorkspaceControls } from "./home/CloudWorkspaceControls";
import type { HomeExecutionTarget } from "./home/execution-targets";
import { HomeTargetSheet } from "./home/HomeComposer";
import { HomeScreen } from "./HomeScreen";
import { OnboardingScreen } from "./OnboardingScreen";
import { SettingsScreen } from "./SettingsScreen";

const cloudTarget = {
	id: "cloud-workspace",
	mode: "cloud",
	title: "sample/repo",
	detail: "Cloud workspace",
	cloud: {
		id: "cloud-workspace",
		mode: "cloud",
		label: "sample/repo",
		repoUrl: "https://github.com/sample/repo",
		modelId: "model",
	},
} satisfies HomeExecutionTarget;

describe("Cloud-only mobile release", () => {
	it("returns a saved computer selection to Cloud onboarding without contacting the computer", async () => {
		const connect = vi
			.spyOn(HubClient.prototype, "connect")
			.mockRejectedValue(new Error("Computer connections disabled"));
		const token = vi
			.spyOn(cloudAuthStore, "getValidAccessToken")
			.mockResolvedValue(null);
		try {
			const endpoints = new SavedEndpointsStore();
			await endpoints.save({
				mode: "local",
				url: "http://localhost:9000",
				label: "Saved computer",
			});
			const targets = new ExecutionTargetStore();
			await targets.select(
				JSON.stringify(["local-target", "http://localhost:9000"]),
			);
			const { root } = render(
				<EndpointsProvider store={endpoints}>
					<ExecutionTargetsProvider store={targets}>
						<HomeScreen onOpenSession={vi.fn()} onOpenSettings={vi.fn()} />
					</ExecutionTargetsProvider>
				</EndpointsProvider>,
			);
			await act(async () => {});
			await act(async () =>
				root
					.findAll((node) => node.props.accessibilityLabel === "Get started")
					.at(-1)!
					.props.onPress(),
			);
			expect(
				root.findAll(
					(node) => node.props.accessibilityLabel === "Sign in to Cline",
				).length,
			).toBeGreaterThan(0);
			expect(containsText(root, "Saved computer")).toBe(false);
			expect(containsText(root, "My computer")).toBe(false);
			expect(connect).not.toHaveBeenCalled();
		} finally {
			connect.mockRestore();
			token.mockRestore();
		}
	});
	it("keeps Cloud setup while hiding computer settings even with a saved computer", async () => {
		expect(COMPUTER_CONNECTIONS_ENABLED).toBe(false);
		const store = new SavedEndpointsStore();
		await store.save({
			mode: "local",
			url: "http://localhost:9000",
			label: "Saved computer",
		});
		const configure = vi.fn();
		const { root } = render(
			<EndpointsProvider store={store}>
				<SettingsScreen
					onConnect={vi.fn()}
					onPairComputer={vi.fn()}
					onConfigureCloud={configure}
				/>
			</EndpointsProvider>,
		);
		await act(async () => {});
		for (const text of [
			"Computers",
			"paired",
			"Auto-approve",
			"Connections",
			"Advanced connection",
			"Anything unfamiliar asks",
		])
			expect(containsText(root, text)).toBe(false);
		await act(async () =>
			root
				.findAll(
					(node) => node.props.accessibilityLabel === "Set up Cline Cloud",
				)
				.at(-1)!
				.props.onPress(),
		);
		expect(configure).toHaveBeenCalledOnce();
	});
	it("offers Cloud repository context without a location switch or computer target", async () => {
		const select = vi.fn();
		function Harness() {
			const sheetRef = useRef<GorhomBottomSheet>(null);
			const workspace = useCloudWorkspaceControls({
				target: cloudTarget.cloud,
				onChooseLocation: vi.fn(),
				onSaveTarget: vi.fn(async () => {}),
			});
			return (
				<>
					{workspace.control}
					{workspace.locationControl}
					{workspace.sheets}
					<HomeTargetSheet
						targets={[
							cloudTarget,
							{
								id: "local",
								mode: "local",
								title: "My computer",
								detail: "Paired",
								descriptor: { mode: "local", url: "http://localhost:9000" },
							},
						]}
						sheetRef={sheetRef}
						onSelect={select}
						onPairComputer={vi.fn()}
					/>
				</>
			);
		}
		const { root } = render(<Harness />);
		for (const text of ["Location ·", "My computer", "Pair a computer"])
			expect(containsText(root, text)).toBe(false);
		expect(
			root.findAll(
				(node) =>
					node.props.accessibilityLabel === "Execution location: Cline Cloud",
			),
		).toHaveLength(0);
		expect(
			root.findAll(
				(node) =>
					node.props.accessibilityLabel === "Cloud repository: sample/repo",
			).length,
		).toBeGreaterThan(0);
		await act(async () =>
			root
				.findAll(
					(node) =>
						node.props.accessibilityLabel === "Use sample/repo on Cline Cloud",
				)
				.at(-1)!
				.props.onPress(),
		);
		expect(select).toHaveBeenCalledWith(cloudTarget);
	});
	it("keeps Cloud sign-in without an advanced connection escape in onboarding", async () => {
		const signIn = vi.fn();
		const { root } = render(
			<OnboardingScreen
				cloudState={{ phase: "signed-out" }}
				onSignIn={signIn}
				onRetryCloud={vi.fn()}
				onOpenSettings={vi.fn()}
				onFinish={vi.fn()}
				onSaveCloudTarget={vi.fn(async () => {})}
			/>,
		);
		await act(async () => {});
		expect(containsText(root, "Advanced connection")).toBe(false);
		expect(containsText(root, "Cline Cloud")).toBe(true);
		expect(
			root.findAll(
				(node) => node.props.accessibilityLabel === "Sign in to Cline",
			).length,
		).toBeGreaterThan(0);
	});
});
