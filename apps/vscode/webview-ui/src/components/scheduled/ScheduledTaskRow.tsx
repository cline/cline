import type { ProviderListing } from "@shared/proto/cline/models"
import { PlanActMode } from "@shared/proto/cline/state"
import type { ScheduledTask } from "@shared/scheduled-next-task"
import type { Mode } from "@shared/storage/types"
import { ArrowDownIcon, ArrowUpIcon, PlayIcon, Trash2Icon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useProviderModels } from "@/hooks/useProviderModels"

/** Radix `Select` rejects an empty item value, so "no pin" needs a sentinel. */
const CURRENT_PROVIDER_VALUE = "__current_provider__"
/** Same for the model field: "use whatever this provider is configured with". */
const PROVIDER_DEFAULT_MODEL_VALUE = "__provider_default_model__"

interface ScheduledTaskRowProps {
	task: ScheduledTask
	index: number
	total: number
	providers: ProviderListing[]
	onPatch: (patch: Partial<ScheduledTask>) => void
	onMove: (direction: "up" | "down") => void
	onDelete: () => void
	onRunNow: () => void
}

/**
 * One row of the "Scheduled Tasks" queue. Everything on it is scoped to this
 * chat: what it says, whether it plans or acts, whether it carries a summary of
 * the task it follows, and which provider/model it runs on. The row's position in
 * the list is when it runs, so the move buttons live on the row itself.
 *
 * Text fields keep a local draft and commit on blur, so a state push from the
 * extension (the chat behind this view keeps streaming) cannot overwrite a
 * message half-typed.
 */
