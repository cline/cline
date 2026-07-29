import type { DriveFacetValues, DeploymentProfile } from "@cline/shared";
import {
	MicSelector,
	MicSelectorContent,
	MicSelectorEmpty,
	MicSelectorInput,
	MicSelectorItem,
	MicSelectorList,
	MicSelectorTrigger,
	MicSelectorValue,
} from "@/components/ai-elements/mic-selector";
import { Button } from "@/components/ui/button";
import { listDriveSettingsProviders } from "./driveSettingsModel";
import type { DriveHardwarePrefs } from "./driveHardwarePrefs";
import { clampOutputVolume } from "./driveHardwarePrefs";
import type { DriveVoiceUi } from "./driveVoiceUi";
import { resolveLlmEgressForUi } from "./driveVoiceUi";
import { SpeakerDeviceSelect } from "./SpeakerDeviceSelect";

const PROFILES: DeploymentProfile[] = ["local", "cloud", "hybrid"];

export function DriveSettingsPanel({
	providerId,
	voice,
	onClose,
	onProfileChange,
	onSttChange,
	onTtsChange,
	onTtsEnabledChange,
	onHardwareChange,
	onPresentSampleDiagram,
	presentSampleDisabled,
}: {
	providerId: string;
	voice: DriveVoiceUi;
	onClose: () => void;
	onProfileChange: (profile: DeploymentProfile) => void;
	onSttChange: (sttId: string) => void;
	onTtsChange: (ttsId: string) => void;
	onTtsEnabledChange: (enabled: boolean) => void;
	onHardwareChange: (patch: Partial<DriveHardwarePrefs>) => void;
	/** Sample / dev — posts drive.show.present (no LLM). */
	onPresentSampleDiagram?: () => void;
	presentSampleDisabled?: boolean;
}) {
	const llm = resolveLlmEgressForUi({
		profile: voice.profile,
		providerId,
	});
	const sttOptions = listDriveSettingsProviders({
		facets: voice.facets,
		llm,
		slot: "stt",
	});
	const ttsOptions = listDriveSettingsProviders({
		facets: voice.facets,
		llm,
		slot: "tts",
	});
	const volumePercent = Math.round(voice.hardware.outputVolume * 100);

	return (
		<div className="space-y-3 border-t bg-muted/20 px-3 py-3 text-sm">
			<div className="flex items-center justify-between gap-2">
				<h3 className="font-medium">Drive Settings</h3>
				<Button onClick={onClose} size="sm" type="button" variant="ghost">
					Close
				</Button>
			</div>

			<label className="block space-y-1">
				<span className="text-xs text-muted-foreground">Runtime profile</span>
				<select
					className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
					onChange={(event) =>
						onProfileChange(event.target.value as DeploymentProfile)
					}
					value={voice.profile}
				>
					{PROFILES.map((profile) => (
						<option key={profile} value={profile}>
							{profile}
						</option>
					))}
				</select>
			</label>

			<label className="block space-y-1">
				<span className="text-xs text-muted-foreground">Speech in (STT)</span>
				<select
					className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
					onChange={(event) => onSttChange(event.target.value)}
					value={voice.facets["providers.sttId"]}
				>
					{sttOptions.map((option) => (
						<option
							disabled={!option.selectable}
							key={option.id}
							title={option.disabledReason}
							value={option.id}
						>
							{option.title}
							{option.selectable ? "" : " (incompatible)"}
						</option>
					))}
				</select>
			</label>

			<label className="block space-y-1">
				<span className="text-xs text-muted-foreground">Speech out (TTS)</span>
				<select
					className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
					onChange={(event) => onTtsChange(event.target.value)}
					value={voice.facets["providers.ttsId"]}
				>
					{ttsOptions.map((option) => (
						<option
							disabled={!option.selectable}
							key={option.id}
							title={option.disabledReason}
							value={option.id}
						>
							{option.title}
							{option.selectable ? "" : " (incompatible)"}
						</option>
					))}
				</select>
			</label>

			<label className="flex items-center gap-2 text-sm">
				<input
					checked={voice.facets["tts.enabled"] === true}
					onChange={(event) => onTtsEnabledChange(event.target.checked)}
					type="checkbox"
				/>
				<span>Speak partner narration (off by default)</span>
			</label>

			<div className="space-y-1">
				<span className="text-xs text-muted-foreground">Microphone</span>
				<MicSelector
					onValueChange={(deviceId) =>
						onHardwareChange({
							micDeviceId:
								!deviceId || deviceId === "__default__"
									? undefined
									: deviceId,
						})
					}
					value={voice.hardware.micDeviceId ?? "__default__"}
				>
					<MicSelectorTrigger className="w-full justify-between">
						<MicSelectorValue />
					</MicSelectorTrigger>
					<MicSelectorContent>
						<MicSelectorInput />
						<MicSelectorList>
							{(devices) => (
								<>
									<MicSelectorEmpty />
									<MicSelectorItem value="__default__">
										System default
									</MicSelectorItem>
									{devices.map((device) => (
										<MicSelectorItem
											key={device.deviceId}
											value={device.deviceId}
										>
											{device.label || `Microphone ${device.deviceId}`}
										</MicSelectorItem>
									))}
								</>
							)}
						</MicSelectorList>
					</MicSelectorContent>
				</MicSelector>
				<p className="text-[11px] text-muted-foreground">
					Applies to MediaRecorder capture (local STT). Web Speech uses the
					browser default mic.
				</p>
			</div>

			<div className="space-y-1">
				<span className="text-xs text-muted-foreground">Speaker</span>
				<SpeakerDeviceSelect
					onChange={(speakerDeviceId) =>
						onHardwareChange({ speakerDeviceId })
					}
					value={voice.hardware.speakerDeviceId}
				/>
				<p className="text-[11px] text-muted-foreground">
					Routes HTML audio / Web Audio playback via setSinkId. Browser
					speechSynthesis still uses the OS default speaker.
				</p>
			</div>

			<label className="block space-y-1">
				<span className="flex items-center justify-between text-xs text-muted-foreground">
					<span>Partner volume</span>
					<span className="font-mono tabular-nums">{volumePercent}%</span>
				</span>
				<input
					aria-label="Partner playback volume"
					className="w-full accent-foreground"
					max={100}
					min={0}
					onChange={(event) =>
						onHardwareChange({
							outputVolume: clampOutputVolume(
								Number(event.target.value) / 100,
							),
						})
					}
					type="range"
					value={volumePercent}
				/>
			</label>

			<p className="text-xs text-muted-foreground">
				LLM providers and API keys stay in Cline Auth / provider settings. Drive
				only stores profile and voice provider ids (no secrets). Mic, speaker,
				and volume stay on this machine.
			</p>
			<p className="font-mono text-[11px] text-muted-foreground">
				{summarizeFacets(voice.facets)} ·{" "}
				{summarizeHardware(voice.hardware)}
			</p>

			{onPresentSampleDiagram ? (
				<div className="space-y-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-3">
					<div className="text-xs font-medium text-amber-800 dark:text-amber-200">
						Sample / dev
					</div>
					<p className="text-[11px] text-muted-foreground">
						Present a fixture architecture diagram onto the sticky stage. No
						LLM credential required. Used to smoke drive.show.present until the
						planner lands.
					</p>
					<Button
						data-testid="drive-present-sample-diagram"
						disabled={presentSampleDisabled}
						onClick={onPresentSampleDiagram}
						size="sm"
						type="button"
						variant="outline"
					>
						Present sample diagram
					</Button>
				</div>
			) : null}
		</div>
	);
}

function summarizeFacets(facets: DriveFacetValues): string {
	return `stt=${facets["providers.sttId"]} tts=${facets["providers.ttsId"]} ceiling=${facets["runtime.egressCeiling"]}`;
}

function summarizeHardware(hardware: DriveHardwarePrefs): string {
	const mic = hardware.micDeviceId ? "custom" : "default";
	const speaker = hardware.speakerDeviceId ? "custom" : "default";
	return `mic=${mic} speaker=${speaker} vol=${Math.round(hardware.outputVolume * 100)}`;
}
