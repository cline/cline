import { SpeechInput } from "@/components/ai-elements/speech-input";
import type { SttBackend } from "@cline/shared";
import type { SpeechInputMode } from "./speechInputModeForBackend";
import {
	LocalSttError,
	transcribeAudioBlob,
} from "./transcribeAudioBlob";

export function DriveMicBar({
	disabled,
	forceMode,
	caption,
	micDeviceId,
	muted,
	sttBackend,
	sttConfig,
	onCaptionChange,
	onTranscription,
	onSttError,
}: {
	disabled?: boolean;
	forceMode: SpeechInputMode;
	caption: string;
	micDeviceId?: string;
	muted: boolean;
	sttBackend: SttBackend;
	sttConfig?: Record<string, unknown>;
	onCaptionChange: (text: string) => void;
	onTranscription: (text: string) => void;
	onSttError?: (message: string) => void;
}) {
	if (muted) {
		return (
			<div className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
				Mic muted. Unmute on the call strip to speak to the partner.
			</div>
		);
	}

	return (
		<div className="flex items-start gap-3 border-t bg-background px-3 py-2">
			<SpeechInput
				deviceId={micDeviceId}
				disabled={disabled}
				forceMode={forceMode}
				onAudioRecorded={async (blob) => {
					try {
						const text = await transcribeAudioBlob({
							blob,
							backend: sttBackend,
							config: sttConfig,
						});
						if (text) {
							onCaptionChange(text);
							onTranscription(text);
						}
						return text;
					} catch (error) {
						const message =
							error instanceof LocalSttError
								? error.message
								: `STT failed: ${String(error)}`;
						onSttError?.(message);
						return "";
					}
				}}
				onTranscriptionChange={(text) => {
					onCaptionChange(text);
					onTranscription(text);
				}}
			/>
			<div className="min-w-0 flex-1">
				{caption.trim() ? (
					<textarea
						aria-label="Edit spoken caption before send"
						className="min-h-[2.5rem] w-full resize-y rounded-md border bg-background px-2 py-1.5 text-xs text-foreground"
						disabled={disabled}
						onChange={(event) => onCaptionChange(event.target.value)}
						placeholder="Edit what you said before sending…"
						rows={2}
						value={caption}
					/>
				) : (
					<p className="text-xs text-muted-foreground">
						Speak a task. Local STT uses a loopback whisper server when
						MediaRecorder is active.
					</p>
				)}
			</div>
		</div>
	);
}
