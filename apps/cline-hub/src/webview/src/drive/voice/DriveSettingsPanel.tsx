import type { DriveFacetValues, DeploymentProfile } from "@cline/shared";
import { Button } from "@/components/ui/button";
import { listDriveSettingsProviders } from "./driveSettingsModel";
import type { DriveVoiceUi } from "./driveVoiceUi";
import { resolveLlmEgressForUi } from "./driveVoiceUi";

const PROFILES: DeploymentProfile[] = ["local", "cloud", "hybrid"];

export function DriveSettingsPanel({
	providerId,
	voice,
	onClose,
	onProfileChange,
	onSttChange,
	onTtsChange,
}: {
	providerId: string;
	voice: DriveVoiceUi;
	onClose: () => void;
	onProfileChange: (profile: DeploymentProfile) => void;
	onSttChange: (sttId: string) => void;
	onTtsChange: (ttsId: string) => void;
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

			<p className="text-xs text-muted-foreground">
				LLM providers and API keys stay in Cline Auth / provider settings. Drive
				only stores profile and voice provider ids (no secrets).
			</p>
			<p className="font-mono text-[11px] text-muted-foreground">
				{summarizeFacets(voice.facets)}
			</p>
		</div>
	);
}

function summarizeFacets(facets: DriveFacetValues): string {
	return `stt=${facets["providers.sttId"]} tts=${facets["providers.ttsId"]} ceiling=${facets["runtime.egressCeiling"]}`;
}
