import { useState } from "react";
import { AppState, Linking } from "react-native";
import { act, type ReactTestInstance } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/features", () => ({ COMPUTER_CONNECTIONS_ENABLED: true }));

import { type CloudRepository, CloudSetupApiError } from "@/cloud";
import type { CloudAccount } from "@/cloud/rest/CloudAccountGateway";
import type { CloudExecutionTarget } from "@/state/execution-target-store";
import { cleanup, render } from "../../ui/__testing__/render";
import { containsText } from "../__testing__/harness";
import { useCloudWorkspaceControls } from "./CloudWorkspaceControls";

const mocks = vi.hoisted(() => ({
	resolveInstallUrl: vi.fn(),
	listAccounts: vi.fn<() => Promise<CloudAccount[]>>(),
	switchAccount: vi.fn(async (_id?: string) => {}),
	listRepositories: vi.fn<(_id?: string) => Promise<CloudRepository[]>>(),
	listBranches: vi.fn(async () => ({
		branches: ["main", "feature"],
		nextToken: undefined,
	})),
}));
vi.mock("@/cloud/rest/CloudGitHubGateway", () => ({
	CloudGitHubGateway: class {
		resolveInstallUrl = mocks.resolveInstallUrl;
	},
}));
vi.mock("@/cloud/rest/CloudAccountGateway", () => ({
	CloudAccountGateway: class {
		listAccounts = mocks.listAccounts;
		switchAccount = mocks.switchAccount;
	},
}));
vi.mock("@/cloud", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/cloud")>()),
	CloudSetupGateway: class {
		listRepositories = mocks.listRepositories;
		listBranches = mocks.listBranches;
	},
}));

