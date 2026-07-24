// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import { ChatInputBar } from "./chat-input-bar";

const { loadProviderModelCatalogMock, loadProviderModelsMock } = vi.hoisted(
	() => ({
		loadProviderModelCatalogMock: vi.fn(),
		loadProviderModelsMock: vi.fn(),
	}),
);

vi.mock("@/lib/provider-model-catalog", () => ({
	loadProviderModelCatalog: loadProviderModelCatalogMock,
	loadProviderModels: loadProviderModelsMock,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	loadProviderModelCatalogMock.mockReset().mockResolvedValue({
		providers: [],
		enabledProviderIds: ["cline"],
		providerModels: { cline: ["test-model"] },
		providerReasoningModels: { cline: [] },
	});
	loadProviderModelsMock.mockReset().mockResolvedValue([]);
	HTMLElement.prototype.scrollIntoView = vi.fn();
	HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
	HTMLElement.prototype.setPointerCapture = vi.fn();
	HTMLElement.prototype.releasePointerCapture = vi.fn();
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

function setTextareaValue(element: HTMLTextAreaElement, value: string): void {
	Object.getOwnPropertyDescriptor(
		HTMLTextAreaElement.prototype,
		"value",
	)?.set?.call(element, value);
	element.dispatchEvent(new Event("input", { bubbles: true }));
}

const workspaceValue = {
	workspaceRoot: "/workspace/cline",
	workspaces: ["/workspace/cline"],
	listWorkspaces: vi.fn(async () => ["/workspace/cline"]),
	refreshWorkspaces: vi.fn(async () => undefined),
	switchWorkspace: vi.fn(async () => true),
	pickWorkspaceDirectory: vi.fn(async () => null),
	selectChat: vi.fn(async () => true),
};

async function renderInputBar(
	overrides: Partial<ComponentProps<typeof ChatInputBar>> = {},
) {
	await act(async () => {
		root.render(
			<WorkspaceProvider value={workspaceValue}>
				<ChatInputBar
					attachments={[]}
					gitBranch="main"
					mode="act"
					model="test-model"
					onAbort={vi.fn()}
					onAttachFiles={vi.fn()}
					onEditPromptInQueue={vi.fn()}
					onListGitBranches={vi.fn(async () => ({
						current: "main",
						branches: ["main"],
					}))}
					onModeToggle={vi.fn()}
					onModelChange={vi.fn()}
					onPromptInputChange={vi.fn()}
					onProviderChange={vi.fn()}
					onReasoningChange={vi.fn()}
					onRemoveAttachment={vi.fn()}
					onSend={vi.fn()}
					onSwitchGitBranch={vi.fn(async () => true)}
					onUndoPromptInQueue={vi.fn()}
					promptInput=""
					promptsInQueue={[]}
					provider="cline"
					reasoningEffort="low"
					status="running"
					summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
					thinking
					{...overrides}
				/>
			</WorkspaceProvider>,
		);
		await Promise.resolve();
	});
}

describe("ChatInputBar pending messages", () => {
	it("presents mid-run messages as sent rather than as a queue to manage", async () => {
		await renderInputBar({
			promptsInQueue: [
				{ id: "p1", prompt: "also check the tests", steer: true },
			],
		});

		expect(container.textContent).toContain("Sending to the agent");
		expect(container.textContent).toContain("also check the tests");
		expect(container.textContent).not.toContain("Queued for upcoming turns");
		expect(container.textContent).not.toContain("Steer");
		expect(container.textContent).not.toContain("Next turn");
		expect(
			container.querySelector<HTMLTextAreaElement>("textarea")?.placeholder,
		).toBe("Send a follow-up — the agent reads it at its next step");
		expect(
			container.querySelector('[aria-label="Edit message"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[aria-label="Unsend message"]'),
		).not.toBeNull();
	});

	it("counts multiple pending messages in a single header", async () => {
		await renderInputBar({
			promptsInQueue: [
				{ id: "p1", prompt: "first", steer: true },
				{ id: "p2", prompt: "second", steer: true, attachmentCount: 2 },
			],
		});

		expect(container.textContent).toContain("Sending 2 messages to the agent");
		expect(container.textContent).toContain("2 attachments");
	});

	it("recalls the newest pending message into an empty composer with ArrowUp", async () => {
		const onUndoPromptInQueue = vi.fn();
		const newest = { id: "p2", prompt: "second", steer: true };
		await renderInputBar({
			onUndoPromptInQueue,
			promptsInQueue: [{ id: "p1", prompt: "first", steer: true }, newest],
		});

		expect(container.textContent).toContain("\u2191 to edit");
		const composer = container.querySelector("textarea") as HTMLTextAreaElement;
		await act(async () => {
			composer.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
			);
		});

		expect(onUndoPromptInQueue).toHaveBeenCalledWith(newest);
	});

	it("leaves ArrowUp alone while the composer holds a draft", async () => {
		const onUndoPromptInQueue = vi.fn();
		await renderInputBar({
			onUndoPromptInQueue,
			promptInput: "draft",
			promptsInQueue: [{ id: "p1", prompt: "first", steer: true }],
		});

		expect(container.textContent).not.toContain("\u2191 to edit");
		const composer = container.querySelector("textarea") as HTMLTextAreaElement;
		await act(async () => {
			composer.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }),
			);
		});

		expect(onUndoPromptInQueue).not.toHaveBeenCalled();
	});

	it("saves an inline edit of a pending message", async () => {
		const onEditPromptInQueue = vi.fn();
		await renderInputBar({
			onEditPromptInQueue,
			promptsInQueue: [{ id: "p1", prompt: "first", steer: true }],
		});

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Edit message"]')
				?.click();
		});
		const editor = container.querySelector<HTMLTextAreaElement>(
			'[aria-label="Edit message"]',
		) as HTMLTextAreaElement;
		expect(editor.value).toBe("first");
		await act(async () => {
			setTextareaValue(editor, "first, revised");
		});
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Save message"]')
				?.click();
		});

		expect(onEditPromptInQueue).toHaveBeenCalledWith("p1", "first, revised");
	});
});

