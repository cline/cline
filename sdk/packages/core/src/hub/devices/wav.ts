import { AUDIO_BITS, AUDIO_CHANNELS, AUDIO_SAMPLE_RATE } from "@cline/device";

/** Wraps raw PCM in a 44-byte RIFF/WAVE header so STT providers accept it. */
export function pcmToWav(
	pcm: Uint8Array,
	sampleRate = AUDIO_SAMPLE_RATE,
	bits = AUDIO_BITS,
	channels = AUDIO_CHANNELS,
): Uint8Array {
	const out = new Uint8Array(44 + pcm.byteLength);
	const view = new DataView(out.buffer);
	const ascii = (offset: number, s: string) => {
		for (let i = 0; i < s.length; i++) out[offset + i] = s.charCodeAt(i);
	};
	const blockAlign = (channels * bits) / 8;
	ascii(0, "RIFF");
	view.setUint32(4, 36 + pcm.byteLength, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true); // PCM
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bits, true);
	ascii(36, "data");
	view.setUint32(40, pcm.byteLength, true);
	out.set(pcm, 44);
	return out;
}
