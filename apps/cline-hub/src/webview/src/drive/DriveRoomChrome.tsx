import { NowNext } from "../components/NowNext";
import {
	DriveCallStrip,
	DriveNarrationBanner,
} from "./DriveCallChrome";
import { DriveMicBar } from "./voice/DriveMicBar";
import { DriveSettingsPanel } from "./voice/DriveSettingsPanel";
import { clearVoiceCaptionDraft } from "./voice/voiceCaptionState";
import { Roster } from "./Roster";
import { applyTranscriptFocus } from "./rosterHelpers";
import {
	applyHardwarePrefsPatch,
	applyVoiceFacetPatch,
	applyVoiceProfile,
	type UseDriveSessionResult,
} from "./useDriveSession";
import { Button } from "@/components/ui/button";

/** Call strip, settings, now/next, join note — mounts above the conversation. */
export function DriveRoomChrome({
	session,
	disabled,
	providerId,
}: {
	session: UseDriveSessionResult;
	disabled: boolean;
	providerId: string;
}) {
	const {
		drive,
		setDrive,
		driveVoice,
		setDriveVoice,
		driveJoinNote,
		stripHandlers,
		chatForks,
		workersPanelOpen,
	} = session;

	return (
		<>
			<DriveCallStrip
				disabled={disabled}
				drive={drive}
				workerCount={chatForks.length}
				workersOpen={workersPanelOpen}
				{...stripHandlers}
			/>
			{drive.active ? (
				<Roster
					drive={drive}
					onDriveChange={setDrive}
					onTranscriptFocus={(participantId) => {
						setDrive((current) =>
							applyTranscriptFocus(current, participantId),
						);
					}}
					workspaceRoot={session.workspaceRoot}
				/>
			) : null}
			{drive.active && driveVoice.settingsOpen ? (
				<DriveSettingsPanel
					onClose={() =>
						setDriveVoice((current) => ({
							...current,
							settingsOpen: false,
						}))
					}
					onHardwareChange={(patch) => {
						setDriveVoice((current) =>
							applyHardwarePrefsPatch(current, patch),
						);
					}}
					onProfileChange={(profile) => {
						setDriveVoice((current) =>
							applyVoiceProfile(current, profile),
						);
					}}
					onSttChange={(sttId) => {
						setDriveVoice((current) =>
							applyVoiceFacetPatch(current, {
								"providers.sttId": sttId,
							}),
						);
					}}
					onTtsChange={(ttsId) => {
						setDriveVoice((current) =>
							applyVoiceFacetPatch(current, {
								"providers.ttsId": ttsId,
							}),
						);
					}}
					onTtsEnabledChange={(enabled) => {
						setDriveVoice((current) =>
							applyVoiceFacetPatch(current, {
								"tts.enabled": enabled,
							}),
						);
					}}
					providerId={providerId}
					voice={driveVoice}
				/>
			) : null}
			{drive.active ? (
				<NowNext
					onSelectNext={() => {}}
					onSelectNow={() => {}}
					snapshot={drive.bankSnapshot}
				/>
			) : null}
			{driveJoinNote ? (
				<DriveNarrationBanner
					partnerName={drive.partnerName}
					text={driveJoinNote}
				/>
			) : null}
		</>
	);
}

/** Mic + confirm-send — mounts above the composer. */
export function DriveVoiceBar({
	session,
	disabled,
	sending,
	onSendSpoken,
	onSttError,
}: {
	session: UseDriveSessionResult;
	disabled: boolean;
	sending: boolean;
	onSendSpoken: (text: string) => void;
	onSttError: (message: string) => void;
}) {
	const {
		drive,
		driveVoice,
		voiceCaption,
		setVoiceCaption,
		driveVoiceResolved,
	} = session;

	if (!drive.active) {
		return null;
	}

	if (!driveVoiceResolved.ok) {
		return (
			<div className="border-t bg-destructive/10 px-3 py-2 text-xs text-destructive">
				Voice topology invalid: {driveVoiceResolved.message}
			</div>
		);
	}

	return (
		<div className="space-y-0">
			<DriveMicBar
				caption={voiceCaption}
				disabled={disabled || sending}
				forceMode={driveVoiceResolved.forceMode}
				micDeviceId={driveVoice.hardware.micDeviceId}
				muted={drive.muted}
				onCaptionChange={setVoiceCaption}
				onSttError={onSttError}
				onTranscription={(text) => {
					setVoiceCaption(text.trim());
				}}
				sttBackend={driveVoiceResolved.topology.stt}
				sttConfig={driveVoice.facets["providers.sttConfig"]}
			/>
			{voiceCaption.trim() && !drive.muted ? (
				<div className="flex items-center justify-end gap-2 border-t bg-background px-3 py-2">
					<Button
						disabled={disabled || sending}
						onClick={() => setVoiceCaption(clearVoiceCaptionDraft())}
						size="sm"
						type="button"
						variant="ghost"
					>
						Discard
					</Button>
					<Button
						disabled={disabled || sending}
						onClick={() => onSendSpoken(voiceCaption)}
						size="sm"
						type="button"
					>
						Send spoken
					</Button>
				</div>
			) : null}
		</div>
	);
}