describe("ChatInputBar", () => {
	it("preserves an explicit High selection across capability and status updates", async () => {
		const onReasoningChange = vi.fn();
		const render = async (status: ChatSessionStatus) => {
			await act(async () => {
				root.render(
					<WorkspaceProvider
						value={{
							workspaceRoot: "/workspace/cline",
							workspaces: ["/workspace/cline"],
							listWorkspaces: vi.fn(async () => ["/workspace/cline"]),
							refreshWorkspaces: vi.fn(async () => undefined),
							switchWorkspace: vi.fn(async () => true),
							pickWorkspaceDirectory: vi.fn(async () => null),
							selectChat: vi.fn(async () => true),
						}}
					>
						<ChatInputBar
							attachments={[]}
							gitBranch="main"
							mode="act"
							model="test-model"
							onAbort={vi.fn()}
							onAttachFiles={vi.fn()}
							onEditPromptInQueue={vi.fn()}
							onListGitBranches={vi.fn(async () => ({
								current: "main",
								branches: ["main"],
							}))}
							onModeToggle={vi.fn()}
							onModelChange={vi.fn()}
							onPromptInputChange={vi.fn()}
							onProviderChange={vi.fn()}
							onReasoningChange={onReasoningChange}
							onRemoveAttachment={vi.fn()}
							onSend={vi.fn()}
							onSwitchGitBranch={vi.fn(async () => true)}
							onUndoPromptInQueue={vi.fn()}
							promptInput=""
							promptsInQueue={[]}
							provider="cline"
							reasoningEffort="high"
							status={status}
							summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
							thinking
						/>
					</WorkspaceProvider>,
				);
				await Promise.resolve();
			});
		};

		await render("idle");
		await vi.waitFor(() => {
			const trigger = container.querySelector<HTMLButtonElement>(
				'[aria-label="Thinking level"]',
			);
			expect(trigger?.textContent).toContain("High");
			expect(trigger?.disabled).toBe(true);
		});
		await render("starting");
		expect(container.querySelector('[aria-label="Stop agent"]')).toBeNull();
		await render("running");
		expect(container.querySelector('[aria-label="Stop agent"]')).not.toBeNull();

		expect(onReasoningChange).not.toHaveBeenCalled();
		const workspaceTrigger = container.querySelector("#git-branch-btn");
		expect(workspaceTrigger?.parentElement?.parentElement?.className).toContain(
			"overflow-visible",
		);
		expect(
			workspaceTrigger?.parentElement?.parentElement?.className,
		).not.toContain("truncate");
	});

	it("selects High from the supported model thinking menu", async () => {
		loadProviderModelCatalogMock.mockResolvedValue({
			providers: [],
			enabledProviderIds: ["cline"],
			providerModels: { cline: ["test-model"] },
			providerReasoningModels: { cline: ["test-model"] },
		});
		const onReasoningChange = vi.fn();
		await act(async () => {
			root.render(
				<WorkspaceProvider
					value={{
						workspaceRoot: "/workspace/cline",
						workspaces: ["/workspace/cline"],
						listWorkspaces: vi.fn(async () => ["/workspace/cline"]),
						refreshWorkspaces: vi.fn(async () => undefined),
						switchWorkspace: vi.fn(async () => true),
						pickWorkspaceDirectory: vi.fn(async () => null),
						selectChat: vi.fn(async () => true),
					}}
				>
					<ChatInputBar
						attachments={[]}
						gitBranch="main"
						mode="act"
						model="test-model"
						onAbort={vi.fn()}
						onAttachFiles={vi.fn()}
						onEditPromptInQueue={vi.fn()}
						onListGitBranches={vi.fn(async () => ({
							current: "main",
							branches: ["main"],
						}))}
						onModeToggle={vi.fn()}
						onModelChange={vi.fn()}
						onPromptInputChange={vi.fn()}
						onProviderChange={vi.fn()}
						onReasoningChange={onReasoningChange}
						onRemoveAttachment={vi.fn()}
						onSend={vi.fn()}
						onSwitchGitBranch={vi.fn(async () => true)}
						onUndoPromptInQueue={vi.fn()}
						promptInput=""
						promptsInQueue={[]}
						provider="cline"
						reasoningEffort="low"
						status="idle"
						summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
						thinking
					/>
				</WorkspaceProvider>,
			);
		});
		const trigger = await vi.waitFor(() => {
			const element = container.querySelector<HTMLButtonElement>(
				'[aria-label="Thinking level"]',
			);
			expect(element?.disabled).toBe(false);
			return element as HTMLButtonElement;
		});
		await act(async () => {
			trigger.dispatchEvent(
				new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
			);
			trigger.click();
		});
		const highOption = await vi.waitFor(() => {
			const element = [
				...document.querySelectorAll<HTMLElement>('[role="option"]'),
			].find((option) => option.textContent?.includes("High"));
			expect(element).toBeDefined();
			return element as HTMLElement;
		});
		await act(async () => {
			highOption.dispatchEvent(
				new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
			);
			highOption.click();
		});

		expect(onReasoningChange).toHaveBeenCalledWith({
			thinking: true,
			reasoningEffort: "high",
		});
	});
});
