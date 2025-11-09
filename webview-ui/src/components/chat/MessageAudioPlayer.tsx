import { SynthesizeRequest } from "@shared/proto/cline/tts"
import { Play, Volume2, VolumeX } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TtsServiceClient } from "@/services/grpc-client"

interface MessageAudioPlayerProps {
	text: string
	messageTs: number
}

/**
 * Audio player component that appears next to Cline's messages in Discuss Mode
 * Allows manual playback of TTS audio
 */
export function MessageAudioPlayer({ text, messageTs }: MessageAudioPlayerProps) {
	const { discussModeSettings } = useExtensionState()
	const [isPlaying, setIsPlaying] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const audioUrlRef = useRef<string | null>(null)

	const handlePlay = async () => {
		if (!discussModeSettings?.selectedVoice) {
			setError("No voice selected")
			return
		}

		if (isPlaying && audioRef.current) {
			// Pause if already playing
			audioRef.current.pause()
			setIsPlaying(false)
			return
		}

		// If we already have audio, just play it
		if (audioRef.current && audioUrlRef.current) {
			try {
				await audioRef.current.play()
				setIsPlaying(true)
				return
			} catch (err) {
				console.error("[MessageAudioPlayer] Error playing cached audio:", err)
			}
		}

		// Otherwise, synthesize new audio
		try {
			setIsLoading(true)
			setError(null)

			const response = await TtsServiceClient.SynthesizeSpeech(
				SynthesizeRequest.create({
					text,
					voiceId: discussModeSettings.selectedVoice,
					speed: discussModeSettings.speechSpeed || 1.0,
				}),
			)

			if (response.error) {
				setError(response.error)
				setIsLoading(false)
				return
			}

			if (!response.audioData || response.audioData.length === 0) {
				setError("No audio data received")
				setIsLoading(false)
				return
			}

			// Convert Buffer to Blob
			const audioBlob = new Blob([new Uint8Array(response.audioData)], {
				type: response.contentType || "audio/mpeg",
			})
			const audioUrl = URL.createObjectURL(audioBlob)
			audioUrlRef.current = audioUrl

			// Create and play audio
			const audio = new Audio(audioUrl)
			audioRef.current = audio

			audio.onended = () => {
				setIsPlaying(false)
			}

			audio.onerror = () => {
				setError("Audio playback error")
				setIsPlaying(false)
			}

			await audio.play()
			setIsPlaying(true)
			setIsLoading(false)
		} catch (err: any) {
			console.error("[MessageAudioPlayer] Error:", err)
			setError(err.message || "Failed to play audio")
			setIsLoading(false)
		}
	}

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (audioRef.current) {
				audioRef.current.pause()
				audioRef.current = null
			}
			if (audioUrlRef.current) {
				URL.revokeObjectURL(audioUrlRef.current)
				audioUrlRef.current = null
			}
		}
	}, [])

	// Cleanup when message changes
	useEffect(() => {
		if (audioRef.current) {
			audioRef.current.pause()
			setIsPlaying(false)
		}
		if (audioUrlRef.current) {
			URL.revokeObjectURL(audioUrlRef.current)
			audioUrlRef.current = null
		}
	}, [messageTs, text])

	if (!discussModeSettings?.selectedVoice) {
		return null
	}

	return (
		<div className="inline-flex items-center gap-1">
			<button
				className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
				disabled={isLoading}
				onClick={handlePlay}
				title={isPlaying ? "Pause" : isLoading ? "Loading..." : "Play audio"}
				type="button">
				{isLoading ? (
					<div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
				) : isPlaying ? (
					<Volume2 className="w-4 h-4 text-blue-500" />
				) : (
					<Play className="w-4 h-4 text-gray-600 dark:text-gray-400" />
				)}
			</button>
			{error && (
				<span className="text-xs text-red-500" title={error}>
					<VolumeX className="w-3 h-3" />
				</span>
			)}
		</div>
	)
}