export const ScheduledTaskRow = ({
	task,
	index,
	total,
	providers,
	onPatch,
	onMove,
	onDelete,
	onRunNow,
}: ScheduledTaskRowProps) => {
	const [messageDraft, setMessageDraft] = useState(task.message)
	const isEditingMessage = useRef(false)

	useEffect(() => {
		if (!isEditingMessage.current) {
			setMessageDraft(task.message)
		}
	}, [task.message])

	const commitMessage = () => {
		isEditingMessage.current = false
		if (messageDraft !== task.message) {
			onPatch({ message: messageDraft })
		}
	}

	return (
		<div
			className="flex flex-col gap-3 rounded-md border border-border bg-editor-section-background p-3"
			data-testid={`scheduled-task-row-${task.id}`}>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<span
						className="flex size-5 items-center justify-center rounded-full bg-button-background/20 text-xs font-medium"
						data-testid={`scheduled-task-position-${task.id}`}>
						{index + 1}
					</span>
					<span className="text-xs text-description">
						{index === 0
							? "Runs when the current chat finishes"
							: `Runs after ${index} scheduled chat${index === 1 ? "" : "s"}`}
					</span>
				</div>
				<div className="flex items-center gap-0.5">
					<Button
						aria-label="Move this scheduled task earlier"
						disabled={index === 0}
						onClick={() => onMove("up")}
						size="icon"
						title="Move up (runs earlier)"
						variant="icon">
						<ArrowUpIcon />
					</Button>
					<Button
						aria-label="Move this scheduled task later"
						disabled={index === total - 1}
						onClick={() => onMove("down")}
						size="icon"
						title="Move down (runs later)"
						variant="icon">
						<ArrowDownIcon />
					</Button>
					<Button
						aria-label="Run this scheduled task now"
						onClick={onRunNow}
						size="icon"
						title="Start this chat now"
						variant="icon">
						<PlayIcon />
					</Button>
					<Button aria-label="Delete this scheduled task" onClick={onDelete} size="icon" title="Delete" variant="icon">
						<Trash2Icon />
					</Button>
				</div>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`scheduled-task-message-${task.id}`}>Message</Label>
				<textarea
					className="ph-no-capture min-h-20 w-full resize-y rounded-sm border border-input-foreground/20 bg-input-background px-3 py-2 text-sm text-input-foreground placeholder:text-input-placeholder focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-input-border"
					data-testid="scheduled-task-message"
					id={`scheduled-task-message-${task.id}`}
					onBlur={commitMessage}
					onChange={(event) => setMessageDraft(event.target.value)}
					onFocus={() => {
						isEditingMessage.current = true
					}}
					placeholder="What should this chat work on? (optional — empty starts from the previous summary)"
					value={messageDraft}
				/>
			</div>

			<div className="flex items-center justify-between gap-3">
				<Label>Mode</Label>
				<div aria-label="Mode for this scheduled chat" className="flex gap-1" role="group">
					{(["plan", "act"] as Mode[]).map((modeOption) => (
						<Button
							aria-pressed={task.mode === modeOption}
							key={modeOption}
							onClick={() => task.mode !== modeOption && onPatch({ mode: modeOption })}
							size="sm"
							variant={task.mode === modeOption ? "secondary" : "ghost"}>
							{modeOption === "plan" ? "Plan" : "Act"}
						</Button>
					))}
				</div>
			</div>

			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-col gap-0.5">
					<Label htmlFor={`scheduled-task-summary-${task.id}`}>Include summary of previous task</Label>
					<span className="text-xs text-description">Opens this chat with a summary of the task before it.</span>
				</div>
				<Switch
					checked={task.includeSummary}
					data-testid="scheduled-task-summary"
					id={`scheduled-task-summary-${task.id}`}
					onCheckedChange={(checked) => onPatch({ includeSummary: checked })}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`scheduled-task-provider-${task.id}`}>Model provider</Label>
				<Select
					onValueChange={(value) =>
						onPatch({
							providerId: value === CURRENT_PROVIDER_VALUE ? undefined : value,
							// A model id belongs to one provider: switching provider
							// must never carry a stale model across to it.
							modelId: undefined,
						})
					}
					value={task.providerId ?? CURRENT_PROVIDER_VALUE}>
					<SelectTrigger className="w-full" id={`scheduled-task-provider-${task.id}`} size="sm">
						<SelectValue placeholder="Current configuration" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem data-testid="scheduled-task-provider-current" value={CURRENT_PROVIDER_VALUE}>
							Current configuration
						</SelectItem>
						{providers.map((provider) => (
							<SelectItem key={provider.id} value={provider.id}>
								{provider.name || provider.id}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<span className="text-xs text-description" data-testid="scheduled-task-provider-note">
					{task.providerId
						? "Uses this provider with its saved credentials; nothing you configured globally is changed."
						: "Uses whichever provider is configured when the chat starts."}
				</span>
			</div>

			{/* The model list is fetched for the pinned provider, so the model field
				is mounted only when there is a provider to fetch it for. */}
			{task.providerId ? (
				<ScheduledTaskModelField
					modelId={task.modelId}
					onModelChange={(modelId) => onPatch({ modelId })}
					providerId={task.providerId}
				/>
			) : (
				<div className="flex flex-col gap-1.5">
					<Label>Model</Label>
					<span className="text-xs text-description" data-testid="scheduled-task-model-inherited">
						Inherited from the current configuration.
					</span>
				</div>
			)}
		</div>
	)
}

interface ScheduledTaskModelFieldProps {
	providerId: string
	modelId?: string
	onModelChange: (modelId: string | undefined) => void
}

/**
 * Model id for a pinned provider: the provider's catalog list for quick picking
 * plus a free-text field, because local endpoints (Ollama, LM Studio) and
 * gateways accept ids the catalog has never heard of. An unpinned row never
 * renders this — it inherits the model that is configured when the chat starts.
 */
export const ScheduledTaskModelField = ({ providerId, modelId, onModelChange }: ScheduledTaskModelFieldProps) => {
	const [modelDraft, setModelDraft] = useState(modelId ?? "")
	const isEditingModel = useRef(false)
	const { models, defaultModelId, isLoading, error } = useProviderModels(providerId)

	useEffect(() => {
		if (!isEditingModel.current) {
			setModelDraft(modelId ?? "")
		}
	}, [modelId])

	const modelEntries = useMemo(() => {
		const entries = Object.entries(models)
			.map(([id, info]) => ({ id, name: info?.name || id }))
			.sort((a, b) => a.name.localeCompare(b.name))
		if (modelId && !entries.some((entry) => entry.id === modelId)) {
			// Keep a custom id selectable so the trigger never renders blank.
			entries.unshift({ id: modelId, name: `${modelId} (custom)` })
		}
		return entries
	}, [modelId, models])

	const commitModel = () => {
		isEditingModel.current = false
		const next = modelDraft.trim()
		if (next !== (modelId ?? "")) {
			onModelChange(next || undefined)
		}
	}

	return (
		<div className="flex flex-col gap-1.5">
			<Label>Model</Label>
			<div className="flex gap-2">
				<Select
					onValueChange={(value) => {
						const next = value === PROVIDER_DEFAULT_MODEL_VALUE ? "" : value
						setModelDraft(next)
						onModelChange(next || undefined)
					}}
					value={modelId || PROVIDER_DEFAULT_MODEL_VALUE}>
					<SelectTrigger className="flex-1" size="sm">
						<SelectValue placeholder="Provider default" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem data-testid="scheduled-task-model-default" value={PROVIDER_DEFAULT_MODEL_VALUE}>
							Provider default{defaultModelId ? ` (${defaultModelId})` : ""}
						</SelectItem>
						{modelEntries.map((entry) => (
							<SelectItem key={entry.id} value={entry.id}>
								{entry.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Input
					className="flex-1"
					data-testid="scheduled-task-model-id"
					onBlur={commitModel}
					onChange={(event) => setModelDraft(event.target.value)}
					onFocus={() => {
						isEditingModel.current = true
					}}
					placeholder={defaultModelId || "model id"}
					value={modelDraft}
				/>
			</div>
			<span className="text-xs text-description" data-testid="scheduled-task-model-status">
				{error
					? `Model list unavailable: ${error}`
					: isLoading
						? "Loading models…"
						: "Pick one from the list, or type any model id."}
			</span>
		</div>
	)
}

/**
 * Maps a shared row to the wire shape. Blank pins are sent as empty strings,
 * which the extension normalizes back to "no pin" — sending `undefined` through
 * the generated client would drop the field and leave the previous pin in place.
 */
export function scheduledTaskToProto(task: ScheduledTask) {
	return {
		id: task.id,
		message: task.message,
		mode: task.mode === "plan" ? PlanActMode.PLAN : PlanActMode.ACT,
		includeSummary: task.includeSummary,
		providerId: task.providerId ?? "",
		modelId: task.modelId ?? "",
		createdAt: task.createdAt,
	}
}
