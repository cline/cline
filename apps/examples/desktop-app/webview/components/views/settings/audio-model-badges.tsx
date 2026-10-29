import { AudioWaveform, Mic, WifiOff } from "lucide-react";
import type { ProviderModel } from "@/lib/provider-schema";

/** Operation and execution-mode labels shared by the voice and provider catalogs. */
export function AudioModelBadges({ model }: { model: ProviderModel }) {
	const transcription = model.operation === "transcription";
	const realtime =
		model.operation === "realtime" ||
		(transcription && model.operationModes?.includes("streaming"));
	if (!transcription && !realtime) return null;
	const Icon = realtime ? AudioWaveform : Mic;
	const label = realtime ? "Realtime" : "Transcription";
	return (
		<>
			<span
				title={
					realtime
						? "Live audio with streaming updates"
						: "Audio-to-text transcription"
				}
				className="inline-flex shrink-0 items-center gap-1 rounded bg-surface-hover px-1.5 py-px font-sans text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground"
			>
				<Icon aria-hidden="true" className="size-3" />
				{label}
			</span>
			{model.operationModes?.includes("batch") &&
			!model.operationModes.includes("streaming") ? (
				<span
					role="img"
					aria-label="Streaming not supported"
					title="Streaming not supported"
					className="shrink-0 text-muted-foreground"
				>
					<WifiOff aria-hidden="true" className="size-3.5" />
				</span>
			) : null}
		</>
	);
}