const repository: CloudRepository = {
	id: 1,
	name: "repo",
	fullName: "team/repo",
	repoUrl: "https://github.com/team/repo",
	private: true,
	defaultBranch: "main",
};
const target: CloudExecutionTarget = {
	id: "cloud",
	mode: "cloud",
	repoUrl: repository.repoUrl,
	label: repository.fullName,
	modelId: "model",
	organizationId: "org-1",
};
function byLabel(root: ReactTestInstance, label: string) {
	return root
		.findAll(
			(node) =>
				typeof node.type === "string" &&
				node.props.accessibilityLabel === label,
		)
		.at(-1);
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function mount(
	initial?: CloudExecutionTarget,
	setup = false,
	initialScope?: string,
) {
	const save = vi.fn(async (_input: unknown) => {});
	const chooseLocation = vi.fn();
	let openRepositories!: (message?: string) => void;
	let setTarget!: (next: CloudExecutionTarget) => void;
	let setSetupScope!: (next: string | undefined) => void;
	function Harness() {
		const [current, setCurrent] = useState(initial);
		const [setupScope, updateSetupScope] = useState(initialScope);
		setTarget = setCurrent;
		setSetupScope = updateSetupScope;
		const view = useCloudWorkspaceControls({
			target: current,
			setup,
			setupScope,
			onChooseLocation: chooseLocation,
			onSaveTarget: save,
		});
		const { control, setupContent, sheets } = view;
		openRepositories = view.openRepositories;
		return (
			<>
				{control}
				{setupContent}
				{sheets}
			</>
		);
	}
	return {
		...render(<Harness />),
		save,
		chooseLocation,
		openRepositories: (message?: string) => openRepositories(message),
		setTarget: (next: CloudExecutionTarget) => setTarget(next),
		setSetupScope: (next: string | undefined) => setSetupScope(next),
	};
}
beforeEach(() => {
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 0),
	);
	vi.stubGlobal("cancelAnimationFrame", (frame: number) => clearTimeout(frame));
	vi.clearAllMocks();
	mocks.resolveInstallUrl.mockResolvedValue(
		"https://github.com/apps/example/installations/new?state=example",
	);
	mocks.listAccounts.mockResolvedValue([
		{ name: "Personal", active: false },
		{ organizationId: "org-1", name: "Team", active: true },
	]);
	mocks.listRepositories.mockResolvedValue([repository]);
	mocks.switchAccount.mockResolvedValue(undefined);
	mocks.listBranches.mockResolvedValue({
		branches: ["main", "feature"],
		nextToken: undefined,
	});
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("Cloud work context", () => {
	it("recovers a missing branch repository by closing its sheet before opening repository selection", async () => {
		vi.useFakeTimers();
		mocks.listRepositories.mockResolvedValue([]);
		const { root, save } = mount(target);
		await act(async () =>
			byLabel(root, "Cloud branch: default")?.props.onPress(),
		);
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(containsText(root, "This repository is no longer available")).toBe(
			true,
		);
		expect(byLabel(root, "Change repository")).toBeDefined();
		const loaded = mocks.listRepositories.mock.calls.length;
		await act(async () => byLabel(root, "Change repository")?.props.onPress());
		expect(mocks.listRepositories).toHaveBeenCalledTimes(loaded);
		const branchSheet = root.findAll((node) => node.type === "BottomSheet")[2]!;
		act(() => branchSheet.props.onChange(-1));
		expect(mocks.listRepositories).toHaveBeenCalledTimes(loaded);
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(mocks.listRepositories).toHaveBeenCalledTimes(loaded + 1);
		expect(containsText(root, "Your draft is unchanged")).toBe(true);
		expect(save).not.toHaveBeenCalled();
	});
	it("offers recovery when a saved repository disappears without clearing the saved choice", async () => {
		mocks.listRepositories.mockResolvedValue([
			{
				...repository,
				id: 2,
				fullName: "team/other",
				repoUrl: "https://github.com/team/other",
			},
		]);
		const { root, openRepositories, save } = mount(target);
		await act(async () => openRepositories());
		expect(containsText(root, "is no longer available")).toBe(true);
		expect(byLabel(root, "Manage repository access")).toBeDefined();
		expect(byLabel(root, "Refresh repositories")).toBeDefined();
		expect(save).not.toHaveBeenCalled();
		await act(async () =>
			byLabel(root, "Manage repository access")?.props.onPress(),
		);
		expect(mocks.resolveInstallUrl).toHaveBeenCalledWith(
			"org-1",
			"add-repositories",
		);
		mocks.listRepositories.mockResolvedValue([repository]);
		await act(async () =>
			byLabel(root, "Refresh repositories")?.props.onPress(),
		);
		expect(byLabel(root, "team/repo")).toBeDefined();
		expect(save).not.toHaveBeenCalled();
	});
	it("keeps repository access and refresh available after an empty search, and can clear the query", async () => {
		const { root, openRepositories } = mount(target);
		await act(async () => openRepositories());
		act(() =>
			byLabel(root, "Search Cloud repositories")?.props.onChangeText(
				"not-found",
			),
		);
		expect(byLabel(root, "Clear repository search")).toBeDefined();
		expect(byLabel(root, "Manage repository access")).toBeDefined();
		expect(byLabel(root, "Refresh repositories")).toBeDefined();
		act(() => byLabel(root, "Clear repository search")?.props.onPress());
		expect(byLabel(root, "Search Cloud repositories")?.props.value).toBe("");
		expect(byLabel(root, "team/repo")).toBeDefined();
	});
	it("refreshes an open repository picker after returning from GitHub without replacing the current target", async () => {
		const { root, openRepositories, save } = mount(target);
		await act(async () => openRepositories());
		const picker = root.findAll((node) => node.type === "BottomSheet")[1]!;
		act(() => picker.props.onChange(0));
		const listener = vi.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
		await act(async () => {
			listener("background");
			listener("active");
		});
		expect(mocks.listRepositories).toHaveBeenCalledTimes(2);
		expect(save).not.toHaveBeenCalled();
	});
	it("exposes one context action, omits branch before repository selection, and keeps location explicit", async () => {
		vi.useFakeTimers();
		const { root, setTarget, chooseLocation } = mount();
		const context = root.find(
			(node) => node.props.testID === "cloud-workspace-controls",
		);
		expect(context.props.accessibilityLabel).toBe(
			"Work context: Cloud, Select repository",
		);
		expect(byLabel(root, "Cloud branch: default")).toBeUndefined();
		await act(async () => context.props.onPress());
		await act(async () =>
			byLabel(root, "Execution location: Cline Cloud")!.props.onPress(),
		);
		expect(chooseLocation).not.toHaveBeenCalled();
		await act(async () =>
			root
				.findAll((node) => node.type === "BottomSheet")[0]!
				.props.onChange(-1),
		);
		expect(chooseLocation).not.toHaveBeenCalled();
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(chooseLocation).toHaveBeenCalledOnce();
		act(() => setTarget({ ...target, branch: "feature" }));
		expect(context.props.accessibilityLabel).toBe(
			"Work context: Cloud, team/repo, feature",
		);
		expect(byLabel(root, "Cloud branch: feature")).toBeDefined();
	});
	it.each([
		"repository",
		"branch",
	])("waits for the context sheet to close before loading the %s picker", async (picker) => {
		vi.useFakeTimers();
		const { root } = mount(target);
		await act(async () =>
			byLabel(
				root,
				"Work context: Cloud, team/repo, default branch",
			)!.props.onPress(),
		);
		await act(async () =>
			byLabel(
				root,
				picker === "repository"
					? "Cloud repository: team/repo"
					: "Cloud branch: default",
			)!.props.onPress(),
		);
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(mocks.listRepositories).not.toHaveBeenCalled();
		expect(mocks.listBranches).not.toHaveBeenCalled();
		const contextSheet = root.findAll(
			(node) => node.type === "BottomSheet",
		)[0]!;
		await act(async () => contextSheet.props.onChange(-1));
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(mocks.listRepositories).toHaveBeenCalledOnce();
		if (picker === "branch") expect(mocks.listBranches).toHaveBeenCalledOnce();
		await act(async () => contextSheet.props.onChange(-1));
		expect(mocks.listRepositories).toHaveBeenCalledOnce();
	});
	it("opens repository selection with a Send explanation, saves only the choice, and clears the explanation on normal reopening", async () => {
		const { root, save, openRepositories } = mount();
		const message = "Choose a repository before starting your task.";
		await act(async () => openRepositories(message));
		expect(
			root.findAll((node) => node.props.children === message).length,
		).toBeGreaterThan(0);
		expect(save).not.toHaveBeenCalled();
		await act(async () => byLabel(root, "team/repo")!.props.onPress());
		expect(save).toHaveBeenCalledOnce();
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				repoUrl: repository.repoUrl,
				organizationId: "org-1",
			}),
		);
		await act(async () =>
			byLabel(root, "Select Cloud repository")!.props.onPress(),
		);
		expect(
			root.findAll((node) => node.props.children === message),
		).toHaveLength(0);
	});
});

