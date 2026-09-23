/** Short-lived browser credentials and the audio contract for a voice session. */
export interface StreamingAudioTranscriptionSession {
	transport: "vercel-ai-gateway" | "elevenlabs";
	token: string;
	url: string;
	sampleRate: number;
	expiresAt?: number;
}
