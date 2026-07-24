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
						onSteerPromptInQueue={vi.fn()}
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