describe("Cloud workspace setup", () => {
	it("skips setup when the active organization has repositories", async () => {
		const { root, save } = mount(undefined, true, "org-1");
		await act(async () => {});
		expect(mocks.listRepositories).toHaveBeenCalledWith("org-1");
		expect(
			root.findAll((node) => node.props.testID === "cloud-workspace-setup"),
		).toHaveLength(0);
		await act(async () =>
			byLabel(root, "Select Cloud repository")!.props.onPress(),
		);
		await act(async () => byLabel(root, "team/repo")?.props.onPress());
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				repoUrl: repository.repoUrl,
			}),
		);
	});
	it.each([
		[
			"missing GitHub",
			new CloudSetupApiError("Not connected", 404),
			"Connect GitHub",
		],
		["no allowed repositories", undefined, "Manage repository access"],
		["network failure", new Error("Offline"), "Retry"],
	])("offers the next step for %s", async (_name, error, action) => {
		if (error) mocks.listRepositories.mockRejectedValue(error);
		else mocks.listRepositories.mockResolvedValue([]);
		const { root } = mount(undefined, true);
		await act(async () => {});
		const setup = root.find(
			(node) => node.props.testID === "cloud-workspace-setup",
		);
		expect(byLabel(setup, action)).toBeDefined();
		expect(byLabel(root, "Execution location: Cline Cloud")).toBeDefined();
		expect(byLabel(setup, "Choose repository")).toBeUndefined();
		if (action === "Retry")
			expect(byLabel(setup, "Connect GitHub")).toBeUndefined();
	});
	it("keeps browser failures visible and refreshes after returning from GitHub", async () => {
		mocks.listRepositories.mockResolvedValue([]);
		vi.mocked(Linking.openURL).mockRejectedValueOnce(new Error("Unavailable"));
		const { root } = mount(undefined, true);
		await act(async () => {});
		const setup = root.find(
			(node) => node.props.testID === "cloud-workspace-setup",
		);
		await act(async () =>
			byLabel(setup, "Manage repository access")?.props.onPress(),
		);
		expect(
			setup.findAll((node) => node.props.children === "Unavailable").length,
		).toBeGreaterThan(0);
		expect(mocks.resolveInstallUrl).toHaveBeenCalledWith(
			"org-1",
			"add-repositories",
		);
		expect(Linking.openURL).toHaveBeenCalledWith(
			"https://github.com/apps/example/installations/new?state=example",
		);
		const refreshed = deferred<CloudRepository[]>();
		mocks.listRepositories.mockReturnValue(refreshed.promise);
		const listener = vi.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
		await act(async () => {
			listener("background");
			listener("active");
		});
		expect(mocks.listRepositories).toHaveBeenCalledTimes(2);
		expect(byLabel(setup, "Manage repository access")).toBeDefined();
		expect(byLabel(setup, "Check again")?.props.accessibilityState.busy).toBe(
			true,
		);
		await act(async () => refreshed.resolve([repository]));
		expect(
			root.findAll((node) => node.props.testID === "cloud-workspace-setup"),
		).toHaveLength(0);
		expect(byLabel(root, "Select Cloud repository")).toBeDefined();
	});
	it("ignores a setup response from the previous organization", async () => {
		const old = deferred<CloudRepository[]>();
		mocks.listRepositories
			.mockReturnValueOnce(old.promise)
			.mockResolvedValueOnce([]);
		const { root, setSetupScope } = mount(undefined, true, "org-1");
		await act(async () => {});
		mocks.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
		await act(async () => setSetupScope(undefined));
		await act(async () => old.resolve([repository]));
		const setup = root.find(
			(node) => node.props.testID === "cloud-workspace-setup",
		);
		expect(mocks.listRepositories).toHaveBeenLastCalledWith(undefined);
		expect(byLabel(setup, "Manage repository access")).toBeDefined();
		expect(byLabel(setup, "Choose repository")).toBeUndefined();
	});
});

