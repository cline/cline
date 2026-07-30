// @vitest-environment jsdom

import { act } from "react";
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
							onSteerPromptInQueue={vi.fn()}
							onSwitchGitBranch={vi.fn(async () => true)}
							onRemovePromptInQueue={vi.fn()}
							promptDraft={{ version: 0, value: "" }}
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
			expect(
				trigger?.querySelector('[data-slot="select-value"]')?.parentElement
					?.className,
			).toContain("max-[560px]:sr-only");
		});
		const compactModelTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Model and provider"]',
		);
		expect(compactModelTrigger?.disabled).toBe(false);
		await act(async () => compactModelTrigger?.click());
		expect(compactModelTrigger?.getAttribute("aria-expanded")).toBe("true");
		expect(
			container.querySelectorAll<HTMLButtonElement>(
				'[aria-label^="Provider:"]',
			),
		).toHaveLength(2);
		expect(
			container.querySelectorAll<HTMLButtonElement>('[aria-label^="Model:"]'),
		).toHaveLength(2);
		await act(async () =>
			container
				.querySelector<HTMLButtonElement>('[aria-label="Close model selector"]')
				?.click(),
		);
		expect(compactModelTrigger?.getAttribute("aria-expanded")).toBe("false");

		const promptInput = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		expect(promptInput?.className).toContain("overflow-y-hidden");
		expect(promptInput?.className).not.toContain("overflow-y-auto");

		await act(async () => {
			if (!promptInput) return;
			const setValue = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			setValue?.call(promptInput, "first line\nsecond line");
			promptInput.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(promptInput?.className).toContain("overflow-y-auto");

		await render("starting");
		expect(container.querySelector('[aria-label="Stop agent"]')).toBeNull();
		await render("running");
		expect(container.querySelector('[aria-label="Stop agent"]')).not.toBeNull();

		expect(onReasoningChange).not.toHaveBeenCalled();
		const providerTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label^="Provider:"]',
		);
		expect(providerTrigger?.parentElement?.parentElement?.className).toContain(
			"max-[560px]:hidden",
		);
		expect(compactModelTrigger?.className).toContain("max-[560px]:inline-flex");
		expect(compactModelTrigger?.querySelector(".lucide-cpu")).not.toBeNull();
		const workspaceTrigger =
			container.querySelector<HTMLButtonElement>("#git-branch-btn");
		const attachTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Attach files"]',
		);
		const thinkingTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Thinking level"]',
		);
		const leftControls = attachTrigger?.parentElement;
		expect(leftControls?.className).toContain("max-[560px]:flex-nowrap");
		expect(leftControls?.contains(compactModelTrigger ?? null)).toBe(true);
		expect(leftControls?.contains(thinkingTrigger ?? null)).toBe(true);

		expect(workspaceTrigger?.disabled).toBe(true);
		expect(workspaceTrigger?.className).toContain("max-[560px]:size-7");
		expect(workspaceTrigger?.textContent).toContain("cline");
		expect(workspaceTrigger?.textContent).toContain("main");
		const workspaceFooterSlot =
			workspaceTrigger?.parentElement?.parentElement?.parentElement;
		expect(workspaceFooterSlot?.className).toContain("overflow-visible");
		expect(workspaceFooterSlot?.className).not.toContain("truncate");
		expect(workspaceFooterSlot?.className).not.toContain("hidden");
		expect(workspaceFooterSlot?.className).not.toContain("max-w-");
		const rightControls = workspaceFooterSlot?.parentElement;
		expect(rightControls?.contains(workspaceTrigger ?? null)).toBe(true);
		expect(
			rightControls?.contains(
				container.querySelector('[aria-label="Send message"]'),
			),
		).toBe(true);
		expect(leftControls?.parentElement).toBe(rightControls?.parentElement);
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
						onSteerPromptInQueue={vi.fn()}
						onSwitchGitBranch={vi.fn(async () => true)}
						onRemovePromptInQueue={vi.fn()}
						promptDraft={{ version: 0, value: "" }}
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

	it("shows queued prompts in an accessible list with clear priority actions", async () => {
		const onSteerPromptInQueue = vi.fn();
		const onRemovePromptInQueue = vi.fn();
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
						onReasoningChange={vi.fn()}
						onRemoveAttachment={vi.fn()}
						onSend={vi.fn()}
						onSteerPromptInQueue={onSteerPromptInQueue}
						onSwitchGitBranch={vi.fn(async () => true)}
						onRemovePromptInQueue={onRemovePromptInQueue}
						promptDraft={{ version: 0, value: "" }}
						promptsInQueue={[
							{
								id: "queued-prompt-1",
								prompt: "What else can we update the title to?",
								steer: false,
							},
							{
								id: "queued-prompt-2",
								prompt: "Use the shorter title",
								steer: true,
							},
						]}
						provider="cline"
						reasoningEffort="low"
						status="running"
						summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
						thinking
					/>
				</WorkspaceProvider>,
			);
		});

		const queueToggle = [
			...container.querySelectorAll<HTMLButtonElement>(
				"button[aria-controls][aria-expanded]",
			),
		].find((button) => button.textContent?.includes("prompts queued"));
		expect(queueToggle?.textContent).toContain("2 prompts queued");
		expect(queueToggle?.getAttribute("aria-expanded")).toBe("false");
		const queuedPromptsId = queueToggle?.getAttribute("aria-controls");
		expect(queuedPromptsId).toBeTruthy();
		const queuedPrompts = document.getElementById(queuedPromptsId ?? "");
		expect(container.contains(queuedPrompts)).toBe(true);
		expect(queuedPrompts?.hidden).toBe(true);

		await act(async () => queueToggle?.click());

		expect(queueToggle?.getAttribute("aria-expanded")).toBe("true");
		expect(queuedPrompts?.hidden).toBe(false);
		expect(queuedPrompts?.textContent).toContain(
			"What else can we update the title to?",
		);
		expect(queuedPrompts?.textContent).toContain("Use the shorter title");
		expect(queuedPrompts?.textContent).toContain("Next turn");
		expect(
			container.querySelector('[aria-label="Edit queued prompt"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[aria-label="Remove queued prompt"]'),
		).not.toBeNull();

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Steer queued prompt"]')
				?.click();
			await Promise.resolve();
		});

		expect(onSteerPromptInQueue).toHaveBeenCalledWith("queued-prompt-1");

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Remove queued prompt"]')
				?.click();
			await Promise.resolve();
		});

		expect(onRemovePromptInQueue).toHaveBeenCalledWith("queued-prompt-1");
	});
});
