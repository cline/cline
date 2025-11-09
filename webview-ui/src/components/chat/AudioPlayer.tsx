import { SynthesizeRequest } from "@shared/proto/tts"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { TtsServiceClient } from "@/services/grpc-client"

interface AudioPlayerProps {
	text: string
	voiceId?: string
	speed?: number
	autoPlay?: boolean
	onPlaybackStart?: () => void
	onPlaybackComplete?: () => void
	onError?: (error: string) => void
	className?: string
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
	text,
	voiceId = "21m00Tcm4TlvDq8ikWAM", // Default ElevenLabs voice (Rachel)
	speed = 1.0,
	autoPlay = false,
	onPlaybackStart,
	onPlaybackComplete,
	onError,
	className,
}) => {
	const [isPlaying, setIsPlaying] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [audioUrl, setAudioUrl] = useState<string | null>(null)

	const audioRef = useRef<HTMLAudioElement | null>(null)
	const audioContextRef = useRef<AudioContext | null>(null)

	// Initialize audio element
	useEffect(() => {
		audioRef.current = new Audio()

		// Event listeners for audio element
		const handleEnded = () => {
			setIsPlaying(false)
			onPlaybackComplete?.()
		}

		const handleError = (e: ErrorEvent) => {
			console.error("Audio playback error:", e)
			const errorMessage = "Failed to play audio"
			setError(errorMessage)
			setIsPlaying(false)
			onError?.(errorMessage)
		}

		const handlePlay = () => {
			setIsPlaying(true)
			onPlaybackStart?.()
		}

		const handlePause = () => {
			setIsPlaying(false)
		}

		audioRef.current.addEventListener("ended", handleEnded)
		audioRef.current.addEventListener("error", handleError as EventListener)
		audioRef.current.addEventListener("play", handlePlay)
		audioRef.current.addEventListener("pause", handlePause)

		return () => {
			if (audioRef.current) {
				audioRef.current.removeEventListener("ended", handleEnded)
				audioRef.current.removeEventListener("error", handleError as EventListener)
				audioRef.current.removeEventListener("play", handlePlay)
				audioRef.current.removeEventListener("pause", handlePause)
				audioRef.current.pause()
				audioRef.current.src = ""
			}
			// Clean up audio URL
			if (audioUrl) {
				URL.revokeObjectURL(audioUrl)
			}
			// Close audio context
			if (audioContextRef.current) {
				audioContextRef.current.close()
			}
		}
	}, []) // Only run once on mount

	// Load audio when text changes
	useEffect(() => {
		if (text && text.trim().length > 0) {
			loadAudio()
		}
	}, [text, voiceId, speed])

	// Auto-play when audio is loaded
	useEffect(() => {
		if (autoPlay && audioUrl && !isPlaying && !error) {
			playAudio()
		}
	}, [autoPlay, audioUrl, isPlaying, error])

	const loadAudio = useCallback(async () => {
		try {
			setIsLoading(true)
			setError(null)

			// Clean up previous audio URL
			if (audioUrl) {
				URL.revokeObjectURL(audioUrl)
				setAudioUrl(null)
			}

			// Call TTS service to synthesize speech
			const response = await TtsServiceClient.synthesizeSpeech(
				SynthesizeRequest.create({
					text: text,
					voiceId: voiceId,
					speed: speed,
				}),
			)

			if (response.error) {
				const errorMessage = response.error
				setError(errorMessage)
				onError?.(errorMessage)
				return
			}

			if (!response.audioData || response.audioData.length === 0) {
				const errorMessage = "No audio data received from TTS service"
				setError(errorMessage)
				onError?.(errorMessage)
				return
			}

			// Create blob from audio data
			const audioBlob = new Blob([response.audioData], { type: response.contentType || "audio/mpeg" })
			const url = URL.createObjectURL(audioBlob)
			setAudioUrl(url)

			// Set audio source
			if (audioRef.current) {
				audioRef.current.src = url
			}
		} catch (err) {
			console.error("Error loading audio:", err)
			const errorMessage = err instanceof Error ? err.message : "Failed to load audio"
			setError(errorMessage)
			onError?.(errorMessage)
		} finally {
			setIsLoading(false)
		}
	}, [text, voiceId, speed, audioUrl, onError])

	const playAudio = useCallback(async () => {
		try {
			if (!audioRef.current || !audioUrl) {
				return
			}

			// Initialize AudioContext on first user interaction (required by browsers)
			if (!audioContextRef.current) {
				audioContextRef.current = new AudioContext()
			}

			// Resume AudioContext if suspended
			if (audioContextRef.current.state === "suspended") {
				await audioContextRef.current.resume()
			}

			await audioRef.current.play()
		} catch (err) {
			console.error("Error playing audio:", err)
			const errorMessage = err instanceof Error ? err.message : "Failed to play audio"
			setError(errorMessage)
			setIsPlaying(false)
			onError?.(errorMessage)
		}
	}, [audioUrl, onError])

	const pauseAudio = useCallback(() => {
		if (audioRef.current) {
			audioRef.current.pause()
		}
	}, [])

	const stopAudio = useCallback(() => {
		if (audioRef.current) {
			audioRef.current.pause()
			audioRef.current.currentTime = 0
			setIsPlaying(false)
		}
	}, [])

	const handlePlayPauseClick = useCallback(() => {
		if (error) {
			// Retry loading audio on click if there was an error
			setError(null)
			loadAudio()
			return
		}

		if (isLoading) {
			return
		}

		if (isPlaying) {
			pauseAudio()
		} else {
			playAudio()
		}
	}, [isPlaying, isLoading, error, playAudio, pauseAudio, loadAudio])

	// Don't render if no text
	if (!text || text.trim().length === 0) {
		return null
	}

	const iconAdjustment = "mt-0.5"
	const iconClass = isLoading ? "codicon-loading" : error ? "codicon-error" : isPlaying ? "codicon-pulse" : "codicon-unmute"
	const iconColor = error ? "text-error" : isPlaying ? "text-accent" : ""
	const tooltipContent = isLoading ? "Loading audio..." : error ? `Error: ${error}` : isPlaying ? "Pause" : "Play Audio"

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					className={cn("input-icon-button text-base", iconAdjustment, className, {
						disabled: isLoading,
						"animate-spin": isLoading,
						"cursor-pointer": !isLoading,
					})}
					data-testid="audio-player-button"
					onClick={handlePlayPauseClick}
					style={{ color: iconColor }}>
					<span className={`codicon ${iconClass}`} />
				</div>
			</TooltipTrigger>
			<TooltipContent side="top">{tooltipContent}</TooltipContent>
		</Tooltip>
	)
}

export default AudioPlayer