describe("Cloud workspace account scope", () => {
	it("renders repositories beyond the first 30", async () => {
		mocks.listRepositories.mockResolvedValue(
			Array.from({ length: 31 }, (_, index) => ({
				...repository,
				id: index + 1,
				fullName: `team/repo-${index + 1}`,
				repoUrl: `https://github.com/team/repo-${index + 1}`,
			})),
		);
		const { root } = mount();
		await act(async () =>
			byLabel(root, "Select Cloud repository")?.props.onPress(),
		);
		expect(byLabel(root, "team/repo-31")).toBeDefined();
	});
	it("registers both searches with their sheet's keyboard handling", () => {
		const { root } = mount(target);
		for (const label of [
			"Search Cloud repositories",
			"Search Cloud branches",
		]) {
			const input = byLabel(root, label);
			expect(input?.type).toBe("BottomSheetTextInput");
			expect(input?.props.autoCorrect).toBe(false);
			expect(input?.props.autoCapitalize).toBe("none");
		}
	});
	it("discovers and uses the active org for a fresh repository choice", async () => {
		const { root, save } = mount();
		await act(async () =>
			byLabel(root, "Select Cloud repository")?.props.onPress(),
		);
		expect(mocks.listRepositories).toHaveBeenCalledWith("org-1");
		await act(async () => byLabel(root, "team/repo")?.props.onPress());
		expect(save).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				repoUrl: repository.repoUrl,
			}),
		);
	});
	it("shows repositories, not account controls, and never switches the account", async () => {
		const { root } = mount(target);
		await act(async () =>
			byLabel(root, "Cloud repository: team/repo")?.props.onPress(),
		);
		expect(byLabel(root, "Personal")).toBeUndefined();
		expect(byLabel(root, "Team")).toBeUndefined();
		expect(byLabel(root, "team/repo")).toBeDefined();
		expect(mocks.switchAccount).not.toHaveBeenCalled();
	});
	it("uses Personal selected in Settings without retaining the old org scope or branch", async () => {
		mocks.listAccounts.mockResolvedValue([
			{ name: "Personal", active: true },
			{ name: "Team", organizationId: "org-1", active: false },
		]);
		const { root, save } = mount({ ...target, branch: "org-branch" });
		await act(async () =>
			byLabel(root, "Cloud repository: team/repo")?.props.onPress(),
		);
		expect(mocks.switchAccount).not.toHaveBeenCalled();
		expect(mocks.listRepositories).toHaveBeenLastCalledWith(undefined);
		await act(async () => byLabel(root, "team/repo")?.props.onPress());
		expect(save.mock.calls[0]?.[0]).not.toHaveProperty("organizationId");
		expect(save.mock.calls[0]?.[0]).not.toHaveProperty("branch");
	});
	it("ignores repositories from a retired account request", async () => {
		const old = deferred<CloudRepository[]>();
		mocks.listRepositories
			.mockReturnValueOnce(old.promise)
			.mockResolvedValueOnce([
				{ ...repository, id: 2, fullName: "personal/repo" },
			]);
		const { root } = mount(target);
		await act(async () =>
			byLabel(root, "Cloud repository: team/repo")?.props.onPress(),
		);
		mocks.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
		await act(async () =>
			byLabel(root, "Cloud repository: team/repo")?.props.onPress(),
		);
		await act(async () => old.resolve([repository]));
		expect(byLabel(root, "personal/repo")).toBeDefined();
		expect(byLabel(root, "team/repo")).toBeUndefined();
	});
	it("hides stale branch rows immediately when the target account changes", async () => {
		vi.useFakeTimers();
		const { root, setTarget } = mount(target);
		await act(async () =>
			byLabel(root, "Cloud branch: default")?.props.onPress(),
		);
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(byLabel(root, "feature")).toBeDefined();
		act(() => setTarget({ ...target, organizationId: "org-2" }));
		expect(byLabel(root, "feature")).toBeUndefined();
	});
	it("discards a pending branch result after an account switch", async () => {
		vi.useFakeTimers();
		const pending = deferred<{ branches: string[]; nextToken: undefined }>();
		mocks.listBranches.mockReturnValueOnce(pending.promise);
		const { root, setTarget } = mount(target);
		await act(async () =>
			byLabel(root, "Cloud branch: default")?.props.onPress(),
		);
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		await act(async () =>
			byLabel(root, "Cloud repository: team/repo")?.props.onPress(),
		);
		act(() => setTarget({ ...target, organizationId: undefined }));
		await act(async () =>
			pending.resolve({ branches: ["old-org-branch"], nextToken: undefined }),
		);
		expect(byLabel(root, "old-org-branch")).toBeUndefined();
	});
	it.each([
		"query change",
		"picker close",
	])("retires a pending branch result immediately on %s", async (change) => {
		vi.useFakeTimers();
		const pending = deferred<{ branches: string[]; nextToken: undefined }>();
		mocks.listBranches.mockReturnValueOnce(pending.promise);
		const { root } = mount(target);
		await act(async () =>
			byLabel(root, "Cloud branch: default")?.props.onPress(),
		);
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		act(() => {
			if (change === "query change") {
				byLabel(root, "Search Cloud branches")!.props.onChangeText("release");
			} else {
				root
					.findAll((node) => node.type === "BottomSheet")[2]!
					.props.onChange(-1);
			}
		});
		await act(async () =>
			pending.resolve({ branches: ["retired-branch"], nextToken: undefined }),
		);
		expect(byLabel(root, "retired-branch")).toBeUndefined();
		if (change === "picker close") {
			act(() => byLabel(root, "Cloud branch: default")?.props.onPress());
		}
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(byLabel(root, "feature")).toBeDefined();
		if (change === "query change") {
			expect(mocks.listBranches).toHaveBeenLastCalledWith(1, {
				organizationId: "org-1",
				query: "release",
			});
		}
	});
	it("keeps the target account and reasoning when choosing a branch after browsing another account", async () => {
		vi.useFakeTimers();
		mocks.listAccounts.mockResolvedValue([{ name: "Personal", active: true }]);
		mocks.listRepositories.mockImplementation(async (scope) => [
			{ ...repository, id: scope === "org-1" ? 1 : 2 },
		]);
		const { root, save } = mount({ ...target, reasoning: "high" });
		await act(async () =>
			byLabel(root, "Cloud repository: team/repo")?.props.onPress(),
		);
		await act(async () =>
			byLabel(root, "Cloud branch: default")?.props.onPress(),
		);
		await act(async () => {
			await vi.runOnlyPendingTimersAsync();
		});
		expect(mocks.listBranches).toHaveBeenLastCalledWith(1, {
			organizationId: "org-1",
		});
		await act(async () => byLabel(root, "feature")!.props.onPress());
		expect(save).toHaveBeenCalledWith({
			repoUrl: target.repoUrl,
			label: target.label,
			modelId: target.modelId,
			reasoning: "high",
			branch: "feature",
			organizationId: "org-1",
		});
		expect(mocks.switchAccount).not.toHaveBeenCalled();
	});
});

