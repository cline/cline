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
		expect(promptInput?.rows).toBe(2);
		expect(promptInput?.className).toContain("field-sizing-content");
		expect(promptInput?.className).toContain("overflow-y-auto");
		expect(promptInput?.style.minHeight).toBe("2.5rem");
		expect(promptInput?.style.maxHeight).toBe("6.25rem");

		await act(async () => {
			if (!promptInput) return;
			const setValue = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			setValue?.call(promptInput, "first line\nsecond line");
			promptInput.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(promptInput?.rows).toBe(2);

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
		const rightControls = workspaceFooterSlot?.parentElement?.parentElement;
		expect(rightControls?.contains(workspaceTrigger ?? null)).toBe(true);
		const sendTrigger = container.querySelector('[aria-label="Send message"]');
		const stopTrigger = container.querySelector('[aria-label="Stop agent"]');
		expect(promptInput?.parentElement?.className).toContain("items-end");
		expect(promptInput?.parentElement?.contains(sendTrigger)).toBe(true);
		expect(promptInput?.parentElement?.contains(stopTrigger)).toBe(true);
		expect(rightControls?.contains(sendTrigger)).toBe(false);
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
		const onSteerPromptInQueue = vi
			.fn()
			.mockRejectedValue(new Error("steer failed"));
		const onEditPromptInQueue = vi
			.fn()
			.mockRejectedValue(new Error("edit failed"));
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
						onEditPromptInQueue={onEditPromptInQueue}
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
		await vi.waitFor(() =>
			expect(queuedPrompts?.textContent).toContain("steer failed"),
		);

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Edit queued prompt"]')
				?.click();
		});
		const editor = container.querySelector<HTMLTextAreaElement>(
			'[aria-label="Edit queued prompt"]',
		);
		expect(editor).not.toBeNull();
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Save queued prompt"]')
				?.click();
			await Promise.resolve();
		});

		expect(onEditPromptInQueue).toHaveBeenCalledWith(
			"queued-prompt-1",
			"What else can we update the title to?",
		);
		await vi.waitFor(() => {
			expect(editor?.isConnected).toBe(true);
			expect(queuedPrompts?.textContent).toContain("edit failed");
		});

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>(
					'[aria-label="Cancel editing queued prompt"]',
				)
				?.click();
		});

		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Remove queued prompt"]')
				?.click();
			await Promise.resolve();
		});

		expect(onRemovePromptInQueue).toHaveBeenCalledWith("queued-prompt-1");
	});
});

describe("ChatInputBar token ring", () => {
	const renderTokenUsage = async (
		summary: Parameters<typeof ChatInputBar>[0]["summary"],
		modelContextWindow?: number,
	) => {
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
						modelContextWindow={modelContextWindow}
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
						onRemovePromptInQueue={vi.fn()}
						onSend={vi.fn()}
						onSteerPromptInQueue={vi.fn()}
						onSwitchGitBranch={vi.fn(async () => true)}
						promptDraft={{ version: 0, value: "" }}
						promptsInQueue={[]}
						provider="cline"
						reasoningEffort="low"
						status="idle"
						summary={summary}
						thinking
					/>
				</WorkspaceProvider>,
			);
			await Promise.resolve();
		});
		return container.querySelector<HTMLButtonElement>("#token-usage");
	};

	it("waits for input usage and model context metadata", async () => {
		expect(
			await renderTokenUsage({
				toolCalls: 0,
				tokensIn: 500,
				tokensOut: 0,
			}),
		).toBeNull();
		expect(
			await renderTokenUsage(
				{
					toolCalls: 0,
					tokensIn: 0,
					tokensOut: 500,
				},
				2000,
			),
		).toBeNull();
	});

	it("fills from input only and sits immediately before the workspace selector", async () => {
		const trigger = await renderTokenUsage(
			{
				toolCalls: 0,
				tokensIn: 1000,
				tokensOut: 500,
			},
			2000,
		);
		expect(trigger?.getAttribute("aria-label")).toBe(
			"Context window: 1,000 of 2,000 input tokens used (50%)",
		);
		expect(trigger?.textContent).toBe("");
		const ring = trigger?.querySelector("svg");
		expect(ring?.classList.contains("size-3.5")).toBe(true);
		expect(ring?.getAttribute("height")).toBe("22");
		expect(ring?.getAttribute("width")).toBe("22");
		const progressCircle = trigger?.querySelector("circle.stroke-primary");
		expect(progressCircle?.getAttribute("stroke-width")).toBe("4");
		const circumference = 2 * Math.PI * 8.5;
		expect(
			Number(progressCircle?.getAttribute("stroke-dashoffset")),
		).toBeCloseTo(circumference * 0.5);

		const workspaceSelector = container.querySelector("#git-branch-btn");
		expect(workspaceSelector).not.toBeNull();
		expect(trigger?.parentElement?.classList.contains("gap-0")).toBe(true);
		expect(trigger?.parentElement?.contains(workspaceSelector)).toBe(true);
		expect(
			Boolean(
				trigger?.compareDocumentPosition(workspaceSelector as Node) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			),
		).toBe(true);
		expect(container.textContent).not.toContain("1,500 tokens");
	});

	it("opens only supported usage details on click", async () => {
		const trigger = await renderTokenUsage(
			{
				toolCalls: 0,
				tokensIn: 500_000,
				tokensOut: 500,
				totalCostUsd: 0.0142,
			},
			1_000_000,
		);
		await act(async () => {
			trigger?.click();
		});

		const panel = document.querySelector("#token-usage-panel");
		expect(panel?.textContent).toContain("Context window500k / 1.0M (50%)");
		expect(panel?.textContent).toContain("Output tokens500");
		expect(panel?.textContent).toContain("Cost$0.014");
		expect(panel?.textContent).not.toContain("Total");
		expect(panel?.textContent).not.toContain("usage limit");
	});

	it("saturates at 100% without switching to a destructive style", async () => {
		const trigger = await renderTokenUsage(
			{
				toolCalls: 0,
				tokensIn: 130_000,
				tokensOut: 5_000,
			},
			128_000,
		);
		const progressCircle = trigger?.querySelector("circle.stroke-primary");
		expect(progressCircle?.getAttribute("stroke-dashoffset")).toBe("0");
		expect(trigger?.querySelector(".stroke-destructive")).toBeNull();
	});
});
