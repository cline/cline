// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import {
	buildUserInstructionSlashCommands,
	ChatInputBar,
} from "./chat-input-bar";

const {
	loadProviderModelCatalogMock,
	loadProviderModelsMock,
	subscribeToProviderModelsMock,
} = vi.hoisted(() => ({
	loadProviderModelCatalogMock: vi.fn(),
	loadProviderModelsMock: vi.fn(),
	subscribeToProviderModelsMock: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/provider-model-catalog", () => ({
	loadProviderModelCatalog: loadProviderModelCatalogMock,
	loadProviderModels: loadProviderModelsMock,
	MODE_SETTINGS_CHANGED_EVENT: "cline:mode-settings-changed",
	subscribeToProviderModels: subscribeToProviderModelsMock,
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
	subscribeToProviderModelsMock.mockReset().mockReturnValue(vi.fn());
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
	it("builds slash commands from both workflows and skills", () => {
		expect(
			buildUserInstructionSlashCommands({
				runtimeCommands: [
					{
						id: "workflow:release",
						name: "release",
						description: "Ship it",
						kind: "workflow",
					},
					{
						id: "skill:publish-ui",
						name: "publish-ui-skill",
						kind: "skill",
					},
					{ id: "skill:fork", name: "fork", kind: "skill" },
				],
			}),
		).toEqual([
			{ name: "release", description: "Ship it" },
			{ name: "publish-ui-skill", description: "Skill command" },
		]);
	});

	it("preserves an explicit High selection across capability and status updates", async () => {
		const onReasoningChange = vi.fn();
		const onOpenRealtimeVoiceSettings = vi.fn();
		const onOpenVoiceInputSettings = vi.fn();
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
							mode="act"
							model="test-model"
							onAbort={vi.fn()}
							onAttachFiles={vi.fn()}
							onEditPromptInQueue={vi.fn()}
							onModeToggle={vi.fn()}
							onModelChange={vi.fn()}
							onOpenRealtimeVoiceSettings={onOpenRealtimeVoiceSettings}
							onOpenVoiceInputSettings={onOpenVoiceInputSettings}
							onPromptInputChange={vi.fn()}
							onProviderChange={vi.fn()}
							onReasoningChange={onReasoningChange}
							onRemoveAttachment={vi.fn()}
							onSend={vi.fn()}
							onSteerPromptInQueue={vi.fn()}
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
		const compactModelTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Model settings"]',
		);
		expect(compactModelTrigger).not.toBeNull();
		expect(
			compactModelTrigger?.querySelector(".lucide-chevron-down"),
		).toBeNull();
		const levelIcon = compactModelTrigger?.querySelector(
			"[aria-hidden='true']",
		);
		expect(levelIcon?.className).toContain("-scale-x-100");
		expect(levelIcon?.querySelector(".lucide-signal")?.classList).toContain(
			"text-primary",
		);
		expect(compactModelTrigger?.lastElementChild).toBe(levelIcon);
		await act(async () => compactModelTrigger?.click());
		expect(compactModelTrigger?.getAttribute("aria-expanded")).toBe("true");
		await vi.waitFor(() => {
			expect(subscribeToProviderModelsMock).toHaveBeenCalled();
		});
		const providerModelsListener =
			subscribeToProviderModelsMock.mock.calls[0]?.[0];
		await act(async () => {
			providerModelsListener?.("cline", [
				{ id: "refreshed-model", name: "Refreshed model" },
			]);
		});
		await vi.waitFor(() => {
			const trigger = document.querySelector<HTMLInputElement>(
				'[aria-label="Effort"]',
			);
			expect(trigger?.value).toBe("3");
			expect(trigger?.getAttribute("aria-valuetext")).toBe("High");
			expect(trigger?.disabled).toBe(true);
			expect(trigger?.className).toContain("h-4");
			expect(document.body.textContent).toContain("EffortHigh");
			expect(document.body.textContent).not.toContain("ThinkingHigh");
			expect(
				document.querySelector('[data-slot="thinking-level-markers"]')
					?.children,
			).toHaveLength(5);
			const markers = document.querySelector(
				'[data-slot="thinking-level-markers"]',
			)?.children;
			expect(markers?.[0]?.className).toContain("bg-zinc-500");
			expect(markers?.[4]?.className).toContain("bg-zinc-500");
			expect(markers?.[3]?.className).toContain("opacity-50");
			expect(markers?.[3]?.className).not.toContain("opacity-0");
			expect(markers?.[0]?.className).not.toContain("bg-primary-foreground");
			expect(
				document.querySelector('[data-slot="thinking-level-markers"]')
					?.className,
			).toContain("top-0");
			expect(
				[...document.querySelectorAll("span")]
					.find((element) => element.textContent?.includes("High"))
					?.querySelector(".lucide-signal-high"),
			).not.toBeNull();
		});
		expect(
			document.querySelectorAll<HTMLButtonElement>('[aria-label^="Provider:"]'),
		).toHaveLength(1);
		expect(
			document.querySelectorAll<HTMLButtonElement>('[aria-label^="Model:"]'),
		).toHaveLength(1);
		expect(document.body.textContent).toContain("refreshed-model");
		const modelMenuTrigger = document.querySelector<HTMLButtonElement>(
			'[aria-label^="Model:"]',
		);
		expect(modelMenuTrigger?.className).toContain("w-full");
		expect(modelMenuTrigger?.className).toContain("max-w-none");
		const providerMenuTrigger = document.querySelector<HTMLButtonElement>(
			'[aria-label^="Provider:"]',
		);
		await act(async () => {
			providerMenuTrigger?.click();
		});
		expect(modelMenuTrigger?.getAttribute("aria-expanded")).toBe("false");
		expect(
			document
				.querySelector<HTMLButtonElement>('[aria-label^="Provider:"]')
				?.getAttribute("aria-expanded"),
		).toBe("true");
		expect(
			document.querySelector<HTMLElement>('[aria-label="Search provider"]')
				?.className,
		).toContain("right-full");
		await act(async () => {
			providerMenuTrigger?.click();
			modelMenuTrigger?.click();
		});
		const modelMenu = document.querySelector<HTMLElement>(
			'[aria-label="Search model"]',
		);
		expect(modelMenu?.className).toContain("right-full");
		expect(modelMenu?.className).toContain("top-0");
		expect(modelMenu?.className).not.toContain("bottom-0");
		await act(async () => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			);
		});
		await act(async () => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
			);
		});
		await vi.waitFor(() =>
			expect(compactModelTrigger?.getAttribute("aria-expanded")).toBe("false"),
		);

		const promptInput = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		await act(async () => {
			promptInput?.blur();
			promptInput?.dispatchEvent(new Event("focusin", { bubbles: true }));
		});
		expect(promptInput?.rows).toBe(2);
		expect(promptInput?.className).toContain("field-sizing-content");
		expect(promptInput?.className).toContain("overflow-y-auto");
		expect(promptInput?.style.minHeight).toBe("2.5rem");
		expect(promptInput?.style.maxHeight).toBe("6.25rem");
		const emptySpeechTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Record speech"]',
		);
		const emptyRealtimeTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Configure realtime voice"]',
		);
		expect(emptySpeechTrigger).not.toBeNull();
		expect(emptyRealtimeTrigger).not.toBeNull();
		expect(promptInput?.parentElement?.contains(emptySpeechTrigger)).toBe(true);
		expect(promptInput?.parentElement?.contains(emptyRealtimeTrigger)).toBe(
			true,
		);
		expect(
			emptyRealtimeTrigger?.querySelector(".lucide-audio-waveform"),
		).not.toBeNull();
		await act(async () => emptyRealtimeTrigger?.click());
		expect(onOpenRealtimeVoiceSettings).toHaveBeenCalledOnce();
		expect(onOpenVoiceInputSettings).not.toHaveBeenCalled();

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
		expect(
			container.querySelector('[aria-label="Record speech"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[aria-label="Send message"]'),
		).not.toBeNull();
		expect(
			container.querySelector('[aria-label="Configure realtime voice"]'),
		).toBeNull();

		await render("starting");
		expect(container.querySelector('[aria-label="Stop agent"]')).toBeNull();
		await render("running");
		expect(container.querySelector('[aria-label="Stop agent"]')).not.toBeNull();

		expect(onReasoningChange).not.toHaveBeenCalled();
		expect(
			compactModelTrigger?.querySelector(".lucide-signal-high"),
		).not.toBeNull();
		const attachTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Attach files"]',
		);
		const speechTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Record speech"]',
		);
		const realtimeTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Configure realtime voice"]',
		);
		const leftControls = attachTrigger?.parentElement;
		expect(
			attachTrigger?.querySelector(".lucide-paperclip")?.classList,
		).toContain("size-3");
		expect(leftControls?.className).toContain("max-[560px]:flex-nowrap");
		expect(leftControls?.contains(compactModelTrigger ?? null)).toBe(false);
		expect(container.querySelector("#git-branch-btn")).toBeNull();
		const rightControls = compactModelTrigger?.closest(".ml-auto");
		expect(rightControls?.contains(compactModelTrigger ?? null)).toBe(true);
		const sendTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Send message"]',
		);
		const stopTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Stop agent"]',
		);
		const promptControls = promptInput?.parentElement;
		expect(promptControls?.className).toContain("items-end");
		expect(sendTrigger).toBeNull();
		expect(promptControls?.contains(stopTrigger ?? null)).toBe(true);
		expect(realtimeTrigger).toBeNull();
		expect(promptControls?.contains(speechTrigger ?? null)).toBe(true);
		expect(stopTrigger?.parentElement?.lastElementChild).toBe(stopTrigger);
		expect(stopTrigger?.parentElement?.className).toContain("gap-1");
		expect(stopTrigger?.className).toContain("size-7");
		expect(stopTrigger?.className).toContain("place-items-center");
		expect(rightControls?.contains(sendTrigger ?? null)).toBe(false);
		expect(stopTrigger?.parentElement?.contains(speechTrigger ?? null)).toBe(
			true,
		);
		expect(leftControls?.parentElement).toBe(rightControls?.parentElement);
	});

	it("selects High with the supported model thinking slider", async () => {
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
						mode="act"
						model="test-model"
						onAbort={vi.fn()}
						onAttachFiles={vi.fn()}
						onEditPromptInQueue={vi.fn()}
						onModeToggle={vi.fn()}
						onModelChange={vi.fn()}
						onPromptInputChange={vi.fn()}
						onProviderChange={vi.fn()}
						onReasoningChange={onReasoningChange}
						onRemoveAttachment={vi.fn()}
						onSend={vi.fn()}
						onSteerPromptInQueue={vi.fn()}
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
		const modelSettings = container.querySelector<HTMLButtonElement>(
			'[aria-label="Model settings"]',
		);
		await act(async () => modelSettings?.click());
		const trigger = await vi.waitFor(() => {
			const element = document.querySelector<HTMLInputElement>(
				'[aria-label="Effort"]',
			);
			expect(element?.disabled).toBe(false);
			return element as HTMLInputElement;
		});
		await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
		await act(async () => {
			trigger.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
			);
		});
		expect(onReasoningChange).toHaveBeenLastCalledWith({
			reasoningEffort: "medium",
			thinking: true,
		});
		onReasoningChange.mockClear();
		await act(async () => {
			const setValue = Object.getOwnPropertyDescriptor(
				HTMLInputElement.prototype,
				"value",
			)?.set;
			setValue?.call(trigger, "3");
			trigger.dispatchEvent(new Event("input", { bubbles: true }));
			trigger.dispatchEvent(new Event("change", { bubbles: true }));
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
						mode="act"
						model="test-model"
						onAbort={vi.fn()}
						onAttachFiles={vi.fn()}
						onEditPromptInQueue={onEditPromptInQueue}
						onModeToggle={vi.fn()}
						onModelChange={vi.fn()}
						onPromptInputChange={vi.fn()}
						onProviderChange={vi.fn()}
						onReasoningChange={vi.fn()}
						onRemoveAttachment={vi.fn()}
						onSend={vi.fn()}
						onSteerPromptInQueue={onSteerPromptInQueue}
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
						mode="act"
						model="test-model"
						modelContextWindow={modelContextWindow}
						onAbort={vi.fn()}
						onAttachFiles={vi.fn()}
						onEditPromptInQueue={vi.fn()}
						onModeToggle={vi.fn()}
						onModelChange={vi.fn()}
						onPromptInputChange={vi.fn()}
						onProviderChange={vi.fn()}
						onReasoningChange={vi.fn()}
						onRemoveAttachment={vi.fn()}
						onRemovePromptInQueue={vi.fn()}
						onSend={vi.fn()}
						onSteerPromptInQueue={vi.fn()}
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

	it("waits for token usage and model context metadata", async () => {
		expect(
			await renderTokenUsage({
				toolCalls: 0,
				tokensIn: 500,
				tokensOut: 0,
			}),
		).toBeNull();
		const outputOnly = await renderTokenUsage(
			{
				toolCalls: 0,
				tokensIn: 0,
				tokensOut: 500,
			},
			2000,
		);
		expect(outputOnly?.getAttribute("aria-label")).toBe(
			"Context window: 500 of 2,000 tokens used (25%)",
		);
	});

	it("fills from input and output and sits immediately after the workspace selector", async () => {
		const trigger = await renderTokenUsage(
			{
				toolCalls: 0,
				tokensIn: 1000,
				tokensOut: 500,
			},
			2000,
		);
		expect(trigger?.getAttribute("aria-label")).toBe(
			"Context window: 1,500 of 2,000 tokens used (75%)",
		);
		expect(trigger?.textContent).toBe("");
		const ring = trigger?.querySelector("svg");
		const inputBar = trigger?.closest(".max-w-full");
		expect(inputBar?.classList.contains("w-full")).toBe(true);
		expect(inputBar?.classList.contains("min-w-0")).toBe(true);
		expect(inputBar?.classList.contains("max-w-full")).toBe(true);
		expect(ring?.classList.contains("size-3.5")).toBe(true);
		expect(ring?.getAttribute("height")).toBe("22");
		expect(ring?.getAttribute("width")).toBe("22");
		const progressCircle = trigger?.querySelector("circle.stroke-red-500");
		expect(progressCircle?.getAttribute("stroke-width")).toBe("4");
		const circumference = 2 * Math.PI * 8.5;
		expect(
			Number(progressCircle?.getAttribute("stroke-dashoffset")),
		).toBeCloseTo(circumference * 0.25);
		expect(container.querySelector("#git-branch-btn")).toBeNull();
		expect(trigger?.parentElement?.classList.contains("gap-0")).toBe(true);
		const modelSettings = container.querySelector(
			'[aria-label="Model settings"]',
		);
		expect(
			Boolean(
				modelSettings?.compareDocumentPosition(trigger as Node) &
					Node.DOCUMENT_POSITION_FOLLOWING,
			),
		).toBe(true);
	});

	it("changes the ring from primary to orange at 50% and red at 75%", async () => {
		const belowWarning = await renderTokenUsage(
			{ toolCalls: 0, tokensIn: 499, tokensOut: 0 },
			1000,
		);
		expect(belowWarning?.querySelector("circle.stroke-primary")).not.toBeNull();

		const warning = await renderTokenUsage(
			{ toolCalls: 0, tokensIn: 500, tokensOut: 0 },
			1000,
		);
		expect(warning?.querySelector("circle.stroke-orange-500")).not.toBeNull();

		const critical = await renderTokenUsage(
			{ toolCalls: 0, tokensIn: 750, tokensOut: 0 },
			1000,
		);
		expect(critical?.querySelector("circle.stroke-red-500")).not.toBeNull();
	});

	it("opens only supported usage details on click", async () => {
		const trigger = await renderTokenUsage(
			{
				toolCalls: 0,
				tokensIn: 500_000,
				tokensOut: 500,
				cacheReadTokens: 125_000,
				totalCostUsd: 0.0142,
			},
			1_000_000,
		);
		await act(async () => {
			trigger?.click();
		});

		const panel = document.querySelector("#token-usage-panel");
		expect(panel?.textContent).toContain("Context window500.5k / 1.0M (50%)");
		expect(panel?.textContent).toContain("Input tokens500,000");
		expect(panel?.textContent).toContain("Output tokens500");
		expect(panel?.textContent).toContain("Cached tokens125,000");
		expect(panel?.textContent).toContain("Cost$0.014");
		const uncachedSegment = panel?.querySelector<HTMLElement>(
			'[data-token-kind="uncached-input"]',
		);
		const cachedSegment = panel?.querySelector<HTMLElement>(
			'[data-token-kind="cached-input"]',
		);
		const outputSegment = panel?.querySelector<HTMLElement>(
			'[data-token-kind="output"]',
		);
		expect(uncachedSegment?.classList.contains("bg-primary")).toBe(true);
		expect(uncachedSegment?.style.width).toBe("37.5%");
		expect(cachedSegment?.classList.contains("bg-primary/60")).toBe(true);
		expect(cachedSegment?.style.backgroundImage).toContain("linear-gradient");
		expect(cachedSegment?.style.width).toBe("12.5%");
		expect(outputSegment?.classList.contains("bg-blue-500")).toBe(true);
		expect(outputSegment?.style.backgroundImage).toContain("linear-gradient");
		expect(outputSegment?.style.width).toBe("0.05%");
		expect(panel?.textContent).not.toContain("Total");
		expect(panel?.textContent).not.toContain("usage limit");
	});

	it("saturates at 100% with the critical ring color", async () => {
		const trigger = await renderTokenUsage(
			{
				toolCalls: 0,
				tokensIn: 130_000,
				tokensOut: 5_000,
			},
			128_000,
		);
		const progressCircle = trigger?.querySelector("circle.stroke-red-500");
		expect(progressCircle?.getAttribute("stroke-dashoffset")).toBe("0");
	});
});
