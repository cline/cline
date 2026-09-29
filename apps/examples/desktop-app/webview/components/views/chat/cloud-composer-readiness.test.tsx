// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import type { CloudRepositoryListResult } from "@/lib/cloud-repositories";
import { ChatInputBar } from "./chat-input-bar";
import { WelcomeScreen } from "./welcome-chat";

const { repositoryCheck, account } = vi.hoisted(() => ({
	repositoryCheck: vi.fn<() => Promise<CloudRepositoryListResult>>(),
	account: { user: { id: "user-1" } as { id: string } | null },
}));

vi.mock("@/contexts/account-context", () => ({
	useAccount: () => ({
		user: account.user,
		activeOrganization: null,
		refreshAccount: vi.fn(),
	}),
}));
vi.mock("@/lib/feature-flags", () => ({ AGENDA_UI_ENABLED: false }));
vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: (command: string) =>
			command === "list_cloud_repositories"
				? repositoryCheck()
				: Promise.resolve({}),
		subscribe: () => () => {},
		subscribeTransportState: () => () => {},
		listAgendaTasks: async () => [],
	},
	openExternalUrl: vi.fn(),
}));
vi.mock("@/lib/provider-model-catalog", () => ({
	loadProviderModelCatalog: async () => ({
		providers: [],
		enabledProviderIds: ["cline"],
		providerModels: { cline: ["test-model"] },
		providerReasoningModels: { cline: [] },
		voiceInput: null,
	}),
	loadProviderModels: async () => [],
	subscribeToProviderCatalogInvalidation: () => () => {},
	subscribeToProviderModels: () => () => {},
	VOICE_INPUT_SETTINGS_CHANGED_EVENT: "test-voice-input-changed",
}));

