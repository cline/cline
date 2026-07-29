/** Participant sheet chooser + profile sections (DRV-PARTICIPANT-SHEET). */

import type { Participant } from "@cline/shared";
import { HandIcon, MicOffIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postToHost } from "../vscode";
import {
	type DriveagentHomeProjection,
	requestDriveagentHome,
} from "./requestDriveagentHome";
import {
	isRosterParticipantHandRaised,
	isRosterParticipantMuted,
	participantStatusLabel,
	resolveAgentHomeSlug,
} from "./rosterHelpers";
import {
	applyPartnerDisplayName,
	applyPartnerNameInk,
	type DriveUiState,
	nameInkPaletteColor,
} from "./types";

export type ParticipantSheetMode = "chooser" | "profile";

export function ParticipantSheet({
	open,
	mode,
	participant,
	drive,
	workspaceRoot,
	onOpenChange,
	onChooseTranscript,
	onChooseProfile,
	onDriveChange,
}: {
	open: boolean;
	mode: ParticipantSheetMode;
	participant: Participant | null;
	drive: DriveUiState;
	workspaceRoot?: string;
	onOpenChange: (open: boolean) => void;
	onChooseTranscript: () => void;
	onChooseProfile: () => void;
	onDriveChange: (next: DriveUiState) => void;
}) {
	if (!participant) {
		return null;
	}

	const muted = isRosterParticipantMuted(drive, participant);
	const handRaised = isRosterParticipantHandRaised(drive, participant);
	const title =
		mode === "chooser"
			? participant.displayName
			: `${participant.displayName} · Profile`;

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					{mode === "chooser" ? (
						<DialogDescription>
							Choose Transcript to focus this stream, or Profile to inspect
							without changing address.
						</DialogDescription>
					) : (
						<DialogDescription>
							Appearance and home projection — prompts stay in `.driveagent/`.
						</DialogDescription>
					)}
				</DialogHeader>

				{mode === "chooser" ? (
					<div className="flex flex-col gap-2">
						<Button
							className="justify-start"
							onClick={onChooseTranscript}
							type="button"
							variant="outline"
						>
							Transcript
						</Button>
						<Button
							className="justify-start"
							onClick={onChooseProfile}
							type="button"
							variant="outline"
						>
							Profile
						</Button>
					</div>
				) : (
					<ParticipantProfileBody
						drive={drive}
						handRaised={handRaised}
						muted={muted}
						onDriveChange={onDriveChange}
						participant={participant}
						workspaceRoot={workspaceRoot}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ParticipantProfileBody({
	participant,
	drive,
	muted,
	handRaised,
	workspaceRoot,
	onDriveChange,
}: {
	participant: Participant;
	drive: DriveUiState;
	muted: boolean;
	handRaised: boolean;
	workspaceRoot?: string;
	onDriveChange: (next: DriveUiState) => void;
}) {
	const liveBits: string[] = [participantStatusLabel(participant.status)];
	if (muted) {
		liveBits.push("muted");
	}
	if (handRaised) {
		liveBits.push("hand raised");
	}
	if (
		participant.kind === "agent" &&
		drive.focusedParticipantId === participant.id
	) {
		liveBits.push("transcript focused");
	}

	return (
		<div className="space-y-4">
			{/* Classifier strip */}
			<div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-2.5 py-2">
				<Badge className="capitalize" variant="outline">
					{participant.kind}
				</Badge>
				<Badge className="capitalize" variant="secondary">
					{participant.role}
				</Badge>
				{muted ? (
					<Badge className="gap-1" variant="destructive">
						<MicOffIcon className="size-3" />
						muted
					</Badge>
				) : null}
				{handRaised ? (
					<Badge className="gap-1" variant="outline">
						<HandIcon className="size-3" />
						hand
					</Badge>
				) : null}
				<span className="text-xs text-muted-foreground">
					{liveBits.join(" · ")}
				</span>
			</div>

			{participant.kind === "human" ? (
				<HumanProfileSections participant={participant} />
			) : (
				<AgentProfileSections
					drive={drive}
					onDriveChange={onDriveChange}
					participant={participant}
					workspaceRoot={workspaceRoot}
				/>
			)}
		</div>
	);
}

function HumanProfileSections({
	participant,
}: {
	participant: Extract<Participant, { kind: "human" }>;
}) {
	return (
		<section className="space-y-1.5">
			<h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
				Overview
			</h3>
			<div>
				<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
					Display name
				</div>
				<div className="text-sm font-medium">{participant.displayName}</div>
			</div>
			<div>
				<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
					Presence
				</div>
				<div className="text-sm capitalize">
					{participantStatusLabel(participant.status)}
				</div>
			</div>
		</section>
	);
}

function AgentProfileSections({
	participant,
	drive,
	workspaceRoot,
	onDriveChange,
}: {
	participant: Extract<Participant, { kind: "agent" }>;
	drive: DriveUiState;
	workspaceRoot?: string;
	onDriveChange: (next: DriveUiState) => void;
}) {
	const [displayNameDraft, setDisplayNameDraft] = useState(
		participant.displayName,
	);
	const [saveNote, setSaveNote] = useState<string | null>(null);
	const [homeState, setHomeState] = useState<
		| { status: "idle" }
		| { status: "loading" }
		| { status: "ready"; home: DriveagentHomeProjection }
		| { status: "error"; message: string }
		| { status: "empty" }
	>({ status: "idle" });

	useEffect(() => {
		setDisplayNameDraft(participant.displayName);
		setSaveNote(null);
	}, [participant.displayName]);

	const homeSlug = resolveAgentHomeSlug(participant);
	const root = workspaceRoot?.trim() ?? "";

	useEffect(() => {
		if (!homeSlug) {
			setHomeState({ status: "empty" });
			return;
		}
		if (!root) {
			setHomeState({
				status: "error",
				message: "Set a workspace root to load this agent home.",
			});
			return;
		}
		let cancelled = false;
		setHomeState({ status: "loading" });
		void requestDriveagentHome(root, homeSlug)
			.then((home) => {
				if (!cancelled) {
					setHomeState({ status: "ready", home });
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setHomeState({
						status: "error",
						message: error instanceof Error ? error.message : String(error),
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, [homeSlug, root]);

	const saveDisplayName = () => {
		const nextName = displayNameDraft.trim();
		if (!nextName) {
			setSaveNote("Name cannot be empty.");
			return;
		}
		onDriveChange(applyPartnerDisplayName(drive, nextName, participant.id));
		if (drive.roomId) {
			postToHost({
				type: "call_rename_participant",
				roomId: drive.roomId,
				participantId: participant.id,
				displayName: nextName,
			});
			setSaveNote("Saved locally · renaming in room…");
		} else {
			setSaveNote("Saved locally (not in a hub room yet).");
		}
	};

	const inkIndex = drive.partnerNameInk;
	const inkColor =
		inkIndex !== null ? nameInkPaletteColor(inkIndex) : undefined;

	return (
		<>
			<section className="space-y-2">
				<h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
					Overview
				</h3>
				<div className="space-y-1.5">
					<Label
						className="text-[10px] uppercase tracking-wide text-muted-foreground"
						htmlFor="partner-display-name"
					>
						Display name
					</Label>
					<div className="flex gap-2">
						<Input
							id="partner-display-name"
							onChange={(event) => setDisplayNameDraft(event.target.value)}
							style={inkColor ? { color: inkColor } : undefined}
							value={displayNameDraft}
						/>
						<Button onClick={saveDisplayName} size="sm" type="button">
							Save
						</Button>
					</div>
					{saveNote ? (
						<p className="text-[11px] text-muted-foreground">{saveNote}</p>
					) : null}
				</div>
				<div className="space-y-1.5">
					<Label
						className="text-[10px] uppercase tracking-wide text-muted-foreground"
						htmlFor="partner-name-ink"
					>
						Name ink (palette)
					</Label>
					<select
						className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
						id="partner-name-ink"
						onChange={(event) => {
							const raw = event.target.value;
							const next = raw === "" ? null : Number.parseInt(raw, 10);
							onDriveChange(applyPartnerNameInk(drive, next));
						}}
						value={inkIndex === null ? "" : String(inkIndex)}
					>
						<option value="">Default</option>
						{[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
							<option key={index} value={String(index)}>
								Palette {index}
							</option>
						))}
					</select>
					<p className="text-[11px] text-muted-foreground">
						Local only — durable facet upsert TBD.
					</p>
				</div>
			</section>

			<section className="space-y-2">
				<h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
					Capabilities
				</h3>
				<CapabilitiesSection homeState={homeState} />
			</section>

			<section className="space-y-2">
				<h3 className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
					Access
				</h3>
				<div className="space-y-1 text-sm">
					<div>
						<span className="text-muted-foreground">Role · </span>
						<span className="capitalize">{participant.role}</span>
					</div>
					<div>
						<span className="text-muted-foreground">Seat sources · </span>
						{participant.seatSources.length > 0
							? participant.seatSources.join(", ")
							: "none"}
					</div>
					{homeState.status === "ready" ? (
						<>
							<div>
								<span className="text-muted-foreground">
									Permission intent ·{" "}
								</span>
								<span className="capitalize">
									{homeState.home.permissions.presetIntent}
								</span>
							</div>
							{homeState.home.permissions.approvalHooks.length > 0 ? (
								<div>
									<span className="text-muted-foreground">
										Approval hooks ·{" "}
									</span>
									{homeState.home.permissions.approvalHooks.join(", ")}
								</div>
							) : null}
							{homeState.home.permissions.notes ? (
								<p className="text-xs text-muted-foreground">
									{homeState.home.permissions.notes}
								</p>
							) : null}
						</>
					) : null}
				</div>
			</section>
		</>
	);
}

function CapabilitiesSection({
	homeState,
}: {
	homeState:
		| { status: "idle" }
		| { status: "loading" }
		| { status: "ready"; home: DriveagentHomeProjection }
		| { status: "error"; message: string }
		| { status: "empty" };
}) {
	switch (homeState.status) {
		case "idle":
		case "loading":
			return <p className="text-xs text-muted-foreground">Loading home…</p>;
		case "empty":
			return (
				<p className="text-xs text-muted-foreground">
					No Driveagent home mapped for this participant.
				</p>
			);
		case "error":
			return <p className="text-xs text-destructive">{homeState.message}</p>;
		case "ready": {
			const { compiled } = homeState.home;
			const tools = compiled.tools ?? [];
			const skills = compiled.skills ?? [];
			return (
				<div className="space-y-2 text-sm">
					<p className="text-muted-foreground">{compiled.description}</p>
					<div>
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Tools
						</div>
						{tools.length > 0 ? (
							<ul className="mt-0.5 list-inside list-disc text-xs">
								{tools.map((tool) => (
									<li key={tool}>{tool}</li>
								))}
							</ul>
						) : (
							<p className="text-xs text-muted-foreground">None listed</p>
						)}
					</div>
					<div>
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
							Skills
						</div>
						{skills.length > 0 ? (
							<ul className="mt-0.5 list-inside list-disc text-xs">
								{skills.map((skill) => (
									<li key={skill}>{skill}</li>
								))}
							</ul>
						) : (
							<p className="text-xs text-muted-foreground">None listed</p>
						)}
					</div>
				</div>
			);
		}
		default: {
			const _exhaustive: never = homeState;
			return _exhaustive;
		}
	}
}
