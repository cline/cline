"use client";

import {
	ArrowUp,
	Brain,
	ChevronDown,
	CircleStop,
	Coins,
	Mic,
	Paperclip,
	RotateCcw,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@/components/ui/combobox";
import { useWorkspace } from "@/contexts/workspace-context";
import type { PromptInQueue } from "@/hooks/chat-session/types";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import { desktopClient } from "@/lib/desktop-client";
import {
	readModelSelectionStorageFromWindow,
	writeModelSelectionStorageToWindow,
} from "@/lib/model-selection";
import { loadProviderModelCatalog } from "@/lib/provider-model-catalog";
import { cn } from "@/lib/utils";
import { WorkspaceSelector } from "./workspace-selector";

type ActiveMention = {
	start: number;
	end: number;
	query: string;
};

const FALLBACK_PROVIDER_MODELS: Record<string, string[]> = {
	cline: ["anthropic/claude-sonnet-4.6"],
	anthropic: ["claude-sonnet-4-6"],
	openai: ["gpt-5.3-codex"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-2.5-pro"],
};

const FALLBACK_PROVIDER_REASONING_MODELS: Record<string, string[]> = {
	cline: ["anthropic/claude-sonnet-4.6"],
	anthropic: ["claude-sonnet-4-6"],
	openai: ["gpt-5.3-codex"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-2.5-pro"],
};

function hasReasoningCapability(
	providerReasoningModels: Record<string, string[]>,
	provider: string,
	model: string,
): boolean {
	return (providerReasoningModels[provider] ?? []).includes(model);
}

function getActiveMention(input: string, cursor: number): ActiveMention | null {
	if (cursor < 0 || cursor > input.length) {
		return null;
	}
	const left = input.slice(0, cursor);
	const atIndex = left.lastIndexOf("@");
	if (atIndex === -1) {
		return null;
	}
	const before = atIndex === 0 ? "" : left[atIndex - 1];
	if (before && !/\s/.test(before)) {
		return null;
	}
	const mentionBody = left.slice(atIndex + 1);
	if (!/^[^\s@]*$/.test(mentionBody)) {
		return null;
	}
	return {
		start: atIndex,
		end: cursor,
		query: mentionBody,
	};
}

type ChatInputBarProps = {
	status: ChatSessionStatus;
	provider: string;
	model: string;
	mode: "act" | "plan";
	gitBranch: string;
	promptInput: string;
	onPromptInputChange: (value: string) => void;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModeToggle: () => void;
	onRefreshGitBranch: () => void;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
	onSend: () => void;
	onAbort: () => void;
	onReset: () => void;
	promptsInQueue: PromptInQueue[];
	attachments: Array<{ id: string; name: string; isImage: boolean }>;
	onAttachFiles: (files: File[]) => void;
	onRemoveAttachment: (id: string) => void;
	onSteerPromptInQueue: (promptId: string) => void;
	summary: {
		toolCalls: number;
		tokensIn: number;
		tokensOut: number;
	};
};

export function ChatInputBar({
	status,
	provider,
	model,
	mode,
	gitBranch,
	promptInput,
	onPromptInputChange,
	onProviderChange,
	onModelChange,
	onModeToggle,
	onRefreshGitBranch,
	onListGitBranches,
	onSwitchGitBranch,
	onSend,
	onAbort,
	onReset,
	promptsInQueue,
	attachments,
	onAttachFiles,
	onRemoveAttachment,
	onSteerPromptInQueue,
	summary,
}: ChatInputBarProps) {
	const {
		workspaceRoot,
		workspaces,
		refreshWorkspaces: onRefreshWorkspaces,
		switchWorkspace: onSwitchWorkspace,
		pickWorkspaceDirectory: onPickWorkspaceDirectory,
	} = useWorkspace();
	const isBusy =
		status === "starting" || status === "running" || status === "stopping";
	const hasDraft = promptInput.trim().length > 0 || attachments.length > 0;
	const canAbort = isBusy && !hasDraft;
	const [modelSupportsReasoning, setModelSupportsReasoning] = useState(() =>
		hasReasoningCapability(FALLBACK_PROVIDER_REASONING_MODELS, provider, model),
	);
	const canSend = hasDraft;
	const effortLevels = ["Low", "Medium", "High"] as const;
	const [effortIndex, setEffortIndex] = useState(1);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
	const [cursorIndex, setCursorIndex] = useState(() => promptInput.length);
	const [mentionOpen, setMentionOpen] = useState(false);
	const [activeMention, setActiveMention] = useState<ActiveMention | null>(
		null,
	);
	const [mentionFiles, setMentionFiles] = useState<string[]>([]);
	const [mentionLoading, setMentionLoading] = useState(false);
	const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
	const mentionResultsCacheRef = useRef(new Map<string, string[]>());
	const mentionLastRequestKeyRef = useRef<string | null>(null);
	const tokensSummary = useMemo(() => {
		const total = summary.tokensIn + summary.tokensOut;
		if (total === 0) {
			return undefined;
		}
		return `${total.toLocaleString()} tokens`;
	}, [summary.tokensIn, summary.tokensOut]);
	const effortLabel = effortLevels[effortIndex];
	const handleEffortCycle = useCallback(() => {
		if (!modelSupportsReasoning) {
			return;
		}
		setEffortIndex((current) => (current + 1) % effortLevels.length);
	}, [effortLevels.length, modelSupportsReasoning]);

	useEffect(() => {
		setCursorIndex((prev) => Math.min(prev, promptInput.length));
	}, [promptInput.length]);

	useEffect(() => {
		const input = promptInputRef.current;
		if (!input) {
			return;
		}
		input.style.height = "0px";
		const styles = window.getComputedStyle(input);
		const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
		const maxHeight = lineHeight * 10;
		const nextHeight = Math.min(input.scrollHeight, maxHeight);
		input.style.height = `${nextHeight}px`;
		input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
	}, []);

	useEffect(() => {
		const nextMention = getActiveMention(promptInput, cursorIndex);
		setActiveMention(nextMention);
		setMentionOpen(nextMention !== null);
	}, [promptInput, cursorIndex]);

	useEffect(() => {
		if (!mentionOpen || !activeMention) {
			setMentionFiles([]);
			setMentionLoading(false);
			setMentionSelectedIndex(0);
			return;
		}

		const requestKey = `${workspaceRoot}::${activeMention.query}`;
		if (mentionLastRequestKeyRef.current === requestKey) {
			return;
		}
		mentionLastRequestKeyRef.current = requestKey;
		const cached = mentionResultsCacheRef.current.get(requestKey);
		if (cached) {
			setMentionFiles(cached);
			setMentionSelectedIndex(0);
			setMentionLoading(false);
			return;
		}

		let cancelled = false;
		const timeoutId = window.setTimeout(async () => {
			if (mentionFiles.length === 0) {
				setMentionLoading(true);
			}
			try {
				const results = await desktopClient.invoke<string[]>(
					"search_workspace_files",
					{
						workspaceRoot,
						query: activeMention.query,
						limit: 10,
					},
				);
				if (cancelled) {
					return;
				}
				const nextResults = Array.isArray(results) ? results : [];
				mentionResultsCacheRef.current.set(requestKey, nextResults);
				setMentionFiles(nextResults);
				setMentionSelectedIndex(0);
			} catch {
				if (cancelled) {
					return;
				}
				if (mentionFiles.length === 0) {
					setMentionFiles([]);
				}
			} finally {
				if (!cancelled) {
					setMentionLoading(false);
				}
			}
		}, 120);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [activeMention, mentionOpen, workspaceRoot, mentionFiles.length]);

	const insertMentionFile = useCallback(
		(filePath: string) => {
			if (!activeMention) {
				return;
			}
			const nextValue =
				`${promptInput.slice(0, activeMention.start)}@${filePath} ` +
				promptInput.slice(activeMention.end);
			onPromptInputChange(nextValue);
			setMentionOpen(false);
			const nextCursor = activeMention.start + filePath.length + 2;
			requestAnimationFrame(() => {
				const input = promptInputRef.current;
				if (!input) {
					return;
				}
				input.focus();
				input.setSelectionRange(nextCursor, nextCursor);
				setCursorIndex(nextCursor);
			});
		},
		[activeMention, onPromptInputChange, promptInput],
	);

	return (
		<div className="border-t border-border bg-card">
			{/* Input area */}
			<div className="px-4 py-3">
				{promptsInQueue.length > 0 && (
					<div className="mb-3 rounded-lg border border-border bg-background/70 p-2">
						<div className="mb-2 flex items-center justify-between gap-2">
							<div className="text-[11px] font-medium text-foreground">
								Queued for upcoming turns
							</div>
							<div className="text-[10px] text-muted-foreground">
								Steer runs first on the next turn
							</div>
						</div>
						<div className="flex flex-col gap-1.5">
							{promptsInQueue.map((item, index) => (
								<div
									className={cn(
										"flex items-start justify-between gap-3 rounded-md border px-2.5 py-2",
										item.steer
											? "border-amber-300/60 bg-amber-500/8"
											: "border-border/70 bg-muted/30",
									)}
									key={item.id}
								>
									<div className="min-w-0 flex-1">
										<div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
											<span>{item.steer ? "Steer" : `Queue ${index + 1}`}</span>
											{item.steer ? (
												<span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
													Next turn
												</span>
											) : null}
										</div>
										<div className="line-clamp-2 text-xs text-foreground whitespace-pre-wrap wrap-break-word">
											{item.prompt}
										</div>
									</div>
									{!item.steer ? (
										<button
											className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
											onClick={() => onSteerPromptInQueue(item.id)}
											type="button"
										>
											Steer
										</button>
									) : (
										<div className="shrink-0 text-[10px] text-amber-700">
											Steering
										</div>
									)}
								</div>
							))}
						</div>
					</div>
				)}
				<div className="relative">
					{mentionOpen && (
						<div className="absolute inset-x-0 bottom-full z-50 mb-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
							{mentionFiles.length === 0 ? (
								<div className="px-3 py-2 text-xs text-muted-foreground">
									{mentionLoading ? "Searching files..." : "No matching files"}
								</div>
							) : (
								<>
									{mentionFiles.map((filePath, index) => (
										<button
											className={cn(
												"block w-full rounded-md px-3 py-2 text-left text-xs transition-colors",
												index === mentionSelectedIndex
													? "bg-accent text-foreground"
													: "text-muted-foreground hover:bg-accent hover:text-foreground",
											)}
											key={filePath}
											onClick={() => insertMentionFile(filePath)}
											type="button"
										>
											{filePath}
										</button>
									))}
									{mentionLoading && (
										<div className="px-3 py-1 text-[10px] text-muted-foreground">
											Updating...
										</div>
									)}
								</>
							)}
						</div>
					)}
					<div className="flex items-end gap-2 rounded-lg border border-border bg-background px-3 py-2.5 transition-all focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
						<textarea
							className="max-h-60 min-h-5 flex-1 resize-none bg-transparent text-sm leading-5 text-foreground placeholder:text-muted-foreground outline-none"
							onChange={(e) => {
								onPromptInputChange(e.target.value);
								setCursorIndex(
									e.target.selectionStart ?? e.target.value.length,
								);
							}}
							onClick={(e) =>
								setCursorIndex(
									e.currentTarget.selectionStart ?? promptInput.length,
								)
							}
							onKeyDown={(e) => {
								if (mentionOpen && mentionFiles.length > 0) {
									if (e.key === "ArrowDown") {
										e.preventDefault();
										setMentionSelectedIndex(
											(prev) => (prev + 1) % mentionFiles.length,
										);
										return;
									}
									if (e.key === "ArrowUp") {
										e.preventDefault();
										setMentionSelectedIndex(
											(prev) =>
												(prev - 1 + mentionFiles.length) % mentionFiles.length,
										);
										return;
									}
									if (e.key === "Enter" || e.key === "Tab") {
										e.preventDefault();
										insertMentionFile(mentionFiles[mentionSelectedIndex]);
										return;
									}
								}
								if (mentionOpen && e.key === "Escape") {
									e.preventDefault();
									setMentionOpen(false);
									return;
								}
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									if (canSend) {
										onSend();
									} else if (canAbort) {
										onAbort();
									}
								}
							}}
							onKeyUp={(e) =>
								setCursorIndex(
									e.currentTarget.selectionStart ?? promptInput.length,
								)
							}
							placeholder={
								isBusy
									? "Agent is working... submit to queue another message"
									: "Enter your question or type / for workflow or @ to attach files"
							}
							ref={promptInputRef}
							rows={1}
							value={promptInput}
						/>
					</div>
				</div>
				{attachments.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{attachments.map((attachment) => (
							<span
								className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs text-foreground"
								key={attachment.id}
							>
								{attachment.isImage ? "image:" : "file:"} {attachment.name}
								<button
									className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
									onClick={() => onRemoveAttachment(attachment.id)}
									type="button"
								>
									<X className="h-3 w-3" />
								</button>
							</span>
						))}
					</div>
				)}
			</div>

			{/* Controls row */}
			<div className="flex items-center justify-between px-4 pb-2">
				<div className="flex items-center gap-1">
					<button
						className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						onClick={() => fileInputRef.current?.click()}
						type="button"
					>
						<Paperclip className="h-4 w-4" />
					</button>
					<input
						accept="*/*"
						className="hidden"
						multiple
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							if (files.length > 0) {
								onAttachFiles(files);
							}
							event.currentTarget.value = "";
						}}
						ref={fileInputRef}
						type="file"
					/>

					<ModelSelector
						isBusy={isBusy}
						model={model}
						onModelChange={onModelChange}
						onModelSupportsReasoningChange={setModelSupportsReasoning}
						onProviderChange={onProviderChange}
						provider={provider}
					/>
				</div>

				<div className="flex items-center gap-1">
					<button
						className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						type="button"
					>
						<Mic className="h-4 w-4" />
					</button>
					<button
						className="rounded-full bg-foreground p-1.5 text-background hover:bg-foreground/80 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
						disabled={!canSend && !canAbort}
						onClick={canSend ? onSend : onAbort}
						type="button"
					>
						{canSend ? (
							<ArrowUp className="h-4 w-4" />
						) : (
							<CircleStop className="h-4 w-4" />
						)}
					</button>
				</div>
			</div>

			{/* Status bar */}
			<div className="flex items-center justify-between border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
				<div className="flex items-center gap-3">
					<StatusItem
						label={mode === "act" ? "Act" : "Plan"}
						onClick={onModeToggle}
					/>
					<StatusItem
						disabled={!modelSupportsReasoning}
						icon={Brain}
						label={effortLabel}
						onClick={handleEffortCycle}
					/>
					{tokensSummary && (
						<StatusItem icon={Coins} label={tokensSummary} hasOption={false} />
					)}
				</div>
				{/* GIT BRANCH */}
				<div className="flex items-center gap-3">
					<WorkspaceSelector
						currentBranch={gitBranch}
						onListGitBranches={onListGitBranches}
						onRefreshWorkspaces={onRefreshWorkspaces}
						onPickWorkspaceDirectory={onPickWorkspaceDirectory}
						onSwitchGitBranch={onSwitchGitBranch}
						onSwitchWorkspace={onSwitchWorkspace}
						workspaces={workspaces}
						workspaceRoot={workspaceRoot}
					/>
					<button
						className="hidden items-center gap-1 hover:text-foreground transition-colors"
						onClick={onRefreshGitBranch}
						type="button"
					>
						<RotateCcw className="h-3 w-3" />
					</button>
					<button
						className="hidden items-center gap-1 hover:text-foreground transition-colors"
						onClick={onReset}
						type="button"
					>
						<RotateCcw className="h-4 w-4" />
					</button>
				</div>
			</div>
		</div>
	);
}

