import { ApertureIcon, HandIcon, HeadphonesIcon, MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon, Settings2Icon, VolumeXIcon } from "lucide-react";
import type { StageCard } from "@cline/shared";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DriveSubMode, DriveUiState } from "./types";
import { isDriveHumanId } from "./participantIds";

const SUB_MODES: DriveSubMode[] = ["plan", "agent", "ask", "debug"];

export function DriveHeaderControls({
	drive,
	disabled,
	onToggleDrive,
	onToggleStage,
}: {
	drive: DriveUiState;
	disabled?: boolean;
	onToggleDrive: () => void;
	onToggleStage: () => void;
}) {
	return (
		<div className="flex items-center gap-2">
			{drive.active ? (
				<>
					<Badge
						className="gap-1.5 border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
						variant="outline"
					>
						<span
							aria-hidden
							className={cn(
								"inline-block size-2 rounded-full bg-amber-500",
								!drive.muted && "animate-pulse",
							)}
						/>
						Drive · {drive.partnerName}
					</Badge>
					<Button
						disabled={disabled}
						onClick={onToggleStage}
						size="sm"
						type="button"
						variant={drive.stageLayout ? "default" : "outline"}
					>
						{drive.stageLayout ? "Stage on" : "Stage off"}
					</Button>
				</>
			) : null}
			<Button
				disabled={disabled}
				onClick={onToggleDrive}
				size="sm"
				type="button"
				variant={drive.active ? "default" : "outline"}
			>
				{drive.active ? (
					<>
						<PhoneOffIcon className="size-3.5" />
						Leave call
					</>
				) : (
					<>
						<PhoneIcon className="size-3.5" />
						Join call
					</>
				)}
			</Button>
		</div>
	);
}