const rememberedRepo = "https://github.com/example/repo";
const noop = () => {};
const listBranches = async () => ({ current: "main", branches: ["main"] });
const switchBranch = async () => true;
const workspaceValue = {
	workspaceRoot: "/workspace/cline",
	workspaces: ["/workspace/cline"],
	listWorkspaces: async () => ["/workspace/cline"],
	refreshWorkspaces: async () => {},
	switchWorkspace: async () => true,
	pickWorkspaceDirectory: async () => null,
	selectChat: async () => true,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	window.localStorage.clear();
	account.user = { id: "user-1" };
	repositoryCheck.mockReset();
	HTMLElement.prototype.scrollIntoView = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

function deferredRepositories() {
	let resolve!: (result: CloudRepositoryListResult) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<CloudRepositoryListResult>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function repositories(url = rememberedRepo): CloudRepositoryListResult {
	return {
		connected: true,
		connectUrl: "https://app.example/dashboard/integrations",
		repositories: [
			{
				id: 1,
				name: "repo",
				fullName: "example/repo",
				url,
				defaultBranch: "main",
			},
		],
	};
}

function Composer({
	executionTarget = "cloud",
	hasActiveSession = false,
	onSend,
}: {
	executionTarget?: "local" | "cloud";
	hasActiveSession?: boolean;
	onSend: (prompt: string) => void;
}) {
	const [repoUrl, setRepoUrl] = useState(rememberedRepo);
	return (
		<WorkspaceProvider value={workspaceValue}>
			<WelcomeScreen
				active={!hasActiveSession}
				body={null}
				cloudAgentsEnabled
				environmentSelector={null}
				executionTarget={executionTarget}
				gitBranch="main"
				onCloudBranchChange={noop}
				onListGitBranches={listBranches}
				onRepoUrlChange={setRepoUrl}
				onSwitchGitBranch={switchBranch}
				repoUrl={repoUrl}
				composer={({ cloudRepositoryReady }) => (
					<ChatInputBar
						attachments={[]}
						cloudRepositoryReady={cloudRepositoryReady}
						environmentId="local"
						executionTarget={executionTarget}
						gitBranch="main"
						hasActiveSession={hasActiveSession}
						mode="act"
						model="test-model"
						onAbort={noop}
						onAttachFiles={noop}
						onEditPromptInQueue={noop}
						onListGitBranches={listBranches}
						onModeToggle={noop}
						onModelChange={noop}
						onPromptInputChange={noop}
						onProviderChange={noop}
						onReasoningChange={noop}
						onRemoveAttachment={noop}
						onRemovePromptInQueue={noop}
						onSend={onSend}
						onSteerPromptInQueue={noop}
						onSwitchGitBranch={switchBranch}
						promptDraft={{ version: 0, value: "Run task" }}
						promptsInQueue={[]}
						provider="cline"
						reasoningEffort="low"
						repoUrl={repoUrl}
						status="idle"
						summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
						thinking
					/>
				)}
			/>
		</WorkspaceProvider>
	);
}

function sendButton() {
	return container.querySelector<HTMLButtonElement>(
		'[aria-label="Send message"]',
	)!;
}

function input() {
	return container.querySelector<HTMLTextAreaElement>("textarea")!;
}

async function trySending() {
	await act(async () => {
		sendButton().click();
		input().dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
	});
}

it("preserves the draft and blocks click and Enter until the remembered repo is validated", async () => {
	const check = deferredRepositories();
	repositoryCheck.mockReturnValue(check.promise);
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	const originalInput = input();
	expect(originalInput.readOnly).toBe(false);
	expect(sendButton().disabled).toBe(true);
	await trySending();
	expect(onSend).not.toHaveBeenCalled();
	expect(input().value).toBe("Run task");
	await act(async () => check.resolve(repositories()));
	expect(input()).toBe(originalInput);
	expect(input().value).toBe("Run task");
	expect(sendButton().disabled).toBe(false);
	await act(async () => sendButton().click());
	expect(onSend).toHaveBeenCalledExactlyOnceWith("Run task");
});

it("keeps an inaccessible remembered repo from starting a task and retains the draft", async () => {
	const check = deferredRepositories();
	repositoryCheck.mockReturnValue(check.promise);
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	await trySending();
	await act(async () =>
		check.resolve(repositories("https://github.com/another/repo")),
	);
	await trySending();
	expect(onSend).not.toHaveBeenCalled();
	expect(input().value).toBe("Run task");
	expect(container.textContent).toContain("Repository required");
});

it("rechecks the remembered repo when returning from Local to Cloud", async () => {
	repositoryCheck.mockResolvedValue(repositories());
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	expect(sendButton().disabled).toBe(false);
	await act(async () =>
		root.render(<Composer executionTarget="local" onSend={onSend} />),
	);
	const check = deferredRepositories();
	repositoryCheck.mockReturnValue(check.promise);
	await act(async () => root.render(<Composer onSend={onSend} />));
	expect(sendButton().disabled).toBe(true);
	await trySending();
	expect(onSend).not.toHaveBeenCalled();
	await act(async () => check.resolve(repositories()));
	expect(sendButton().disabled).toBe(false);
	expect(input().value).toBe("Run task");
});

it("ignores an old account's access response after switching accounts", async () => {
	const oldCheck = deferredRepositories();
	const newCheck = deferredRepositories();
	repositoryCheck.mockReturnValue(oldCheck.promise);
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	account.user = { id: "user-2" };
	repositoryCheck.mockReturnValue(newCheck.promise);
	await act(async () => root.render(<Composer onSend={onSend} />));
	await act(async () => oldCheck.resolve(repositories()));
	await trySending();
	expect(onSend).not.toHaveBeenCalled();
	await act(async () =>
		newCheck.resolve(repositories("https://github.com/another/repo")),
	);
	expect(sendButton().disabled).toBe(true);
	expect(input().value).toBe("Run task");
});

it("retains the draft after a failed check and enables sending after a successful retry", async () => {
	const check = deferredRepositories();
	repositoryCheck.mockReturnValue(check.promise);
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	await act(async () => check.reject(new Error("offline")));
	expect(sendButton().disabled).toBe(true);
	expect(input().value).toBe("Run task");
	repositoryCheck.mockResolvedValue(repositories());
	await act(async () => window.dispatchEvent(new Event("focus")));
	expect(sendButton().disabled).toBe(false);
	await act(async () => sendButton().click());
	expect(onSend).toHaveBeenCalledExactlyOnceWith("Run task");
});

it("shares the initial check with the picker and offers an enabled retry on failure", async () => {
	const initialCheck = deferredRepositories();
	repositoryCheck.mockReturnValue(initialCheck.promise);
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	const callsBeforePicker = repositoryCheck.mock.calls.length;
	const picker = container.querySelector<HTMLButtonElement>(
		`button[title="${rememberedRepo}"]`,
	);
	expect(picker).not.toBeNull();
	await act(async () => picker?.click());
	expect(repositoryCheck).toHaveBeenCalledTimes(callsBeforePicker);
	await act(async () => initialCheck.reject(new Error("offline")));
	expect(container.textContent).toContain("Could not reach Cline Cloud");
	const retry = Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent === "Retry",
	);
	expect(retry).toBeDefined();
	expect(retry?.disabled).toBe(false);
	expect(sendButton().disabled).toBe(true);
	repositoryCheck.mockResolvedValue(repositories());
	await act(async () => retry?.click());
	expect(sendButton().disabled).toBe(false);
	expect(input().value).toBe("Run task");
	await act(async () => sendButton().click());
	expect(onSend).toHaveBeenCalledExactlyOnceWith("Run task");
});

it("keeps a validated composer usable when the repository picker refresh fails", async () => {
	repositoryCheck.mockResolvedValue(repositories());
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	const originalInput = input();
	expect(sendButton().disabled).toBe(false);
	repositoryCheck.mockRejectedValue(new Error("offline"));
	const picker = container.querySelector<HTMLButtonElement>(
		`button[title="${rememberedRepo}"]`,
	);
	await act(async () => picker?.click());
	expect(container.textContent).toContain("Could not load repositories.");
	expect(container.textContent).not.toContain("Could not reach Cline Cloud");
	expect(input()).toBe(originalInput);
	expect(input().closest(".hidden")).toBeNull();
	expect(input().value).toBe("Run task");
	expect(sendButton().disabled).toBe(false);
	await act(async () => sendButton().click());
	expect(onSend).toHaveBeenCalledExactlyOnceWith("Run task");
});

it("does not reuse prior validation when a picker refresh fails after returning to Cloud", async () => {
	repositoryCheck.mockResolvedValue(repositories());
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	await act(async () =>
		root.render(<Composer executionTarget="local" onSend={onSend} />),
	);
	const check = deferredRepositories();
	repositoryCheck.mockReturnValue(check.promise);
	await act(async () => root.render(<Composer onSend={onSend} />));
	const picker = container.querySelector<HTMLButtonElement>(
		`button[title="${rememberedRepo}"]`,
	);
	await act(async () => picker?.click());
	await act(async () => check.reject(new Error("offline")));
	expect(container.textContent).toContain("Could not reach Cline Cloud");
	expect(sendButton().disabled).toBe(true);
	expect(onSend).not.toHaveBeenCalled();
});

it("clears a previously validated repo when a successful refresh revokes its access", async () => {
	repositoryCheck.mockResolvedValue(repositories());
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	repositoryCheck.mockResolvedValue(
		repositories("https://github.com/another/repo"),
	);
	const picker = container.querySelector<HTMLButtonElement>(
		`button[title="${rememberedRepo}"]`,
	);
	await act(async () => picker?.click());
	expect(sendButton().disabled).toBe(true);
	expect(container.textContent).toContain("Repository required");
	expect(input().value).toBe("Run task");
	await trySending();
	expect(onSend).not.toHaveBeenCalled();
});

it.each([
	"focus",
	"picker",
])("shares a pending revocation check when %s starts first", async (first) => {
	repositoryCheck.mockResolvedValue(repositories());
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	const check = deferredRepositories();
	const priorCalls = repositoryCheck.mock.calls.length;
	repositoryCheck
		.mockReturnValueOnce(check.promise)
		.mockRejectedValue(new Error("offline"));
	const picker = container.querySelector<HTMLButtonElement>(
		`button[title="${rememberedRepo}"]`,
	);
	const focus = () => window.dispatchEvent(new Event("focus"));
	await act(async () => {
		if (first === "focus") focus();
		else picker?.click();
	});
	await act(async () => {
		if (first === "focus") picker?.click();
		else focus();
	});
	expect(repositoryCheck).toHaveBeenCalledTimes(priorCalls + 1);
	expect(sendButton().disabled).toBe(true);
	await trySending();
	expect(onSend).not.toHaveBeenCalled();
	await act(async () =>
		check.resolve(repositories("https://github.com/another/repo")),
	);
	expect(sendButton().disabled).toBe(true);
	expect(container.textContent).toContain("Repository required");
	expect(input().value).toBe("Run task");
});

it.each([
	"resolve",
	"reject",
])("does not let an old scope %s settle the new scope's pending check", async (outcome) => {
	const oldCheck = deferredRepositories();
	repositoryCheck.mockReturnValue(oldCheck.promise);
	const onSend = vi.fn();
	await act(async () => root.render(<Composer onSend={onSend} />));
	await act(async () =>
		root.render(<Composer executionTarget="local" onSend={onSend} />),
	);
	const newCheck = deferredRepositories();
	repositoryCheck.mockReturnValue(newCheck.promise);
	await act(async () => root.render(<Composer onSend={onSend} />));
	await act(async () => {
		if (outcome === "resolve") oldCheck.resolve(repositories());
		else oldCheck.reject(new Error("old scope offline"));
	});
	expect(sendButton().disabled).toBe(true);
	const callsBeforePicker = repositoryCheck.mock.calls.length;
	const picker = container.querySelector<HTMLButtonElement>(
		`button[title="${rememberedRepo}"]`,
	);
	await act(async () => picker?.click());
	expect(repositoryCheck).toHaveBeenCalledTimes(callsBeforePicker);
	await act(async () => newCheck.resolve(repositories()));
	expect(sendButton().disabled).toBe(false);
	expect(input().value).toBe("Run task");
});

it.each([
	{ executionTarget: "local" as const, hasActiveSession: false },
	{ executionTarget: "cloud" as const, hasActiveSession: true },
])("does not gate $executionTarget with active session=$hasActiveSession", async (props) => {
	const onSend = vi.fn();
	await act(async () => root.render(<Composer {...props} onSend={onSend} />));
	expect(repositoryCheck).not.toHaveBeenCalled();
	expect(sendButton().disabled).toBe(false);
	await act(async () => sendButton().click());
	expect(onSend).toHaveBeenCalledExactlyOnceWith("Run task");
});