function ModelSelector({
	provider,
	model,
	isBusy,
	onProviderChange,
	onModelChange,
	onModelSupportsReasoningChange,
}: {
	provider: string;
	model: string;
	isBusy: boolean;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModelSupportsReasoningChange: (supportsReasoning: boolean) => void;
}) {
	const [providerModels, setProviderModels] = useState<
		Record<string, string[]>
	>(FALLBACK_PROVIDER_MODELS);
	const [providerReasoningModels, setProviderReasoningModels] = useState<
		Record<string, string[]>
	>(FALLBACK_PROVIDER_REASONING_MODELS);
	const [enabledProviderIds, setEnabledProviderIds] = useState<string[]>([]);
	const [lastSelection, setLastSelection] = useState(() =>
		readModelSelectionStorageFromWindow(),
	);
	const visibleProviderModels = useMemo(() => {
		const next: Record<string, string[]> = {};
		for (const providerId of enabledProviderIds) {
			next[providerId] = providerModels[providerId] ?? [];
		}
		return next;
	}, [enabledProviderIds, providerModels]);
	const providers = useMemo(
		() => Object.keys(visibleProviderModels),
		[visibleProviderModels],
	);
	const resolvedProvider = useMemo(() => {
		if (providers.length === 0) {
			return "";
		}
		const rememberedProvider = lastSelection.lastProvider.trim();
		if (provider && providers.includes(provider)) {
			return provider;
		}
		if (rememberedProvider && providers.includes(rememberedProvider)) {
			return rememberedProvider;
		}
		return providers[0] ?? "";
	}, [lastSelection.lastProvider, provider, providers]);
	const modelsForProvider = useMemo(
		() => visibleProviderModels[resolvedProvider] ?? [],
		[resolvedProvider, visibleProviderModels],
	);
	const resolvedModel = useMemo(() => {
		if (modelsForProvider.length === 0) {
			return "";
		}
		const rememberedModel = lastSelection.lastModelByProvider[resolvedProvider];
		if (model && modelsForProvider.includes(model)) {
			return model;
		}
		if (rememberedModel && modelsForProvider.includes(rememberedModel)) {
			return rememberedModel;
		}
		return modelsForProvider[0] ?? "";
	}, [
		lastSelection.lastModelByProvider,
		model,
		modelsForProvider,
		resolvedProvider,
	]);

	useEffect(() => {
		let cancelled = false;

		async function loadCatalog() {
			try {
				const payload = await loadProviderModelCatalog();
				if (cancelled) {
					return;
				}
				setProviderModels(payload.providerModels);
				setProviderReasoningModels(payload.providerReasoningModels);
				setEnabledProviderIds(payload.enabledProviderIds);
			} catch {
				// Keep local fallback values when provider catalog is unavailable.
			}
		}

		void loadCatalog();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		setLastSelection((prev) => {
			if (!provider || !model) {
				return prev;
			}
			if (
				prev.lastProvider === provider &&
				prev.lastModelByProvider[provider] === model
			) {
				return prev;
			}
			return {
				lastProvider: provider,
				lastModelByProvider: {
					...prev.lastModelByProvider,
					[provider]: model,
				},
			};
		});
	}, [model, provider]);

	useEffect(() => {
		try {
			writeModelSelectionStorageToWindow(lastSelection);
		} catch {
			// Ignore localStorage persistence failures.
		}
	}, [lastSelection]);

	useEffect(() => {
		if (providers.length === 0) {
			return;
		}
		if (resolvedProvider && resolvedProvider !== provider) {
			onProviderChange(resolvedProvider);
		}
		if (resolvedModel && resolvedModel !== model) {
			onModelChange(resolvedModel);
		}
	}, [
		model,
		onModelChange,
		onProviderChange,
		provider,
		providers,
		resolvedModel,
		resolvedProvider,
	]);

	useEffect(() => {
		onModelSupportsReasoningChange(
			hasReasoningCapability(providerReasoningModels, provider, model),
		);
	}, [
		model,
		onModelSupportsReasoningChange,
		provider,
		providerReasoningModels,
	]);

	return (
		<div className="flex items-center gap-1 text-xxs">
			<Combobox
				items={providers}
				onValueChange={(value) => {
					if (!value) {
						return;
					}
					onProviderChange(value);
					const rememberedModel = lastSelection.lastModelByProvider[value];
					const providerModelIds = visibleProviderModels[value] ?? [];
					if (
						rememberedModel &&
						providerModelIds.includes(rememberedModel) &&
						rememberedModel !== model
					) {
						onModelChange(rememberedModel);
						return;
					}
					const firstModel = providerModelIds[0];
					if (firstModel && firstModel !== model) {
						onModelChange(firstModel);
					}
				}}
				value={resolvedProvider}
			>
				<ComboboxInput
					className="h-7 text-xxs"
					disabled={isBusy || providers.length === 0}
					readOnly
					showClear={false}
					showTrigger
				/>
				<ComboboxContent>
					<ComboboxEmpty>No providers found.</ComboboxEmpty>
					<ComboboxList>
						{(item) => (
							<ComboboxItem className="text-xxs" key={item} value={item}>
								{item}
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>

			<Combobox
				items={modelsForProvider}
				onValueChange={(value) => {
					if (!value) {
						return;
					}
					onModelChange(value);
				}}
				value={resolvedModel}
			>
				<ComboboxInput
					className="h-7"
					disabled={isBusy || modelsForProvider.length === 0}
					readOnly
					showClear={false}
					showTrigger
				/>
				<ComboboxContent>
					<ComboboxEmpty>No models found.</ComboboxEmpty>
					<ComboboxList>
						{(item) => (
							<ComboboxItem className="text-xxs" key={item} value={item}>
								{item}
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
		</div>
	);
}

function StatusItem({
	icon: Icon,
	label,
	onClick,
	disabled,
	hasOption = true,
}: {
	icon?: React.ComponentType<{ className?: string }>;
	label: string;
	onClick?: () => void;
	disabled?: boolean;
	hasOption?: boolean;
}) {
	return (
		<button
			className={cn(
				"flex items-center gap-1 transition-colors",
				disabled ? "cursor-not-allowed opacity-60" : "hover:text-foreground",
			)}
			disabled={disabled}
			onClick={onClick}
			type="button"
		>
			{Icon ? <Icon className="h-3 w-3" /> : null}
			<span>{label}</span>
			{hasOption ? <ChevronDown className="h-2.5 w-2.5" /> : null}
		</button>
	);
}
