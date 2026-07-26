import type { StageCard } from "@cline/shared";
import { HandIcon, MicIcon, MicOffIcon, PhoneIcon, PhoneOffIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DriveSubMode, DriveUiState } from "./types";

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
	onTakeStage,
	pinDefaults,
}: {
	drive: DriveUiState;
	disabled?: boolean;
	onMuteToggle: () => void;
	onHandToggle: () => void;
	onSubModeChange: (mode: DriveSubMode) => void;
	/** Hub call_set_stage: agent clears pin; you pins with kind defaults. */
	onTakeStage?: (
		who: "agent" | "you",
		pin?: {
			kind: "selection" | "file" | "terminal";
			label: string;
			ref?: string;
		},
	) => void;
	pinDefaults?: Record<
		"selection" | "file" | "terminal",
		{ kind: "selection" | "file" | "terminal"; label: string; ref?: string }
	>;
}) {
	const [pinPickerOpen, setPinPickerOpen] = useState(false);

	if (!drive.active) {
		return null;
	}

	const kinds = (
		["selection", "file", "terminal"] as const
	).map((kind) => {
		const pin = pinDefaults?.[kind] ?? {
			kind,
			label:
				kind === "selection"
					? "Current selection"
					: kind === "file"
						? "Shared file"
						: "Terminal",
		};
		return { kind, pin };
	});

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
				{drive.muted ? "muted" : "listening"} · {drive.subMode}
				{drive.handRaised ? " · hand raised" : ""}
				{drive.stageSharer === "you" ? " · you sharing" : " · agent sharing"}
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
				{onTakeStage ? (
					<>
						<Button
							disabled={disabled}
							onClick={() => {
								setPinPickerOpen(false);
								onTakeStage("agent");
							}}
							size="sm"
							type="button"
							variant={drive.stageSharer === "agent" ? "default" : "ghost"}
							className="h-7 px-2 text-xs"
						>
							Agent takes stage
						</Button>
						<Button
							disabled={disabled}
							onClick={() => setPinPickerOpen((open) => !open)}
							size="sm"
							type="button"
							variant={drive.stageSharer === "you" ? "default" : "ghost"}
							className="h-7 px-2 text-xs"
						>
							You take stage
						</Button>
						{pinPickerOpen ? (
							<div className="flex w-full flex-wrap items-center gap-1 border-t border-amber-500/20 pt-2">
								<span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">
									Share
								</span>
								{kinds.map(({ kind, pin }) => (
									<Button
										disabled={disabled}
										key={kind}
										onClick={() => {
											setPinPickerOpen(false);
											onTakeStage("you", pin);
										}}
										size="sm"
										type="button"
										variant="outline"
										className="h-7 px-2 text-xs capitalize"
										title={pin.ref ?? pin.label}
									>
										{kind}
									</Button>
								))}
							</div>
						) : null}
					</>
				) : null}
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
	demo,
	children,
}: {
	sharingLabel: string;
	nowLabel: string;
	nextLabel: string;
	demo?: boolean;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col border-l bg-muted/20">
			<div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
				<span className="text-emerald-600 dark:text-emerald-400">● sharing</span>
				<span className="truncate">{sharingLabel}</span>
				{demo ? (
					<Badge className="ml-auto shrink-0 text-[10px]" variant="outline">
						Demo fixture
					</Badge>
				) : null}
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
