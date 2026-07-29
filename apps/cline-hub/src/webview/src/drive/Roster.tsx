/** Nested call roster from hub participants (DRV-ROSTER MVP). */

import type { Participant } from "@cline/shared";
import { HandIcon, MicOffIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
	ParticipantSheet,
	type ParticipantSheetMode,
} from "./ParticipantSheet";
import {
	isRosterParticipantHandRaised,
	isRosterParticipantMuted,
	participantStatusLabel,
	resolveRosterParticipants,
} from "./rosterHelpers";
import type { DriveUiState } from "./types";
import { nameInkPaletteColor } from "./types";

export function Roster({
	drive,
	workspaceRoot,
	onTranscriptFocus,
	onDriveChange,
}: {
	drive: DriveUiState;
	workspaceRoot?: string;
	/** Transcript intent — Profile must not call this. */
	onTranscriptFocus: (participantId: string) => void;
	onDriveChange: (next: DriveUiState) => void;
}) {
	const participants = resolveRosterParticipants(drive);
	const [sheetOpen, setSheetOpen] = useState(false);
	const [sheetMode, setSheetMode] = useState<ParticipantSheetMode>("chooser");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const selected =
		selectedId === null
			? null
			: (participants.find((entry) => entry.id === selectedId) ?? null);

	const openChooser = (participant: Participant) => {
		setSelectedId(participant.id);
		setSheetMode("chooser");
		setSheetOpen(true);
	};

	return (
		<>
			<div
				aria-label="Call roster"
				className="flex flex-wrap items-center gap-1.5 border-b border-amber-500/20 bg-amber-500/5 px-4 py-1.5"
			>
				<span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-amber-800/80 dark:text-amber-200/80">
					On call
				</span>
				{participants.map((participant) => {
					const muted = isRosterParticipantMuted(drive, participant);
					const handRaised = isRosterParticipantHandRaised(
						drive,
						participant,
					);
					const focused = drive.focusedParticipantId === participant.id;
					const speaking = participant.status === "speaking";
					const inkColor =
						participant.kind === "agent" &&
						drive.partnerNameInk !== null
							? nameInkPaletteColor(drive.partnerNameInk)
							: undefined;

					return (
						<button
							aria-label={`${participant.displayName}, ${participant.kind}${muted ? ", muted" : ""}`}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
								"border-amber-500/30 bg-background/80 hover:bg-amber-500/10",
								focused && "ring-1 ring-amber-500/60",
								speaking && "border-amber-500 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]",
							)}
							key={participant.id}
							onClick={() => openChooser(participant)}
							type="button"
						>
							<span
								aria-hidden
								className={cn(
									"inline-block size-2 shrink-0 rounded-full",
									participant.kind === "human"
										? "bg-sky-500"
										: "bg-amber-500",
									speaking && "animate-pulse",
								)}
							/>
							<span
								className="max-w-[8rem] truncate font-medium"
								style={inkColor ? { color: inkColor } : undefined}
							>
								{participant.displayName}
							</span>
							<span className="text-[10px] text-muted-foreground capitalize">
								{participantStatusLabel(participant.status)}
							</span>
							{muted ? (
								<Badge
									aria-label="Muted"
									className="h-4 gap-0.5 px-1 text-[10px]"
									variant="destructive"
								>
									<MicOffIcon className="size-2.5" />
								</Badge>
							) : null}
							{handRaised ? (
								<Badge
									aria-label="Hand raised"
									className="h-4 gap-0.5 px-1 text-[10px]"
									variant="outline"
								>
									<HandIcon className="size-2.5" />
								</Badge>
							) : null}
						</button>
					);
				})}
			</div>

			<ParticipantSheet
				drive={drive}
				mode={sheetMode}
				onChooseProfile={() => setSheetMode("profile")}
				onChooseTranscript={() => {
					if (selected) {
						onTranscriptFocus(selected.id);
					}
					setSheetOpen(false);
				}}
				onDriveChange={onDriveChange}
				onOpenChange={(open) => {
					setSheetOpen(open);
					if (!open) {
						setSheetMode("chooser");
						setSelectedId(null);
					}
				}}
				open={sheetOpen}
				participant={selected}
				workspaceRoot={workspaceRoot}
			/>
		</>
	);
}