it("retires an interrupted branch picker so a subsequent repository request opens immediately", async () => {
	const { root, openRepositories, save } = mount(target);
	await act(async () =>
		byLabel(root, "Cloud branch: default")?.props.onPress(),
	);
	const branch = root.findAll((node) => node.type === "BottomSheet")[2];
	act(() => branch?.props.onAnimate(-1, 0));
	act(() => branch?.props.onClose?.()); // No onChange: native current index stayed -1.
	const loaded = mocks.listRepositories.mock.calls.length;
	await act(async () =>
		openRepositories("Repository picker explicitly reopened"),
	);
	expect(containsText(root, "Repository picker explicitly reopened")).toBe(
		true,
	);
	expect(mocks.listRepositories).toHaveBeenCalledTimes(loaded + 1);
	expect(save).not.toHaveBeenCalled();
});

it("finishes branch recovery once on an interrupted opening's onClose-only completion", async () => {
	vi.useFakeTimers();
	mocks.listRepositories.mockResolvedValue([]);
	const { root, save } = mount(target);
	await act(async () =>
		byLabel(root, "Cloud branch: default")?.props.onPress(),
	);
	await act(async () => {
		await vi.runOnlyPendingTimersAsync();
	});
	expect(byLabel(root, "Change repository")).toBeDefined();
	const branch = root.findAll((node) => node.type === "BottomSheet")[2];
	act(() => branch?.props.onAnimate(-1, 0));
	const loaded = mocks.listRepositories.mock.calls.length;
	await act(async () => byLabel(root, "Change repository")?.props.onPress());
	expect(mocks.listRepositories).toHaveBeenCalledTimes(loaded);
	act(() => branch?.props.onClose?.());
	await act(async () => {
		await vi.runOnlyPendingTimersAsync();
	});
	expect(mocks.listRepositories).toHaveBeenCalledTimes(loaded + 1);
	expect(containsText(root, "Your draft is unchanged")).toBe(true);
	act(() => branch?.props.onChange(-1));
	act(() => branch?.props.onClose?.());
	await act(async () => {
		await vi.runOnlyPendingTimersAsync();
	});
	expect(mocks.listRepositories).toHaveBeenCalledTimes(loaded + 1);
	expect(save).not.toHaveBeenCalled();
});
