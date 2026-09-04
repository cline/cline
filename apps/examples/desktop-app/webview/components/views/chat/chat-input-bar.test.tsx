// @vitest-environment jsdom

import { act, type MouseEvent as ReactMouseEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import {
	MODEL_SELECTION_STORAGE_KEY,
	parseModelSelectionStorage,
} from "@/lib/model-selection";
import {
	BUILTIN_SLASH_COMMANDS,
	buildUserInstructionSlashCommands,
	buildWorkspaceFileSearchKey,
	ChatInputBar,
	filterSlashCommandsForHandoff,
} from "./chat-input-bar";

const {
	loadProviderModelCatalogMock,
	loadProviderModelsMock,
	speechInputMockState,
	startVercelStreamingTranscriptionMock,
	subscribeToProviderModelsMock,
} = vi.hoisted(() => ({
	loadProviderModelCatalogMock: vi.fn(),
	loadProviderModelsMock: vi.fn(),
	speechInputMockState: {
		current: null as MockSpeechInputProps | null,
	},
	startVercelStreamingTranscriptionMock: vi.fn(),
	subscribeToProviderModelsMock: vi.fn(() => vi.fn()),
}));

type MockSpeechInputProps = {
	disabled?: boolean;
	onActiveChange?: (active: boolean) => void;
	onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
	onProcessingChange?: (processing: boolean) => void;
	onStartStreaming?: () => Promise<unknown>;
	onStreamingEnd?: () => void;
	onStreamingStart?: () => void;
	onTranscriptionChange?: (
		transcript: string,
		source?: "speech-recognition" | "media-recorder",
	) => void;
	recordingMode?: "auto" | "media-recorder" | "streaming";
};

vi.mock("@/components/ai-elements/speech-input", async () => {
	const React = await vi.importActual<typeof import("react")>("react");
	return {
		SpeechInput: (props: MockSpeechInputProps) => {
			speechInputMockState.current = props;
			const [initialRecordingMode] = React.useState(props.recordingMode);
			React.useEffect(() => {
				props.onActiveChange?.(false);
				props.onProcessingChange?.(false);
			}, [props.onActiveChange, props.onProcessingChange]);
			return (
				<div data-initial-recording-mode={initialRecordingMode}>
					<button
						aria-label="Record speech"
						disabled={props.disabled}
						onClick={props.onClick}
						type="button"
					/>
				</div>
			);
		},
	};
});

vi.mock("@/lib/provider-model-catalog", () => ({
	loadProviderModelCatalog: loadProviderModelCatalogMock,
	loadProviderModels: loadProviderModelsMock,
	MODE_SETTINGS_CHANGED_EVENT: "cline:mode-settings-changed",
	subscribeToProviderModels: subscribeToProviderModelsMock,
	VOICE_INPUT_SETTINGS_CHANGED_EVENT: "cline:test-voice-input-settings-changed",
}));

vi.mock("@/lib/vercel-streaming-transcription", () => ({
	startVercelStreamingTranscription: startVercelStreamingTranscriptionMock,
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
		voiceInput: null,
	});
	loadProviderModelsMock.mockReset().mockResolvedValue([]);
	speechInputMockState.current = null;
	startVercelStreamingTranscriptionMock.mockReset().mockResolvedValue({
		done: new Promise<void>(() => {}),
		stop: vi.fn(),
		cancel: vi.fn(),
	});
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

const workspaceValue = {
	workspaceRoot: "/workspace/cline",
	workspaces: ["/workspace/cline"],
	listWorkspaces: vi.fn(async () => ["/workspace/cline"]),
	refreshWorkspaces: vi.fn(async () => undefined),
	switchWorkspace: vi.fn(async () => true),
	pickWorkspaceDirectory: vi.fn(async () => null),
	selectChat: vi.fn(async () => true),
};

function providerCatalog(
	voiceInput: {
		providerId: string;
		providerName: string;
		modelId: string;
		modelName: string;
		supportsStreaming: boolean;
	} | null,
) {
	return {
		providers: [],
		enabledProviderIds: ["cline"],
		providerModels: { cline: ["test-model"] },
		providerReasoningModels: { cline: [] },
		voiceInput,
	};
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

async function renderVoiceComposer({
	hasRunningAgents = false,
	onAbort = vi.fn(),
	onPromptInputChange = vi.fn(),
	onSend = vi.fn(),
	prompt = "",
	promptVersion = 0,
	status = "idle",
}: {
	hasRunningAgents?: boolean;
	onAbort?: ReturnType<typeof vi.fn>;
	onPromptInputChange?: ReturnType<typeof vi.fn>;
	onSend?: ReturnType<typeof vi.fn>;
	prompt?: string;
	promptVersion?: number;
	status?: ChatSessionStatus;
} = {}) {
	await act(async () => {
		root.render(
			<WorkspaceProvider value={workspaceValue}>
				<ChatInputBar
					attachments={[]}
					gitBranch="main"
					hasRunningAgents={hasRunningAgents}
					mode="act"
					model="test-model"
					onAbort={onAbort}
					onAttachFiles={vi.fn()}
					onEditPromptInQueue={vi.fn()}
					onListGitBranches={vi.fn(async () => ({
						current: "main",
						branches: ["main"],
					}))}
					onModeToggle={vi.fn()}
					onModelChange={vi.fn()}
					onPromptInputChange={onPromptInputChange}
					onProviderChange={vi.fn()}
					onReasoningChange={vi.fn()}
					onRemoveAttachment={vi.fn()}
					onRemovePromptInQueue={vi.fn()}
					onSend={onSend}
					onSteerPromptInQueue={vi.fn()}
					onSwitchGitBranch={vi.fn(async () => true)}
					promptDraft={{ version: promptVersion, value: prompt }}
					promptsInQueue={[]}
					provider="cline"
					reasoningEffort="low"
					status={status}
					summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
					thinking
				/>
			</WorkspaceProvider>,
		);
		await Promise.resolve();
	});
}

describe("ChatInputBar", () => {
	it("isolates workspace file search caches by environment", () => {
		const localKey = buildWorkspaceFileSearchKey(
			"local",
			"/workspace/shared",
			"src",
		);
		const remoteKey = buildWorkspaceFileSearchKey(
			"pi-server",
			"/workspace/shared",
			"src",
		);

		expect(remoteKey).not.toBe(localKey);
		expect(
			buildWorkspaceFileSearchKey("pi-server", "/workspace/shared", "src"),
		).toBe(remoteKey);
	});

	it("allows a parent session with a running child agent to be stopped", async () => {
		const onAbort = vi.fn();
		await renderVoiceComposer({
			hasRunningAgents: true,
			onAbort,
			status: "idle",
		});

		const stopButton = container.querySelector<HTMLButtonElement>(
			'[aria-label="Stop agent"]',
		);
		expect(stopButton).not.toBeNull();

		await act(async () => stopButton?.click());
		expect(onAbort).toHaveBeenCalledOnce();
	});

	it("builds slash commands from both workflows and skills", () => {
		expect(BUILTIN_SLASH_COMMANDS).toContainEqual({
			name: "handoff",
			description: "Continue this local session in Cline Cloud",
		});
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
					{ id: "workflow:handoff", name: "handoff", kind: "workflow" },
				],
			}),
		).toEqual([
			{ name: "release", description: "Ship it" },
			{ name: "publish-ui-skill", description: "Skill command" },
		]);
	});

	it("hides handoff unless its effective feature gate is enabled", () => {
		expect(
			filterSlashCommandsForHandoff(BUILTIN_SLASH_COMMANDS, false),
		).not.toContainEqual(expect.objectContaining({ name: "handoff" }));
		expect(
			filterSlashCommandsForHandoff(BUILTIN_SLASH_COMMANDS, true),
		).toContainEqual(expect.objectContaining({ name: "handoff" }));
	});

	it("allows cloud image and model selection without replacing local defaults", async () => {
		loadProviderModelCatalogMock.mockResolvedValue({
			providers: [],
			enabledProviderIds: ["anthropic", "cline"],
			providerModels: {
				anthropic: ["claude-test"],
				cline: ["cline-test", "cline-alt"],
			},
			providerReasoningModels: { anthropic: [], cline: [] },
		});
		const localSelection = {
			lastProvider: "anthropic",
			lastModelByProvider: { anthropic: "claude-test" },
		};
		window.localStorage.setItem(
			MODEL_SELECTION_STORAGE_KEY,
			JSON.stringify(localSelection),
		);
		const onProviderChange = vi.fn();
		const onModelChange = vi.fn();
		await act(async () => {
			root.render(
				<WorkspaceProvider
					value={{
						workspaceRoot: "",
						workspaces: [],
						listWorkspaces: vi.fn(async () => []),
						refreshWorkspaces: vi.fn(async () => undefined),
						switchWorkspace: vi.fn(async () => true),
						pickWorkspaceDirectory: vi.fn(async () => null),
						selectChat: vi.fn(async () => true),
					}}
				>
					<ChatInputBar
						attachments={[]}
						cloudBranch="feature/cloud"
						executionTarget="cloud"
						gitBranch="no-git"
						hasActiveSession
						mode="act"
						model="claude-test"
						onAbort={vi.fn()}
						onAttachFiles={vi.fn()}
						onEditPromptInQueue={vi.fn()}
						onListGitBranches={vi.fn(async () => ({
							current: "no-git",
							branches: [],
						}))}
						onModeToggle={vi.fn()}
						onModelChange={onModelChange}
						onPromptInputChange={vi.fn()}
						onProviderChange={onProviderChange}
						onReasoningChange={vi.fn()}
						onRemoveAttachment={vi.fn()}
						onRemovePromptInQueue={vi.fn()}
						onSend={vi.fn()}
						onSteerPromptInQueue={vi.fn()}
						onSwitchGitBranch={vi.fn(async () => false)}
						promptDraft={{ version: 0, value: "" }}
						promptsInQueue={[]}
						provider="anthropic"
						reasoningEffort="low"
						repoUrl="https://github.com/cline/cline"
						status="idle"
						summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
						thinking
						variant="conversation"
					/>
				</WorkspaceProvider>,
			);
			await Promise.resolve();
		});

		await vi.waitFor(() => {
			expect(onProviderChange).toHaveBeenCalledWith("cline");
		});
		expect(onModelChange).not.toHaveBeenCalled();
		expect(
			container.querySelector('[aria-label="Attach images"]'),
		).not.toBeNull();
		expect(
			container.querySelector<HTMLInputElement>('input[type="file"]')?.accept,
		).toBe("image/*");
		expect(container.querySelector("#git-branch-btn")).toBeNull();
		expect(container.textContent).toContain("cline/cline / feature/cloud");
		expect(
			container.querySelector<HTMLButtonElement>(
				'[aria-label="Model and provider"]',
			)?.disabled,
		).toBe(false);
		expect(
			container.querySelector<HTMLButtonElement>(
				'[aria-label="Thinking level"]',
			)?.disabled,
		).toBe(true);
		const modelTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Model and provider"]',
		);
		await act(async () => modelTrigger?.click());
		const cloudModel = container.querySelector<HTMLButtonElement>(
			'[aria-label="Model: cline-test"]',
		);
		await act(async () => cloudModel?.click());
		const alternateModel = Array.from(
			container.querySelectorAll<HTMLButtonElement>(
				".cline-ui-search-combobox__option",
			),
		).find((button) => button.textContent?.includes("cline-alt"));
		expect(alternateModel).not.toBeUndefined();
		await act(async () => alternateModel?.click());
		expect(onModelChange).toHaveBeenCalledWith("cline-alt");
		expect(
			JSON.parse(
				window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY) ?? "null",
			),
		).toEqual(localSelection);
	});

	it("blocks a new cloud message until a GitHub repository is selected", async () => {
		const onSend = vi.fn();
		const render = async (
			repoUrl?: string,
			prompt = "Continue in cloud",
			attachments: Array<{ id: string; name: string; isImage: boolean }> = [],
		) => {
			await act(async () => {
				root.render(
					<WorkspaceProvider
						value={{
							workspaceRoot: "",
							workspaces: [],
							listWorkspaces: vi.fn(async () => []),
							refreshWorkspaces: vi.fn(async () => undefined),
							switchWorkspace: vi.fn(async () => true),
							pickWorkspaceDirectory: vi.fn(async () => null),
							selectChat: vi.fn(async () => true),
						}}
					>
						<ChatInputBar
							attachments={attachments}
							executionTarget="cloud"
							gitBranch="no-git"
							hasActiveSession={false}
							mode="act"
							model="test-model"
							onAbort={vi.fn()}
							onAttachFiles={vi.fn()}
							onEditPromptInQueue={vi.fn()}
							onListGitBranches={vi.fn(async () => ({
								current: "no-git",
								branches: [],
							}))}
							onModeToggle={vi.fn()}
							onModelChange={vi.fn()}
							onPromptInputChange={vi.fn()}
							onProviderChange={vi.fn()}
							onReasoningChange={vi.fn()}
							onRemoveAttachment={vi.fn()}
							onRemovePromptInQueue={vi.fn()}
							onSend={onSend}
							onSteerPromptInQueue={vi.fn()}
							onSwitchGitBranch={vi.fn(async () => false)}
							promptDraft={{ version: 0, value: prompt }}
							promptsInQueue={[]}
							provider="cline"
							reasoningEffort="low"
							repoUrl={repoUrl}
							status="idle"
							summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
							thinking
						/>
					</WorkspaceProvider>,
				);
				await Promise.resolve();
			});
		};

		await render();
		const sendButton = container.querySelector<HTMLButtonElement>(
			'[aria-label="Send message"]',
		);
		const promptInput = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		expect(sendButton?.disabled).toBe(true);
		expect(sendButton?.title).toBe("Choose a repository");
		expect(container.textContent).toContain("Repository required");
		expect(promptInput?.placeholder).toBe("Choose a repository");
		await act(async () => {
			promptInput?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(onSend).not.toHaveBeenCalled();

		await render("https://github.com/cline/cline");
		expect(sendButton?.disabled).toBe(false);
		await act(async () => sendButton?.click());
		expect(onSend).toHaveBeenCalledWith("Continue in cloud");

		onSend.mockClear();
		await render("https://github.com/cline/cline", "", [
			{ id: "image-1", name: "image.png", isImage: true },
		]);
		const imageOnlySendButton = container.querySelector<HTMLButtonElement>(
			'[aria-label="Send message"]',
		);
		expect(imageOnlySendButton?.disabled).toBe(false);
		await act(async () => imageOnlySendButton?.click());
		expect(onSend).toHaveBeenCalledWith("");
	});

	it("top-aligns the textarea in the taller welcome composer", async () => {
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
						environmentId="local"
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
						onRemovePromptInQueue={vi.fn()}
						onSend={vi.fn()}
						onSteerPromptInQueue={vi.fn()}
						onSwitchGitBranch={vi.fn(async () => true)}
						promptDraft={{ version: 0, value: "" }}
						promptsInQueue={[]}
						provider="cline"
						reasoningEffort="low"
						status="idle"
						summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
						thinking
						variant="welcome"
					/>
				</WorkspaceProvider>,
			);
		});

		const promptInput = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		expect(promptInput?.parentElement?.className).toContain("min-h-16");
		expect(promptInput?.parentElement?.className).toContain("items-end");
		expect(promptInput?.className).toContain("self-start");
	});

	it("protects the draft and send action for the full streaming transcription lifecycle", async () => {
		loadProviderModelCatalogMock.mockResolvedValue(
			providerCatalog({
				providerId: "vercel-ai-gateway",
				providerName: "Vercel AI Gateway",
				modelId: "openai/gpt-4o-mini-transcribe",
				modelName: "GPT-4o mini Transcribe",
				supportsStreaming: true,
			}),
		);
		const onPromptInputChange = vi.fn();
		const onSend = vi.fn();
		await renderVoiceComposer({
			onPromptInputChange,
			onSend,
			prompt: "alpha omega",
		});

		await vi.waitFor(() => {
			expect(
				container
					.querySelector("[data-initial-recording-mode]")
					?.getAttribute("data-initial-recording-mode"),
			).toBe("streaming");
		});
		const textarea = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		textarea?.setSelectionRange(6, 6);
		await act(async () => {
			speechInputMockState.current?.onStreamingStart?.();
			speechInputMockState.current?.onActiveChange?.(true);
		});

		const sendButton = container.querySelector<HTMLButtonElement>(
			'[aria-label="Send message"]',
		);
		expect(textarea?.readOnly).toBe(true);
		expect(sendButton?.disabled).toBe(true);
		await act(async () => {
			await speechInputMockState.current?.onStartStreaming?.();
		});
		const onTranscript = (
			startVercelStreamingTranscriptionMock.mock.calls.at(-1)?.[0] as
				| { onTranscript?: (text: string) => void }
				| undefined
		)?.onTranscript;
		await act(async () => onTranscript?.("hello"));
		expect(textarea?.value).toBe("alpha hello omega");

		await act(async () => {
			const setValue = Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set;
			setValue?.call(textarea, "tampered draft");
			textarea?.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(onPromptInputChange).toHaveBeenLastCalledWith("alpha hello omega");
		await act(async () => onTranscript?.("hello world"));
		expect(textarea?.value).toBe("alpha hello world omega");

		await renderVoiceComposer({
			onPromptInputChange,
			onSend,
			prompt: "external replacement",
			promptVersion: 1,
		});
		expect(textarea?.value).toBe("external replacement");
		expect(textarea?.readOnly).toBe(true);
		await act(async () => onTranscript?.("must not overwrite"));
		expect(textarea?.value).toBe("external replacement");

		await act(async () => {
			textarea?.dispatchEvent(
				new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
			);
			sendButton?.click();
			speechInputMockState.current?.onProcessingChange?.(true);
		});
		expect(onSend).not.toHaveBeenCalled();
		expect(
			container.querySelector('output[aria-live="polite"]'),
		).not.toBeNull();
		expect(textarea?.placeholder).toBe("Transcribing voice input…");

		await act(async () => {
			speechInputMockState.current?.onStreamingEnd?.();
			speechInputMockState.current?.onProcessingChange?.(false);
			speechInputMockState.current?.onActiveChange?.(false);
		});
		expect(textarea?.readOnly).toBe(false);
		expect(sendButton?.disabled).toBe(false);
		await act(async () => sendButton?.click());
		expect(onSend).toHaveBeenCalledWith("external replacement");
	});

	it("discards streaming updates after an equal-valued draft replacement", async () => {
		loadProviderModelCatalogMock.mockResolvedValue(
			providerCatalog({
				providerId: "vercel-ai-gateway",
				providerName: "Vercel AI Gateway",
				modelId: "openai/gpt-4o-mini-transcribe",
				modelName: "GPT-4o mini Transcribe",
				supportsStreaming: true,
			}),
		);
		const onPromptInputChange = vi.fn();
		await renderVoiceComposer({ onPromptInputChange });
		await vi.waitFor(() =>
			expect(speechInputMockState.current?.recordingMode).toBe("streaming"),
		);
		const textarea = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		await act(async () => {
			speechInputMockState.current?.onStreamingStart?.();
			speechInputMockState.current?.onActiveChange?.(true);
			await speechInputMockState.current?.onStartStreaming?.();
		});
		const onTranscript = (
			startVercelStreamingTranscriptionMock.mock.calls.at(-1)?.[0] as
				| { onTranscript?: (text: string) => void }
				| undefined
		)?.onTranscript;

		await renderVoiceComposer({
			onPromptInputChange,
			prompt: "",
			promptVersion: 1,
		});
		expect(textarea?.value).toBe("");
		await act(async () => onTranscript?.("stale transcript"));

		expect(textarea?.value).toBe("");
		expect(onPromptInputChange).not.toHaveBeenCalledWith("stale transcript");
	});

	it("keeps the streaming draft identity across internal transcript updates", async () => {
		loadProviderModelCatalogMock.mockResolvedValue(
			providerCatalog({
				providerId: "vercel-ai-gateway",
				providerName: "Vercel AI Gateway",
				modelId: "openai/gpt-4o-mini-transcribe",
				modelName: "GPT-4o mini Transcribe",
				supportsStreaming: true,
			}),
		);
		await renderVoiceComposer({ prompt: "alpha omega" });
		await vi.waitFor(() =>
			expect(speechInputMockState.current?.recordingMode).toBe("streaming"),
		);
		const textarea = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		textarea?.setSelectionRange(6, 6);
		await act(async () => {
			speechInputMockState.current?.onStreamingStart?.();
			speechInputMockState.current?.onActiveChange?.(true);
			await speechInputMockState.current?.onStartStreaming?.();
		});
		const onTranscript = (
			startVercelStreamingTranscriptionMock.mock.calls.at(-1)?.[0] as
				| { onTranscript?: (text: string) => void }
				| undefined
		)?.onTranscript;

		await act(async () => onTranscript?.("hello"));
		expect(textarea?.value).toBe("alpha hello omega");
		await act(async () => onTranscript?.("hello world"));
		expect(textarea?.value).toBe("alpha hello world omega");
	});

	it("adds browser speech-recognition chunks while recording remains active", async () => {
		loadProviderModelCatalogMock.mockResolvedValue(
			providerCatalog({
				providerId: "openai-native",
				providerName: "OpenAI",
				modelId: "gpt-4o-mini-transcribe",
				modelName: "GPT-4o mini Transcribe",
				supportsStreaming: false,
			}),
		);
		await renderVoiceComposer({ prompt: "alpha omega" });

		await vi.waitFor(() =>
			expect(speechInputMockState.current?.recordingMode).toBe("auto"),
		);
		const textarea = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		textarea?.setSelectionRange(6, 6);
		await act(async () => {
			speechInputMockState.current?.onActiveChange?.(true);
			speechInputMockState.current?.onTranscriptionChange?.(
				"hello",
				"speech-recognition",
			);
		});

		expect(textarea?.readOnly).toBe(true);
		expect(textarea?.value).toBe("alpha hello omega");

		await act(async () => {
			speechInputMockState.current?.onTranscriptionChange?.(
				"world",
				"speech-recognition",
			);
		});
		expect(textarea?.value).toBe("alpha hello world omega");
	});

	it("discards a batch transcript after the draft lifecycle is replaced", async () => {
		loadProviderModelCatalogMock.mockResolvedValue(
			providerCatalog({
				providerId: "openai-native",
				providerName: "OpenAI",
				modelId: "gpt-4o-mini-transcribe",
				modelName: "GPT-4o mini Transcribe",
				supportsStreaming: false,
			}),
		);
		const onPromptInputChange = vi.fn();
		await renderVoiceComposer({
			onPromptInputChange,
			prompt: "alpha omega",
		});

		await vi.waitFor(() => {
			expect(
				container
					.querySelector("[data-initial-recording-mode]")
					?.getAttribute("data-initial-recording-mode"),
			).toBe("auto");
		});
		const textarea = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		textarea?.setSelectionRange(6, 6);
		await act(async () => {
			speechInputMockState.current?.onActiveChange?.(true);
		});

		await renderVoiceComposer({
			onPromptInputChange,
			prompt: "external replacement",
			promptVersion: 1,
		});
		expect(textarea?.value).toBe("external replacement");

		await act(async () => {
			speechInputMockState.current?.onTranscriptionChange?.("late transcript");
		});
		expect(textarea?.value).toBe("external replacement");
		expect(onPromptInputChange).toHaveBeenLastCalledWith(
			"external replacement",
		);
	});

	it("inserts a batch transcript only into its captured draft range", async () => {
		loadProviderModelCatalogMock.mockResolvedValue(
			providerCatalog({
				providerId: "openai-native",
				providerName: "OpenAI",
				modelId: "gpt-4o-mini-transcribe",
				modelName: "GPT-4o mini Transcribe",
				supportsStreaming: false,
			}),
		);
		await renderVoiceComposer({ prompt: "alpha omega" });

		await vi.waitFor(() => {
			expect(speechInputMockState.current?.recordingMode).toBe("auto");
		});
		const textarea = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		textarea?.setSelectionRange(6, 6);
		await act(async () => {
			speechInputMockState.current?.onActiveChange?.(true);
			speechInputMockState.current?.onTranscriptionChange?.("hello");
		});

		expect(textarea?.value).toBe("alpha hello omega");
		await act(async () => {
			speechInputMockState.current?.onTranscriptionChange?.("replayed");
		});
		expect(textarea?.value).toBe("alpha hello omega");
	});

	it("discards a pending batch transcript when the voice target changes", async () => {
		loadProviderModelCatalogMock.mockResolvedValue(
			providerCatalog({
				providerId: "openai-native",
				providerName: "OpenAI",
				modelId: "gpt-4o-mini-transcribe",
				modelName: "GPT-4o mini Transcribe",
				supportsStreaming: false,
			}),
		);
		await renderVoiceComposer({ prompt: "alpha omega" });

		await vi.waitFor(() => {
			expect(speechInputMockState.current?.recordingMode).toBe("auto");
		});
		const textarea = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		textarea?.setSelectionRange(6, 6);
		await act(async () => {
			speechInputMockState.current?.onActiveChange?.(true);
		});
		const staleBatchResult =
			speechInputMockState.current?.onTranscriptionChange;

		loadProviderModelCatalogMock.mockResolvedValue(
			providerCatalog({
				providerId: "vercel-ai-gateway",
				providerName: "Vercel AI Gateway",
				modelId: "openai/gpt-4o-mini-transcribe",
				modelName: "GPT-4o mini Transcribe",
				supportsStreaming: true,
			}),
		);
		await act(async () => {
			window.dispatchEvent(
				new Event("cline:test-voice-input-settings-changed"),
			);
		});
		await vi.waitFor(() => {
			expect(speechInputMockState.current?.recordingMode).toBe("streaming");
		});

		await act(async () => staleBatchResult?.("late transcript"));
		expect(textarea?.value).toBe("alpha omega");
	});

	it("ignores stale voice catalog responses and remounts when the recording mode changes", async () => {
		const firstCatalog = deferred<ReturnType<typeof providerCatalog>>();
		const refreshedCatalog = deferred<ReturnType<typeof providerCatalog>>();
		loadProviderModelCatalogMock
			.mockReset()
			// ModelSelector loads the same catalog independently before the
			// composer's voice-input effect runs.
			.mockResolvedValueOnce(providerCatalog(null))
			.mockReturnValueOnce(firstCatalog.promise)
			.mockReturnValueOnce(refreshedCatalog.promise);
		await renderVoiceComposer();

		await act(async () => {
			window.dispatchEvent(
				new Event("cline:test-voice-input-settings-changed"),
			);
		});
		expect(loadProviderModelCatalogMock).toHaveBeenCalledTimes(3);
		await act(async () => {
			refreshedCatalog.resolve(
				providerCatalog({
					providerId: "vercel-ai-gateway",
					providerName: "Vercel AI Gateway",
					modelId: "openai/gpt-4o-mini-transcribe",
					modelName: "GPT-4o mini Transcribe",
					supportsStreaming: true,
				}),
			);
			await refreshedCatalog.promise;
		});
		await vi.waitFor(() => {
			expect(
				container
					.querySelector("[data-initial-recording-mode]")
					?.getAttribute("data-initial-recording-mode"),
			).toBe("streaming");
		});

		await act(async () => {
			firstCatalog.resolve(
				providerCatalog({
					providerId: "openai",
					providerName: "OpenAI",
					modelId: "whisper-1",
					modelName: "Whisper",
					supportsStreaming: false,
				}),
			);
			await firstCatalog.promise;
		});
		expect(speechInputMockState.current?.recordingMode).toBe("streaming");
		expect(
			container
				.querySelector("[data-initial-recording-mode]")
				?.getAttribute("data-initial-recording-mode"),
		).toBe("streaming");
	});

	it("ignores late transcripts from a session canceled by a provider change", async () => {
		loadProviderModelCatalogMock.mockResolvedValue(
			providerCatalog({
				providerId: "vercel-ai-gateway",
				providerName: "Vercel AI Gateway",
				modelId: "openai/gpt-4o-mini-transcribe",
				modelName: "GPT-4o mini Transcribe",
				supportsStreaming: true,
			}),
		);
		await renderVoiceComposer({ prompt: "draft" });
		await vi.waitFor(() =>
			expect(speechInputMockState.current?.recordingMode).toBe("streaming"),
		);
		const textarea = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		textarea?.setSelectionRange(5, 5);
		await act(async () => {
			speechInputMockState.current?.onStreamingStart?.();
			speechInputMockState.current?.onActiveChange?.(true);
			await speechInputMockState.current?.onStartStreaming?.();
		});
		const oldSessionTranscript = (
			startVercelStreamingTranscriptionMock.mock.calls.at(-1)?.[0] as
				| { onTranscript?: (text: string) => void }
				| undefined
		)?.onTranscript;
		await act(async () => oldSessionTranscript?.("one"));
		expect(textarea?.value).toBe("draft one");

		loadProviderModelCatalogMock.mockResolvedValueOnce(
			providerCatalog({
				providerId: "openai",
				providerName: "OpenAI",
				modelId: "whisper-1",
				modelName: "Whisper",
				supportsStreaming: false,
			}),
		);
		await act(async () => {
			window.dispatchEvent(
				new Event("cline:test-voice-input-settings-changed"),
			);
		});
		await vi.waitFor(() =>
			expect(speechInputMockState.current?.recordingMode).toBe("auto"),
		);
		await act(async () => oldSessionTranscript?.("late replacement"));

		expect(textarea?.value).toBe("draft one");
	});

	it("keeps the force-mounted model settings inert while closed", async () => {
		await renderVoiceComposer();

		const modelSettingsContent = await vi.waitFor(() => {
			const effortSlider = document.querySelector<HTMLInputElement>(
				'[aria-label="Effort"]',
			);
			const content = effortSlider?.closest<HTMLElement>(
				'[data-slot="popover-content"]',
			);
			expect(content?.getAttribute("data-state")).toBe("closed");
			return content as HTMLElement;
		});
		expect(modelSettingsContent.hidden).toBe(true);
		expect(modelSettingsContent.getAttribute("inert")).toBe("");

		const modelSettingsTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Model settings"]',
		);
		await act(async () => modelSettingsTrigger?.click());

		expect(modelSettingsContent.getAttribute("data-state")).toBe("open");
		expect(modelSettingsContent.hidden).toBe(false);
		expect(modelSettingsContent.hasAttribute("inert")).toBe(false);
	});

	it("preserves an explicit High selection across capability and status updates", async () => {
		const onReasoningChange = vi.fn();
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
							gitBranch="main"
							mode="act"
							model="test-model"
							onAbort={vi.fn()}
							onAttachFiles={vi.fn()}
							onEditPromptInQueue={vi.fn()}
							onModeToggle={vi.fn()}
							onModelChange={vi.fn()}
							onListGitBranches={vi.fn(async () => ({
								current: "main",
								branches: ["main"],
							}))}
							onOpenVoiceInputSettings={onOpenVoiceInputSettings}
							onPromptInputChange={vi.fn()}
							onProviderChange={vi.fn()}
							onReasoningChange={onReasoningChange}
							onRemoveAttachment={vi.fn()}
							onSend={vi.fn()}
							onSteerPromptInQueue={vi.fn()}
							onSwitchGitBranch={vi.fn(async () => false)}
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
		// The picker labels models by display name, not raw id.
		expect(document.body.textContent).toContain("Refreshed model");
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
		expect(promptInput?.className).not.toContain("self-start");
		expect(promptInput?.style.minHeight).toBe("2.5rem");
		expect(promptInput?.style.maxHeight).toBe("6.25rem");
		const emptySpeechTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Record speech"]',
		);
		expect(emptySpeechTrigger).toBeNull();
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
		expect(container.querySelector('[aria-label="Record speech"]')).toBeNull();
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
		const thinkingTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Thinking level"]',
		);
		const leftControls = attachTrigger?.parentElement;
		expect(
			attachTrigger?.querySelector(".lucide-paperclip")?.classList,
		).toContain("size-3");
		expect(leftControls?.className).toContain("max-[560px]:flex-nowrap");
		expect(leftControls?.contains(compactModelTrigger ?? null)).toBe(true);
		expect(leftControls?.contains(thinkingTrigger ?? null)).toBe(false);
		expect(leftControls?.contains(speechTrigger ?? null)).toBe(false);

		const workspaceTrigger =
			container.querySelector<HTMLButtonElement>("#git-branch-btn");
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
		const sendTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Send message"]',
		);
		const stopTrigger = container.querySelector<HTMLButtonElement>(
			'[aria-label="Stop agent"]',
		);
		expect(promptInput?.parentElement?.className).toContain("items-start");
		expect(promptInput?.parentElement?.contains(sendTrigger)).toBe(true);
		expect(promptInput?.parentElement?.contains(stopTrigger)).toBe(true);
		// The mic button is hidden for now (SHOW_VOICE_INPUT_BUTTON).
		expect(speechTrigger).toBeNull();
		expect(sendTrigger?.parentElement?.className).toContain("self-end");
		expect(rightControls?.contains(sendTrigger)).toBe(false);
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

	it("displays a queued team command as its slash form, not the runtime envelope", async () => {
		const onEditPromptInQueue = vi.fn();
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
						onSteerPromptInQueue={vi.fn()}
						onSwitchGitBranch={vi.fn(async () => true)}
						onRemovePromptInQueue={vi.fn()}
						promptDraft={{ version: 0, value: "" }}
						promptsInQueue={[
							{
								id: "queued-team",
								prompt:
									'<user_command slash="team">spawn a team of agents for the following task: inspect the app</user_command>',
								steer: false,
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
		].find((button) => button.textContent?.includes("prompt queued"));
		await act(async () => queueToggle?.click());

		const queuedPrompts = document.getElementById(
			queueToggle?.getAttribute("aria-controls") ?? "",
		);
		expect(queuedPrompts?.textContent).toContain("/team inspect the app");
		expect(queuedPrompts?.textContent).not.toContain("<user_command");

		// Editing prefills the slash form; the sidecar re-resolves it on save.
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Edit queued prompt"]')
				?.click();
		});
		const editor = container.querySelector<HTMLTextAreaElement>(
			'[aria-label="Edit queued prompt"]',
		);
		expect(editor?.value).toBe("/team inspect the app");
	});

	it("does not overwrite the remembered model when rendering a session's provider/model", async () => {
		// Opening an existing session drives the composer's provider/model
		// props to that session's config. That passive change must not
		// replace the user's explicitly picked default for new sessions.
		window.localStorage.setItem(
			MODEL_SELECTION_STORAGE_KEY,
			JSON.stringify({
				lastProvider: "cline",
				lastModelByProvider: { cline: "test-model" },
			}),
		);
		loadProviderModelCatalogMock.mockResolvedValue({
			providers: [],
			enabledProviderIds: ["openrouter"],
			providerModels: {
				openrouter: ["old-session-model", "user-picked-model"],
			},
			providerReasoningModels: { openrouter: [] },
		});

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
						model="old-session-model"
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
						onSteerPromptInQueue={vi.fn()}
						onSwitchGitBranch={vi.fn(async () => true)}
						onRemovePromptInQueue={vi.fn()}
						promptDraft={{ version: 0, value: "" }}
						promptsInQueue={[]}
						provider="openrouter"
						reasoningEffort="low"
						status="idle"
						summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
						thinking={false}
					/>
				</WorkspaceProvider>,
			);
			await Promise.resolve();
		});
		await vi.waitFor(() => {
			expect(loadProviderModelsMock).toHaveBeenCalledWith("openrouter");
		});
		// The composer displays the session's model...
		const modelSettings = container.querySelector<HTMLButtonElement>(
			'[aria-label="Model settings"]',
		);
		expect(modelSettings?.textContent).toContain("old-session-model");
		await act(async () => modelSettings?.click());
		const modelTrigger = document.querySelector<HTMLButtonElement>(
			'[aria-label^="Model:"]',
		);
		expect(modelTrigger?.textContent).toContain("old-session-model");
		// ...but the remembered selection for new sessions stays intact.
		expect(
			parseModelSelectionStorage(
				window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY),
			),
		).toEqual({
			lastProvider: "cline",
			lastModelByProvider: { cline: "test-model" },
		});

		// An explicit pick in the model dropdown DOES update the remembered
		// selection.
		await act(async () => modelTrigger?.click());
		const option = [
			...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
		].find((entry) => entry.textContent?.includes("user-picked-model"));
		expect(option).toBeTruthy();
		await act(async () => option?.click());
		expect(
			parseModelSelectionStorage(
				window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY),
			),
		).toEqual({
			lastProvider: "openrouter",
			lastModelByProvider: {
				cline: "test-model",
				openrouter: "user-picked-model",
			},
		});

		window.localStorage.removeItem(MODEL_SELECTION_STORAGE_KEY);
	});

	it("renders the cline model picker with recommended and free sections", async () => {
		loadProviderModelCatalogMock.mockResolvedValue({
			providers: [],
			enabledProviderIds: ["cline"],
			providerModels: {
				cline: [
					"anthropic/claude-opus-5",
					"deepseek/deepseek-v4-flash",
					"zzz/other-model",
				],
			},
			// Tier data arrives on the models themselves, stamped by the SDK.
			providerModelDetails: {
				cline: [
					{
						id: "anthropic/claude-opus-5",
						name: "Claude Opus 5",
						description: "Most intelligent model",
						featured: { tier: "recommended", rank: 0, tags: ["NEW"] },
					},
					{
						id: "deepseek/deepseek-v4-flash",
						name: "DeepSeek V4 Flash",
						description: "Fast and efficient",
						featured: { tier: "free", rank: 0, tags: [] },
					},
					{ id: "zzz/other-model", name: "Other Model" },
				],
			},
			providerNames: { cline: "Cline" },
			providerReasoningModels: { cline: [] },
		});

		await act(async () => {
			root.render(
				<WorkspaceProvider value={workspaceValue}>
					<ChatInputBar
						attachments={[]}
						gitBranch="main"
						mode="act"
						model="anthropic/claude-opus-5"
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
						summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
						thinking={false}
					/>
				</WorkspaceProvider>,
			);
			await Promise.resolve();
		});
		// The beta composer nests the provider and model pickers inside the
		// Model settings menu; the provider trigger uses the catalog display
		// name, the model trigger the model's display name.
		const modelSettings = container.querySelector<HTMLButtonElement>(
			'[aria-label="Model settings"]',
		);
		await act(async () => modelSettings?.click());
		await vi.waitFor(() => {
			const providerTrigger = document.querySelector<HTMLButtonElement>(
				'[aria-label^="Provider:"]',
			);
			expect(providerTrigger?.textContent).toContain("Cline");
		});
		const modelTrigger = document.querySelector<HTMLButtonElement>(
			'[aria-label^="Model:"]',
		);
		expect(modelTrigger?.textContent).toContain("Claude Opus 5");

		await act(async () => modelTrigger?.click());
		const panel = [...document.querySelectorAll('[role="dialog"]')].find(
			(dialog) => dialog.querySelector('[role="option"]'),
		);
		expect(panel?.textContent).toContain("Recommended");
		expect(panel?.textContent).toContain("Free");
		expect(panel?.textContent).toContain("All models");
		expect(panel?.textContent).toContain("Most intelligent model");
		expect(
			panel?.querySelector(".cline-ui-search-combobox__badge")?.textContent,
		).toBe("NEW");
		// Featured entries lead; the rest of the catalog follows.
		const optionLabels = [
			...(panel?.querySelectorAll('[role="option"]') ?? []),
		].map((option) => option.textContent);
		expect(optionLabels[0]).toContain("Claude Opus 5");
		expect(optionLabels[1]).toContain("DeepSeek V4 Flash");
		expect(optionLabels[2]).toContain("Other Model");
	});

	describe("cline-pass picker offer", () => {
		const renderComposer = async (props: {
			model: string;
			provider: string;
			onModelChange?: ReturnType<typeof vi.fn>;
			onProviderChange?: ReturnType<typeof vi.fn>;
		}) => {
			await act(async () => {
				root.render(
					<WorkspaceProvider value={workspaceValue}>
						<ChatInputBar
							attachments={[]}
							gitBranch="main"
							mode="act"
							model={props.model}
							onAbort={vi.fn()}
							onAttachFiles={vi.fn()}
							onEditPromptInQueue={vi.fn()}
							onListGitBranches={vi.fn(async () => ({
								current: "main",
								branches: ["main"],
							}))}
							onModeToggle={vi.fn()}
							onModelChange={props.onModelChange ?? vi.fn()}
							onPromptInputChange={vi.fn()}
							onProviderChange={props.onProviderChange ?? vi.fn()}
							onReasoningChange={vi.fn()}
							onRemoveAttachment={vi.fn()}
							onRemovePromptInQueue={vi.fn()}
							onSend={vi.fn()}
							onSteerPromptInQueue={vi.fn()}
							onSwitchGitBranch={vi.fn(async () => true)}
							promptDraft={{ version: 0, value: "" }}
							promptsInQueue={[]}
							provider={props.provider}
							reasoningEffort="low"
							status="idle"
							summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
							thinking={false}
						/>
					</WorkspaceProvider>,
				);
				await Promise.resolve();
			});
			await vi.waitFor(() => {
				expect(loadProviderModelCatalogMock).toHaveBeenCalled();
			});
		};

		beforeEach(() => {
			// The ClinePass offer: one subscribed and one free model, stamped
			// by the SDK onto ProviderModel.featured. The catalog additionally
			// contains a stale unstamped model outside the offer, which the
			// picker hides while the subscribed tier is non-empty.
			loadProviderModelCatalogMock.mockResolvedValue({
				providers: [],
				enabledProviderIds: ["cline", "cline-pass"],
				providerModels: {
					cline: ["test-model"],
					"cline-pass": [
						"openai/gpt-5",
						"google/gemini-flash",
						"legacy/stale-model",
					],
				},
				providerModelDetails: {
					"cline-pass": [
						{
							id: "openai/gpt-5",
							name: "GPT-5",
							featured: { tier: "subscribed", rank: 0, tags: [] },
						},
						{
							id: "google/gemini-flash",
							name: "Gemini Flash",
							featured: { tier: "free", rank: 0, tags: [] },
						},
						{ id: "legacy/stale-model", name: "Stale Legacy" },
					],
				},
				providerNames: { cline: "Cline", "cline-pass": "ClinePass" },
				providerReasoningModels: { cline: [], "cline-pass": [] },
			});
		});

		afterEach(() => {
			window.localStorage.removeItem(MODEL_SELECTION_STORAGE_KEY);
		});

		it("does not resurrect a stale remembered model the picker hides", async () => {
			window.localStorage.setItem(
				MODEL_SELECTION_STORAGE_KEY,
				JSON.stringify({
					lastProvider: "cline-pass",
					lastModelByProvider: { "cline-pass": "legacy/stale-model" },
				}),
			);
			const onModelChange = vi.fn();
			await renderComposer({
				model: "",
				onModelChange,
				provider: "cline-pass",
			});

			// The default selection must come from the visible offer, not the
			// hidden remembered id.
			await vi.waitFor(() => {
				expect(onModelChange).toHaveBeenCalledWith("openai/gpt-5");
			});
			expect(onModelChange).not.toHaveBeenCalledWith("legacy/stale-model");

			const modelTrigger = container.querySelector<HTMLButtonElement>(
				'[aria-label^="Model:"]',
			);
			await act(async () => modelTrigger?.click());
			const panel = document.querySelector('[role="dialog"]');
			expect(panel?.textContent).not.toContain("Stale Legacy");
			expect(panel?.textContent).not.toContain("Current model");
		});

		it("keeps an explicitly active out-of-offer model visible and selectable", async () => {
			const onModelChange = vi.fn();
			await renderComposer({
				model: "legacy/stale-model",
				onModelChange,
				provider: "cline-pass",
			});

			// The session's configured model stays active…
			expect(onModelChange).not.toHaveBeenCalled();
			const modelSettings = container.querySelector<HTMLButtonElement>(
				'[aria-label="Model settings"]',
			);
			await act(async () => modelSettings?.click());
			const modelTrigger = await vi.waitFor(() => {
				const element = document.querySelector<HTMLButtonElement>(
					'[aria-label^="Model:"]',
				);
				expect(element?.textContent).toContain("Stale Legacy");
				return element as HTMLButtonElement;
			});

			// …and the picker surfaces it under its own section instead of
			// selecting a value that does not exist in the list.
			await act(async () => modelTrigger?.click());
			const panel = [...document.querySelectorAll('[role="dialog"]')].find(
				(dialog) => dialog.querySelector('[role="option"]'),
			);
			expect(panel?.textContent).toContain("Current model");
			const staleOption = [
				...(panel?.querySelectorAll<HTMLButtonElement>('[role="option"]') ??
					[]),
			].find((option) => option.textContent?.includes("Stale Legacy"));
			expect(staleOption?.getAttribute("aria-selected")).toBe("true");
		});

		it("falls back to a visible model when switching providers with a hidden remembered model", async () => {
			window.localStorage.setItem(
				MODEL_SELECTION_STORAGE_KEY,
				JSON.stringify({
					lastProvider: "cline",
					lastModelByProvider: {
						cline: "test-model",
						"cline-pass": "legacy/stale-model",
					},
				}),
			);
			const onModelChange = vi.fn();
			const onProviderChange = vi.fn();
			await renderComposer({
				model: "test-model",
				onModelChange,
				onProviderChange,
				provider: "cline",
			});

			const modelSettings = container.querySelector<HTMLButtonElement>(
				'[aria-label="Model settings"]',
			);
			await act(async () => modelSettings?.click());
			const providerTrigger = await vi.waitFor(() => {
				const element = document.querySelector<HTMLButtonElement>(
					'[aria-label^="Provider:"]',
				);
				expect(element).not.toBeNull();
				return element as HTMLButtonElement;
			});
			await act(async () => providerTrigger?.click());
			const panel = [...document.querySelectorAll('[role="dialog"]')].find(
				(dialog) => dialog.querySelector('[role="option"]'),
			);
			const clinePassOption = [
				...(panel?.querySelectorAll<HTMLButtonElement>('[role="option"]') ??
					[]),
			].find((option) => option.textContent?.includes("ClinePass"));
			await act(async () => clinePassOption?.click());

			expect(onProviderChange).toHaveBeenCalledWith("cline-pass");
			// The hidden remembered model is not restored; the selection falls
			// back to the offer and the remembered slot is repaired.
			expect(onModelChange).toHaveBeenCalledWith("openai/gpt-5");
			expect(
				parseModelSelectionStorage(
					window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY),
				),
			).toEqual({
				lastProvider: "cline-pass",
				lastModelByProvider: {
					cline: "test-model",
					"cline-pass": "openai/gpt-5",
				},
			});
		});
	});

	it("attaches clipboard images on paste instead of inserting text", async () => {
		const onAttachFiles = vi.fn();
		const onPromptInputChange = vi.fn();
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
						onAttachFiles={onAttachFiles}
						onEditPromptInQueue={vi.fn()}
						onListGitBranches={vi.fn(async () => ({
							current: "main",
							branches: ["main"],
						}))}
						onModeToggle={vi.fn()}
						onModelChange={vi.fn()}
						onPromptInputChange={onPromptInputChange}
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
						summary={{ toolCalls: 0, tokensIn: 0, tokensOut: 0 }}
						thinking
					/>
				</WorkspaceProvider>,
			);
			await Promise.resolve();
		});

		const promptInput = container.querySelector<HTMLTextAreaElement>(
			'textarea[role="combobox"]',
		);
		expect(promptInput).not.toBeNull();

		const pasteWithClipboard = async (items: unknown[]) => {
			const event = new Event("paste", { bubbles: true, cancelable: true });
			Object.defineProperty(event, "clipboardData", {
				value: { items, getData: () => "" },
			});
			await act(async () => {
				promptInput?.dispatchEvent(event);
				await Promise.resolve();
			});
			return event;
		};

		const png = new File(["fake"], "image.png", { type: "image/png" });
		const imagePaste = await pasteWithClipboard([
			{ kind: "file", type: "image/png", getAsFile: () => png },
		]);
		expect(onAttachFiles).toHaveBeenCalledTimes(1);
		const attached = onAttachFiles.mock.calls[0][0] as File[];
		expect(attached).toHaveLength(1);
		expect(attached[0].name).toMatch(/^pasted-image-.+\.png$/);
		expect(imagePaste.defaultPrevented).toBe(true);

		// Plain-text pastes stay untouched so normal text pasting keeps working.
		const textPaste = await pasteWithClipboard([
			{ kind: "string", type: "text/plain", getAsFile: () => null },
		]);
		expect(onAttachFiles).toHaveBeenCalledTimes(1);
		expect(textPaste.defaultPrevented).toBe(false);
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