export function DriveCallStrip({
	drive,
	disabled,
	onMuteToggle,
	onHandToggle,
	onSubModeChange,
	onClearOverride,
	onOpenSettings,
	onToggleSpotlight,
	onTogglePartnerMute,
	onTogglePartnerDeafen,
}: {
	drive: DriveUiState;
	disabled?: boolean;
	onMuteToggle: () => void;
	onHandToggle: () => void;
	onSubModeChange: (mode: DriveSubMode) => void;
	onClearOverride?: () => void;
	onOpenSettings?: () => void;
	onToggleSpotlight?: () => void;
	onTogglePartnerMute?: () => void;
	onTogglePartnerDeafen?: () => void;
}) {
	if (!drive.active) {
		return null;
	}

	const spotlightLabel = isDriveHumanId(drive.spotlightParticipantId)
		? "you"
		: drive.partnerName;

	return (
		<div className="flex flex-wrap items-center gap-2 border-b border-amber-500/30 bg-amber-500/5 px-4 py-2">
			<span
				aria-hidden
				className={cn(
					"inline-block size-2.5 rounded-full bg-amber-500",
					!drive.muted && "animate-pulse",
				)}
			/>
			<span className="text-sm font-medium">{drive.partnerName}</span>
			<span className="text-xs text-muted-foreground">
				{drive.muted ? "you muted" : "listening"} · spotlight {spotlightLabel}
				{drive.partnerMuted ? " · partner muted" : ""}
				{drive.partnerDeafened ? " · partner deafened" : ""}
				{` · ${drive.subMode}`}
				{drive.postureOverride ? ` · override` : " · bank"}
				{drive.handRaised ? " · hand raised" : ""}
			</span>
			<div className="ml-auto flex flex-wrap items-center gap-1">
				{SUB_MODES.map((mode) => (
					<Button
						disabled={disabled}
						key={mode}
						onClick={() => onSubModeChange(mode)}
						size="sm"
						type="button"
						variant={drive.subMode === mode ? "default" : "ghost"}
						className="h-7 px-2 text-xs capitalize"
					>
						{mode}
					</Button>
				))}
				{drive.postureOverride ? (
					<Button
						disabled={disabled}
						onClick={() => onClearOverride?.()}
						size="sm"
						type="button"
						variant="outline"
						className="h-7 px-2 text-xs"
					>
						Clear override
					</Button>
				) : null}
				<Button
					aria-label={`Spotlight ${spotlightLabel}`}
					disabled={disabled}
					onClick={() => onToggleSpotlight?.()}
					size="icon-sm"
					type="button"
					variant="ghost"
					title="Toggle spotlight between you and partner"
				>
					<ApertureIcon className="size-3.5" />
				</Button>
				<Button
					aria-label={
						drive.partnerMuted ? "Unmute partner" : "Mute partner"
					}
					disabled={disabled}
					onClick={() => onTogglePartnerMute?.()}
					size="icon-sm"
					type="button"
					variant={drive.partnerMuted ? "default" : "ghost"}
					title="Partner mute (cannot speak)"
				>
					<VolumeXIcon className="size-3.5" />
				</Button>
				<Button
					aria-label={
						drive.partnerDeafened
							? "Undeafen partner"
							: "Deafen partner"
					}
					disabled={disabled}
					onClick={() => onTogglePartnerDeafen?.()}
					size="icon-sm"
					type="button"
					variant={drive.partnerDeafened ? "default" : "ghost"}
					title="Partner deafen (cannot hear)"
				>
					<HeadphonesIcon className="size-3.5" />
				</Button>
				<Button
					aria-label="Drive settings"
					disabled={disabled}
					onClick={() => onOpenSettings?.()}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<Settings2Icon className="size-3.5" />
				</Button>
				<Button
					aria-label={drive.muted ? "Unmute" : "Mute"}
					disabled={disabled}
					onClick={onMuteToggle}
					size="icon-sm"
					type="button"
					variant={drive.muted ? "default" : "ghost"}
				>
					{drive.muted ? (
						<MicOffIcon className="size-3.5" />
					) : (
						<MicIcon className="size-3.5" />
					)}
				</Button>
				<Button
					aria-label="Raise hand"
					disabled={disabled}
					onClick={onHandToggle}
					size="icon-sm"
					type="button"
					variant={drive.handRaised ? "default" : "ghost"}
				>
					<HandIcon className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}

export function DriveStagePanel({
	sharingLabel,
	nowLabel,
	nextLabel,
	children,
}: {
	sharingLabel: string;
	nowLabel: string;
	nextLabel: string;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col border-l bg-muted/20">
			<div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
				<span className="text-emerald-600 dark:text-emerald-400">● sharing</span>
				<span className="truncate">{sharingLabel}</span>
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
			<div className="grid grid-cols-2 gap-2 border-t p-3">
				<div className="rounded-md border bg-background p-2">
					<div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
						now
					</div>
					<div className="text-xs">{nowLabel}</div>
				</div>
				<div className="rounded-md border bg-background p-2">
					<div className="text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
						next
					</div>
					<div className="text-xs">{nextLabel}</div>
				</div>
			</div>
		</div>
	);
}

export function DriveStageCards({ cards }: { cards: readonly StageCard[] }) {
	return (
		<div className="space-y-2">
			<p className="text-xs text-muted-foreground">
				Last-event-wins stage cards. Prefer <code>Stage.tsx</code> for live
				ai-elements rendering.
			</p>
			{cards.map((card) => (
				<div
					className="rounded-md border bg-background p-2"
					key={card.id}
				>
					<div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
						<span className="rounded border px-1.5 py-0.5">{card.category}</span>
						<span className="truncate font-medium normal-case text-foreground">
							{card.title}
						</span>
					</div>
					{card.summary ? (
						<pre className="mt-1 overflow-auto font-mono text-[11px] text-muted-foreground">
							{card.summary}
						</pre>
					) : null}
				</div>
			))}
		</div>
	);
}


export function DriveNarrationBanner({
	partnerName,
	text,
}: {
	partnerName: string;
	text: string;
}) {
	return (
		<div className="mx-4 mb-2 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm italic text-amber-900 dark:text-amber-100">
			<span
				aria-hidden
				className="mt-0.5 inline-block size-5 shrink-0 rounded-full border-2 border-amber-500 bg-amber-400/40"
			/>
			<span>
				<span className="not-italic font-medium">{partnerName}: </span>
				{text}
			</span>
		</div>
	);
}
