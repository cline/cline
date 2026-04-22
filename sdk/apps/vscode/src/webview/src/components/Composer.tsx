import {
	BrainIcon,
	CheckIcon,
	PaperclipIcon,
	Settings2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	Attachment,
	AttachmentPreview,
	AttachmentRemove,
	Attachments,
} from "@/components/ai-elements/attachments";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorLogo,
	ModelSelectorLogoGroup,
	ModelSelectorName,
	ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputHeader,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
	usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ProviderOption } from "@/types";
import type {
	WebviewChatAttachments,
	WebviewProviderModel,
} from "../../../webview-protocol";

function PromptAttachmentsDisplay() {
	const attachments = usePromptInputAttachments();

	if (attachments.files.length === 0) {
		return null;
	}

	return (
		<Attachments variant="inline">
			{attachments.files.map((attachment) => (
				<Attachment
					data={attachment}
					key={attachment.id}
					onRemove={() => attachments.remove(attachment.id)}
				>
					<AttachmentPreview />
					<AttachmentRemove />
				</Attachment>
			))}
		</Attachments>
	);
}

function ComposerSettings({
	autoApproveTools,
	enableSpawn,
	enableTeams,
	model,
	modelSelectorOpen,
	models,
	onAutoApproveToolsChange,
	onEnableSpawnChange,
	onEnableTeamsChange,
	onModelChange,
	onModelSelectorOpenChange,
	onProviderChange,
	provider,
	providers,
	workspaceRoot,
}: {
	autoApproveTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	enableTools: boolean;
	maxIterations: string;
	model: string;
	modelSelectorOpen: boolean;
	models: WebviewProviderModel[];
	onAutoApproveToolsChange: (value: boolean) => void;
	onEnableSpawnChange: (value: boolean) => void;
	onEnableTeamsChange: (value: boolean) => void;
	onEnableToolsChange: (value: boolean) => void;
	onMaxIterationsChange: (value: string) => void;
	onModelChange: (value: string) => void;
	onModelSelectorOpenChange: (value: boolean) => void;
	onProviderChange: (value: string) => void;
	onSystemPromptChange: (value: string) => void;
	provider: string;
	providers: ProviderOption[];
	systemPrompt: string;
	workspaceRoot: string;
}) {
	const selectedProvider = providers.find((item) => item.id === provider);
	const selectedModel =
		models.find((item) => item.id === model) ?? models[0] ?? undefined;

	return (
		<div className="grid gap-3 bg-background/70 p-3">
			<div className="grid gap-2 md:grid-cols-2">
				<div className="grid gap-2">
					<Label className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
						Provider
					</Label>
					<Select
						onValueChange={(value) => {
							if (value) {
								onProviderChange(value);
							}
						}}
						value={provider}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select provider" />
						</SelectTrigger>
						<SelectContent>
							{providers.map((item) => (
								<SelectItem key={item.id} value={item.id}>
									<div className="flex items-center gap-2">
										{renderProviderLogo(item.id)}
										<span>{item.name}</span>
									</div>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="grid gap-2">
					<Label className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
						Model
					</Label>
					<ModelSelector
						onOpenChange={onModelSelectorOpenChange}
						open={modelSelectorOpen}
					>
						<ModelSelectorTrigger>
							<Button className="w-full justify-between" variant="outline">
								<div className="flex min-w-0 items-center gap-2">
									{selectedProvider && renderProviderLogo(selectedProvider.id)}
									<span className="truncate">
										{selectedModel?.name || selectedModel?.id || "Select model"}
									</span>
								</div>
							</Button>
						</ModelSelectorTrigger>
						<ModelSelectorContent>
							<ModelSelectorInput placeholder="Search models..." />
							<ModelSelectorList>
								<ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
								<ModelSelectorGroup
									heading={selectedProvider?.name || "Models"}
								>
									{models.map((item) => (
										<ModelSelectorItem
											key={item.id}
											onSelect={() => {
												onModelChange(item.id);
												onModelSelectorOpenChange(false);
											}}
											value={item.id}
										>
											{selectedProvider &&
												renderProviderLogo(selectedProvider.id)}
											<ModelSelectorName>
												{item.name || item.id}
											</ModelSelectorName>
											<ModelSelectorLogoGroup>
												{selectedProvider &&
													renderProviderLogo(selectedProvider.id)}
											</ModelSelectorLogoGroup>
											{model === item.id ? (
												<CheckIcon className="ml-auto size-4" />
											) : (
												<div className="ml-auto size-4" />
											)}
										</ModelSelectorItem>
									))}
								</ModelSelectorGroup>
							</ModelSelectorList>
						</ModelSelectorContent>
					</ModelSelector>
				</div>
			</div>
			<div className="grid gap-2 md:grid-cols-2">
				<div className="grid gap-2">
					<Label
						className="text-xs uppercase tracking-[0.16em] text-muted-foreground"
						htmlFor="workspace-root"
					>
						Workspace
					</Label>
					<Input id="workspace-root" readOnly value={workspaceRoot} />
				</div>
			</div>
			<div className="grid gap-2 md:grid-cols-2">
				<Toggle
					checked={enableSpawn}
					label="Subagents"
					onChange={onEnableSpawnChange}
				/>
				<Toggle
					checked={enableTeams}
					label="Agent Teams"
					onChange={onEnableTeamsChange}
				/>
				<Toggle
					checked={autoApproveTools}
					label="Auto-approves"
					onChange={onAutoApproveToolsChange}
				/>
			</div>
		</div>
	);
}

function renderProviderLogo(providerId: string) {
	return (
		<ModelSelectorLogo className="size-3.5" provider={providerId || "openai"} />
	);
}

function Toggle({
	checked,
	label,
	onChange,
	disabled,
}: {
	checked: boolean;
	label: string;
	onChange: (value: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<div className="flex items-center justify-between rounded-lg border bg-background/60 px-3 py-2">
			<Label className="text-sm" htmlFor={label}>
				{label}
			</Label>
			<Switch
				checked={checked}
				id={label}
				onCheckedChange={(value) => onChange(value)}
				disabled={disabled}
			/>
		</div>
	);
}

export function Composer({
	autoApproveTools,
	enableSpawn,
	enableTeams,
	enableTools,
	maxIterations,
	model,
	mode,
	modelSelectorOpen,
	models,
	onAbort,
	onAutoApproveToolsChange,
	onEnableSpawnChange,
	onEnableTeamsChange,
	onEnableToolsChange,
	onModeChange,
	onMaxIterationsChange,
	onModelChange,
	onModelSelectorOpenChange,
	onProviderChange,
	onSend,
	onSystemPromptChange,
	onThinkingChange,
	provider,
	providers,
	sending,
	status,
	systemPrompt,
	thinking,
	workspaceRoot,
}: {
	autoApproveTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	enableTools: boolean;
	maxIterations: string;
	model: string;
	mode: "act" | "plan";
	modelSelectorOpen: boolean;
	models: WebviewProviderModel[];
	onAbort: () => void;
	onAutoApproveToolsChange: (value: boolean) => void;
	onEnableSpawnChange: (value: boolean) => void;
	onEnableTeamsChange: (value: boolean) => void;
	onEnableToolsChange: (value: boolean) => void;
	onModeChange: (value: "act" | "plan") => void;
	onMaxIterationsChange: (value: string) => void;
	onModelChange: (value: string) => void;
	onModelSelectorOpenChange: (value: boolean) => void;
	onProviderChange: (value: string) => void;
	onSend: (input: {
		prompt: string;
		attachments?: WebviewChatAttachments;
		attachmentCount: number;
	}) => void;
	onSystemPromptChange: (value: string) => void;
	onThinkingChange: (value: boolean) => void;
	provider: string;
	providers: ProviderOption[];
	sending: boolean;
	status: string;
	systemPrompt: string;
	thinking: boolean;
	workspaceRoot: string;
}) {
	const [settingsOpen, setSettingsOpen] = useState(false);
	const controller = usePromptInputController();
	const attachments = usePromptInputAttachments();
	const selectedModel = models.find((item) => item.id === model);
	const thinkingSupported = selectedModel?.supportsThinking === true;

	return (
		<div className="border-t bg-background">
			<PromptInput
				accept="image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx"
				globalDrop
				className="[&>div]:border-0 rounded-none"
				maxFiles={8}
				multiple
				onError={(error) => toast.error(error.message)}
				onSubmit={async (message: PromptInputMessage) => {
					const prompt = message.text.trim();
					if (!prompt && !message.files.length) {
						return;
					}

					let attachments: WebviewChatAttachments | undefined;
					if (message.files.length > 0) {
						const userImages = (
							await Promise.all(
								message.files.map((file) => toImageDataUrl(file.url)),
							)
						).filter((value): value is string => Boolean(value));
						if (userImages.length > 0) {
							attachments = { userImages };
						}
						if (userImages.length !== message.files.length) {
							toast.warning(
								"Only image attachments are currently sent in the VS Code chat runtime.",
							);
						}
					}

					if (!prompt && !attachments?.userImages?.length) {
						return;
					}

					onSend({
						prompt,
						attachments,
						attachmentCount: message.files.length,
					});
				}}
			>
				<PromptInputHeader>
					<PromptAttachmentsDisplay />
				</PromptInputHeader>
				<PromptInputBody>
					<PromptInputTextarea
						disabled={status.includes("Failed")}
						onChange={(event) =>
							controller.textInput.setInput(event.target.value)
						}
						placeholder="Enter your question here..."
						value={controller.textInput.value}
						className="text-sm"
					/>
				</PromptInputBody>
				<PromptInputFooter className="flex-col items-stretch gap-1 px-0">
					{settingsOpen ? (
						<ComposerSettings
							autoApproveTools={autoApproveTools}
							enableSpawn={enableSpawn}
							enableTeams={enableTeams}
							enableTools={enableTools}
							maxIterations={maxIterations}
							model={model}
							modelSelectorOpen={modelSelectorOpen}
							models={models}
							onAutoApproveToolsChange={onAutoApproveToolsChange}
							onEnableSpawnChange={onEnableSpawnChange}
							onEnableTeamsChange={onEnableTeamsChange}
							onEnableToolsChange={onEnableToolsChange}
							onMaxIterationsChange={onMaxIterationsChange}
							onModelChange={onModelChange}
							onModelSelectorOpenChange={onModelSelectorOpenChange}
							onProviderChange={onProviderChange}
							onSystemPromptChange={onSystemPromptChange}
							provider={provider}
							providers={providers}
							systemPrompt={systemPrompt}
							workspaceRoot={workspaceRoot}
						/>
					) : null}
					<div className="flex items-center justify-between gap-3">
						<PromptInputTools className="shrink-0">
							<PromptInputButton
								onClick={() => attachments.openFileDialog()}
								type="button"
								variant="ghost"
							>
								<PaperclipIcon className="size-3" />
							</PromptInputButton>
							<PromptInputButton
								onClick={() => setSettingsOpen((open) => !open)}
								type="button"
								variant={settingsOpen ? "default" : "ghost"}
							>
								<Settings2Icon className="size-3" />
								<span>
									{provider}:{model}
								</span>
							</PromptInputButton>
							<PromptInputButton
								disabled={!thinkingSupported}
								onClick={() => onThinkingChange(!thinking)}
								type="button"
								variant={thinking ? "default" : "ghost"}
							>
								<BrainIcon className="size-3" />
							</PromptInputButton>
							<PromptInputButton
								onClick={() => onModeChange(mode === "act" ? "plan" : "act")}
								type="button"
								variant={mode === "plan" ? "default" : "ghost"}
							>
								{mode}
							</PromptInputButton>
							<Badge
								className="rounded-sm px-3 py-1 text-xs hidden"
								variant={status.includes("Error") ? "destructive" : "secondary"}
							>
								{status}
							</Badge>
						</PromptInputTools>
						<div className="flex items-center gap-2">
							{sending ? (
								<Button onClick={onAbort} type="button" variant="destructive">
									Abort
								</Button>
							) : null}
							<PromptInputSubmit
								disabled={status.includes("Failed")}
								status={sending ? "submitted" : "ready"}
								variant="ghost"
							/>
						</div>
					</div>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}

async function toImageDataUrl(
	url: string | undefined,
): Promise<string | undefined> {
	if (!url) {
		return undefined;
	}
	if (url.startsWith("data:image/")) {
		return url;
	}
	if (!url.startsWith("blob:")) {
		return undefined;
	}
	try {
		const response = await fetch(url);
		const blob = await response.blob();
		if (!blob.type.startsWith("image/")) {
			return undefined;
		}
		return await new Promise((resolve) => {
			const reader = new FileReader();
			reader.onloadend = () => {
				resolve(typeof reader.result === "string" ? reader.result : undefined);
			};
			reader.onerror = () => resolve(undefined);
			reader.readAsDataURL(blob);
		});
	} catch {
		return undefined;
	}
}
