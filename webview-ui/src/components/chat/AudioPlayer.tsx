import { SynthesizeRequest } from "@shared/proto/cline/tts"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { TtsServiceClient } from "@/services/grpc-client"

export interface AudioQueueItem {
	id: string
	text: string
	voiceId: string
	speed?: number
}

export interface AudioPlayerProps {
	/** Called when playback of an item completes */
	onPlaybackComplete?: (itemId: string) => void
	/** Called when an error occurs */
	onError?: (error: string, itemId?: string) => void
	/** Called when playback state changes */
	onPlaybackStateChange?: (isPlaying: boolean, itemId?: string) => void
	/** Default voice ID to use */
	defaultVoiceId?: string
	/** Default playback speed */
	defaultSpeed?: number
}

export interface AudioPlayerHandle {
	/** Add audio to the queue */
	enqueue: (item: AudioQueueItem) => void
	/** Clear the entire queue */
	clearQueue: () => void
	/** Pause current playback */
	pause: () => void
	/** Resume current playback */
	resume: () => void
	/** Stop current playback and clear queue */
	stop: () => void
	/** Get current queue */
	getQueue: () => AudioQueueItem[]
	/** Check if currently playing */
	isPlaying: () => boolean
}

/**
 * AudioPlayer component that handles TTS audio playback with queue management.
 * Uses the TTS service to synthesize speech and plays it back.
 */
const AudioPlayer = React.forwardRef<AudioPlayerHandle, AudioPlayerProps>(
	(
		{
			onPlaybackComplete,
			onError,
			onPlaybackStateChange,
			defaultVoiceId = "EXAVITQu4vr4xnSDxMaL", // Default ElevenLabs voice
			defaultSpeed = 1.0,
		},
		ref,
	) => {
		const [queue, setQueue] = useState<AudioQueueItem[]>([])
		const [currentItem, setCurrentItem] = useState<AudioQueueItem | null>(null)
		const [isPlaying, setIsPlaying] = useState(false)
		const [isPaused, setIsPaused] = useState(false)

		const audioRef = useRef<HTMLAudioElement | null>(null)
		const currentBlobUrlRef = useRef<string | null>(null)
		const isProcessingRef = useRef(false)

		// Cleanup blob URL when component unmounts or audio changes
		const cleanupBlobUrl = useCallback(() => {
			if (currentBlobUrlRef.current) {
				URL.revokeObjectURL(currentBlobUrlRef.current)
				currentBlobUrlRef.current = null
			}
		}, [])

		// Process the next item in the queue
		const processNextItem = useCallback(async () => {
			if (isProcessingRef.current || queue.length === 0) {
				return
			}

			isProcessingRef.current = true
			const nextItem = queue[0]
			setCurrentItem(nextItem)

			try {
				// Synthesize speech via TTS service
				const response = await TtsServiceClient.SynthesizeSpeech(
					SynthesizeRequest.create({
						text: nextItem.text,
						voiceId: nextItem.voiceId || defaultVoiceId,
						speed: nextItem.speed || defaultSpeed,
					}),
				)

				if (response.error) {
					throw new Error(response.error)
				}

				// Convert Buffer to Uint8Array then to Blob
				const audioArray = new Uint8Array(response.audioData)
				const audioBlob = new Blob([audioArray], { type: response.contentType || "audio/mpeg" })
				const audioUrl = URL.createObjectURL(audioBlob)

				// Cleanup previous blob URL
				cleanupBlobUrl()
				currentBlobUrlRef.current = audioUrl

				// Create and play audio element
				if (audioRef.current) {
					audioRef.current.pause()
					audioRef.current = null
				}

				const audio = new Audio(audioUrl)
				audioRef.current = audio

				// Set up event handlers
				audio.onplay = () => {
					setIsPlaying(true)
					setIsPaused(false)
					onPlaybackStateChange?.(true, nextItem.id)
				}

				audio.onpause = () => {
					if (!audio.ended) {
						setIsPaused(true)
						onPlaybackStateChange?.(false, nextItem.id)
					}
				}

				audio.onended = () => {
					setIsPlaying(false)
					setIsPaused(false)
					setCurrentItem(null)
					cleanupBlobUrl()

					// Remove completed item from queue
					setQueue((prev) => prev.slice(1))
					onPlaybackComplete?.(nextItem.id)
					onPlaybackStateChange?.(false, nextItem.id)

					isProcessingRef.current = false

					// Process next item if available
					setTimeout(() => {
						if (queue.length > 1) {
							processNextItem()
						}
					}, 0)
				}

				audio.onerror = (e) => {
					const errorMessage = `Audio playback error: ${audio.error?.message || "Unknown error"}`
					console.error(errorMessage, e)
					setIsPlaying(false)
					setCurrentItem(null)
					cleanupBlobUrl()

					// Remove failed item from queue
					setQueue((prev) => prev.slice(1))
					onError?.(errorMessage, nextItem.id)

					isProcessingRef.current = false

					// Try next item
					setTimeout(() => {
						if (queue.length > 1) {
							processNextItem()
						}
					}, 0)
				}

				// Start playback
				await audio.play()
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : "Failed to synthesize speech"
				console.error("TTS synthesis error:", error)

				setIsPlaying(false)
				setCurrentItem(null)
				cleanupBlobUrl()

				// Remove failed item from queue
				setQueue((prev) => prev.slice(1))
				onError?.(errorMessage, nextItem.id)

				isProcessingRef.current = false

				// Try next item
				setTimeout(() => {
					if (queue.length > 1) {
						processNextItem()
					}
				}, 0)
			}
		}, [queue, defaultVoiceId, defaultSpeed, onPlaybackComplete, onError, onPlaybackStateChange, cleanupBlobUrl])

		// Auto-process queue when items are added
		useEffect(() => {
			if (queue.length > 0 && !currentItem && !isProcessingRef.current) {
				processNextItem()
			}
		}, [queue, currentItem, processNextItem])

		// Expose imperative handle
		React.useImperativeHandle(ref, () => ({
			enqueue: (item: AudioQueueItem) => {
				setQueue((prev) => [...prev, item])
			},
			clearQueue: () => {
				if (audioRef.current) {
					audioRef.current.pause()
					audioRef.current = null
				}
				setQueue([])
				setCurrentItem(null)
				setIsPlaying(false)
				setIsPaused(false)
				cleanupBlobUrl()
				isProcessingRef.current = false
			},
			pause: () => {
				if (audioRef.current && !audioRef.current.paused) {
					audioRef.current.pause()
				}
			},
			resume: () => {
				if (audioRef.current && audioRef.current.paused) {
					audioRef.current.play()
				}
			},
			stop: () => {
				if (audioRef.current) {
					audioRef.current.pause()
					audioRef.current = null
				}
				setQueue([])
				setCurrentItem(null)
				setIsPlaying(false)
				setIsPaused(false)
				cleanupBlobUrl()
				isProcessingRef.current = false
			},
			getQueue: () => queue,
			isPlaying: () => isPlaying,
		}))

		// Cleanup on unmount
		useEffect(() => {
			return () => {
				if (audioRef.current) {
					audioRef.current.pause()
					audioRef.current = null
				}
				cleanupBlobUrl()
			}
		}, [cleanupBlobUrl])

		// This component doesn't render anything visible - it's purely functional
		return null
	},
)

AudioPlayer.displayName = "AudioPlayer"

export default AudioPlayer
