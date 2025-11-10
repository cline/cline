import { ClineMessage } from "@shared/ExtensionMessage"
import { SynthesizeRequest } from "@shared/proto/cline/tts"
import { useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TtsServiceClient } from "@/services/grpc-client"

interface AudioQueueItem {
	text: string
	messageTs: number
}

/**
 * Hook that handles automatic TTS synthesis and playback for Discuss Mode
 */
export function useDiscussModeAudio(messages: ClineMessage[]) {
	const { mode, discussModeEnabled, discussModeSettings, currentTaskItem } = useExtensionState()
	const [audioQueue, setAudioQueue] = useState<AudioQueueItem[]>([])
	const [isPlaying, setIsPlaying] = useState(false)
	const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null)
	const processedMessagesRef = useRef(new Set<number>())
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const lastTaskIdRef = useRef<string | undefined>(undefined)
	const lastMessageCountRef = useRef(0)
	const taskStartTimeRef = useRef<number>(Date.now()) // Track when we started tracking this task
	const activeBlobUrlsRef = useRef<Set<string>>(new Set()) // Track all blob URLs for cleanup
	const audioElementRef = useRef<HTMLAudioElement | null>(null) // Pre-created audio element for autoplay
	const pendingAudioRef = useRef<{
		url: string
		audio: HTMLAudioElement
		onEnded: () => void
		onError: (e: Event) => void
	} | null>(null) // Audio waiting for user interaction

	// Use blessed audio element from window if available, otherwise create one
	useEffect(() => {
		// Check if we have a blessed audio element from a user gesture
		const blessedAudio = (window as any).__discussModeAudio
		if (blessedAudio && !audioElementRef.current) {
			console.log("[DiscussModeAudio] Using blessed audio element from user gesture")
			audioElementRef.current = blessedAudio
			// Clear it so we don't reuse it
			delete (window as any).__discussModeAudio
		} else if (!audioElementRef.current) {
			console.log("[DiscussModeAudio] Creating audio element (may not be blessed)")
			const audio = new Audio()
			audio.preload = "auto"
			audioElementRef.current = audio
		}
		return () => {
			if (audioElementRef.current) {
				audioElementRef.current.pause()
				audioElementRef.current.src = ""
				audioElementRef.current = null
			}
		}
	}, [])

	// Clear processed messages when task changes OR message array is reset
	useEffect(() => {
		const currentTaskId = currentTaskItem?.id
		const currentMessageCount = messages.length

		// Helper function to cleanup all audio resources
		const cleanupAllAudio = () => {
			// Stop and cleanup current audio
			if (audioRef.current) {
				audioRef.current.pause()
				audioRef.current.currentTime = 0
				audioRef.current.src = ""
				audioRef.current = null
			}

			// Clean up pending audio
			if (pendingAudioRef.current) {
				const pending = pendingAudioRef.current
				pending.audio.removeEventListener("ended", pending.onEnded)
				pending.audio.removeEventListener("error", pending.onError)
				pending.audio.src = ""
				URL.revokeObjectURL(pending.url)
				activeBlobUrlsRef.current.delete(pending.url)
				pendingAudioRef.current = null
			}

			// Revoke ALL blob URLs to free memory and prevent replay
			activeBlobUrlsRef.current.forEach((url) => {
				console.log("[DiscussModeAudio] Revoking blob URL:", url.substring(0, 50))
				URL.revokeObjectURL(url)
			})
			activeBlobUrlsRef.current.clear()

			// Clear all state
			processedMessagesRef.current.clear()
			setAudioQueue([])
			setIsPlaying(false)
			setCurrentAudio(null)
			taskStartTimeRef.current = Date.now()
		}

		// Task ID changed
		if (currentTaskId && currentTaskId !== lastTaskIdRef.current) {
			console.log("[DiscussModeAudio] Task ID changed, CLEANING UP ALL AUDIO", {
				oldTaskId: lastTaskIdRef.current,
				newTaskId: currentTaskId,
				activeBlobUrls: activeBlobUrlsRef.current.size,
			})
			cleanupAllAudio()
			lastTaskIdRef.current = currentTaskId
			lastMessageCountRef.current = currentMessageCount
			return
		}

		// Message count dropped significantly (task switch or history cleared)
		if (currentMessageCount < lastMessageCountRef.current - 2) {
			console.log("[DiscussModeAudio] Message count dropped, CLEANING UP ALL AUDIO", {
				oldCount: lastMessageCountRef.current,
				newCount: currentMessageCount,
				activeBlobUrls: activeBlobUrlsRef.current.size,
			})
			cleanupAllAudio()
		}

		lastMessageCountRef.current = currentMessageCount
	}, [currentTaskItem?.id, messages.length])

	// Detect new text messages and add to queue
	useEffect(() => {
		console.log("[DiscussModeAudio] Effect triggered", {
			mode,
			discussModeEnabled,
			autoSpeak: discussModeSettings?.autoSpeak,
			messageCount: messages.length,
			currentTaskId: currentTaskItem?.id,
		})

		// Only process if in Plan Mode with Discuss Mode enabled and auto-speak on
		if (mode !== "plan") {
			console.log("[DiscussModeAudio] Not in plan mode, skipping")
			return
		}

		if (!discussModeEnabled) {
			console.log("[DiscussModeAudio] Discuss mode not enabled, skipping")
			return
		}

		if (!discussModeSettings?.autoSpeak) {
			console.log("[DiscussModeAudio] Auto-speak not enabled, skipping")
			return
		}

		// Find the last message
		const lastMessage = messages[messages.length - 1]
		if (!lastMessage) {
			console.log("[DiscussModeAudio] No messages found")
			return
		}

		console.log("[DiscussModeAudio] Last message:", {
			say: lastMessage.say,
			ask: lastMessage.ask,
			hasText: !!lastMessage.text,
			partial: lastMessage.partial,
			ts: lastMessage.ts,
			taskStartTime: taskStartTimeRef.current,
			messageAge: Date.now() - lastMessage.ts,
			isOldMessage: lastMessage.ts < taskStartTimeRef.current,
			alreadyProcessed: processedMessagesRef.current.has(lastMessage.ts),
		})

		// Check if it's a response from Cline that we haven't processed
		// IMPORTANT: Only process Cline's responses (ask is set), not user messages (say === "text")
		// In Plan Mode, Cline uses ask="plan_mode_respond" or ask="followup"
		const isClineResponse = lastMessage.ask !== undefined

		// CRITICAL: Only process messages created AFTER we started tracking this task
		// This prevents old messages from playing when switching tasks
		if (lastMessage.ts < taskStartTimeRef.current) {
			console.log("[DiscussModeAudio] Skipping old message from before current task started", {
				messageTs: lastMessage.ts,
				taskStartTime: taskStartTimeRef.current,
				messageAge: Date.now() - lastMessage.ts,
			})
			return
		}

		if (isClineResponse && lastMessage.text && !lastMessage.partial && !processedMessagesRef.current.has(lastMessage.ts)) {
			// Extract natural text from JSON response format
			let textToSpeak = lastMessage.text
			try {
				// Parse JSON to extract just the response text
				const parsed = JSON.parse(lastMessage.text)
				if (parsed.response) {
					textToSpeak = parsed.response
				}
			} catch (e) {
				// If not JSON, use the text as-is
				console.log("[DiscussModeAudio] Text is not JSON, using as-is")
			}

			// Skip if no actual text content
			if (!textToSpeak || textToSpeak.trim().length === 0) {
				console.log("[DiscussModeAudio] No text content to speak")
				return
			}

			// Truncate very long responses (ElevenLabs has limits)
			const maxLength = 5000 // ElevenLabs can handle ~5000 chars
			if (textToSpeak.length > maxLength) {
				console.log(`[DiscussModeAudio] Truncating long response from ${textToSpeak.length} to ${maxLength} chars`)
				textToSpeak = textToSpeak.substring(0, maxLength) + "... response truncated for audio."
			}

			// Mark as processed
			processedMessagesRef.current.add(lastMessage.ts)

			// Add to queue
			console.log("[DiscussModeAudio] New Cline response detected, adding to queue:", textToSpeak.substring(0, 50))
			setAudioQueue((prev) => [...prev, { text: textToSpeak, messageTs: lastMessage.ts }])
		}
	}, [messages, mode, discussModeEnabled, discussModeSettings?.autoSpeak])

	// Process audio queue
	useEffect(() => {
		// First, check if we have pending audio and a blessed element to retry it
		const blessedAudio = (window as any).__discussModeAudio
		const pending = pendingAudioRef.current

		if (blessedAudio && pending && !isPlaying) {
			console.log("[DiscussModeAudio] Blessed audio element available, retrying pending audio playback")

			// Use the blessed audio element
			audioElementRef.current = blessedAudio
			delete (window as any).__discussModeAudio

			// Update the pending audio to use the blessed element
			pending.audio = blessedAudio

			// Set up the audio and retry playback
			pending.audio.src = pending.url
			pending.audio.addEventListener("ended", pending.onEnded)
			pending.audio.addEventListener("error", pending.onError)

			audioRef.current = pending.audio
			setCurrentAudio(pending.audio)
			setIsPlaying(true)

			// Try to play
			pending.audio
				.play()
				.then(() => {
					console.log("[DiscussModeAudio] Pending audio playing successfully after user interaction")
					pendingAudioRef.current = null // Clear pending
				})
				.catch((err) => {
					console.error("[DiscussModeAudio] Failed to play pending audio even with blessed element:", err)
					// Clean up on failure
					pending.audio.removeEventListener("ended", pending.onEnded)
					pending.audio.removeEventListener("error", pending.onError)
					pending.audio.src = ""
					URL.revokeObjectURL(pending.url)
					activeBlobUrlsRef.current.delete(pending.url)
					pendingAudioRef.current = null
					setIsPlaying(false)
					setCurrentAudio(null)
					audioRef.current = null
					// Remove from queue since we can't play it
					setAudioQueue((prev) => prev.slice(1))
				})
			return
		}

		if (isPlaying || audioQueue.length === 0 || !discussModeSettings?.selectedVoice) {
			return
		}

		const processNextInQueue = async () => {
			const nextItem = audioQueue[0]
			if (!nextItem) return

			try {
				setIsPlaying(true)
				console.log("[DiscussModeAudio] Synthesizing speech for message:", nextItem.messageTs)

				// Call TTS service
				const response = await TtsServiceClient.SynthesizeSpeech(
					SynthesizeRequest.create({
						text: nextItem.text,
						voiceId: discussModeSettings.selectedVoice,
						speed: discussModeSettings.speechSpeed || 1.0,
					}),
				)

				if (response.error) {
					console.error("[DiscussModeAudio] TTS synthesis error:", response.error)
					// Remove from queue and try next
					setAudioQueue((prev) => prev.slice(1))
					setIsPlaying(false)
					return
				}

				if (!response.audioData || response.audioData.length === 0) {
					console.error("[DiscussModeAudio] No audio data received")
					setAudioQueue((prev) => prev.slice(1))
					setIsPlaying(false)
					return
				}

				// Convert Buffer to Blob
				const audioBlob = new Blob([new Uint8Array(response.audioData)], {
					type: response.contentType || "audio/mpeg",
				})
				const audioUrl = URL.createObjectURL(audioBlob)

				// Track this blob URL for cleanup
				activeBlobUrlsRef.current.add(audioUrl)
				console.log("[DiscussModeAudio] Created blob URL, total active:", activeBlobUrlsRef.current.size)

				// Check for blessed audio element from user gesture
				const blessedAudio = (window as any).__discussModeAudio
				if (blessedAudio) {
					console.log("[DiscussModeAudio] Found blessed audio element, using it")
					audioElementRef.current = blessedAudio
					delete (window as any).__discussModeAudio
				}

				// Use audio element (blessed or fallback)
				const audio = audioElementRef.current
				if (!audio) {
					console.error("[DiscussModeAudio] Audio element not available!")
					setAudioQueue((prev) => prev.slice(1))
					setIsPlaying(false)
					return
				}

				// Set up event handlers
				const onEnded = () => {
					console.log("[DiscussModeAudio] Audio playback completed, cleaning up")
					URL.revokeObjectURL(audioUrl)
					activeBlobUrlsRef.current.delete(audioUrl)
					setCurrentAudio(null)
					audioRef.current = null
					// Remove from queue
					setAudioQueue((prev) => prev.slice(1))
					setIsPlaying(false)
					// Clean up handlers
					audio.removeEventListener("ended", onEnded)
					audio.removeEventListener("error", onError)
				}

				const onError = (e: Event) => {
					console.error("[DiscussModeAudio] Audio playback error:", e)
					URL.revokeObjectURL(audioUrl)
					activeBlobUrlsRef.current.delete(audioUrl)
					setCurrentAudio(null)
					audioRef.current = null
					setAudioQueue((prev) => prev.slice(1))
					setIsPlaying(false)
					// Clean up handlers
					audio.removeEventListener("ended", onEnded)
					audio.removeEventListener("error", onError)
				}

				audio.addEventListener("ended", onEnded)
				audio.addEventListener("error", onError)

				// Update audio src and play
				audio.src = audioUrl
				audioRef.current = audio
				setCurrentAudio(audio)

				console.log("[DiscussModeAudio] Playing audio with pre-created element...")

				// Try to play
				try {
					await audio.play()
					console.log("[DiscussModeAudio] Audio playing successfully")
				} catch (playError) {
					console.warn(
						"[DiscussModeAudio] Autoplay blocked by browser. Keeping audio ready for retry after user interaction.",
					)

					// Browser blocked autoplay - keep audio ready for retry when user interacts
					// Store the audio setup so we can retry when blessed audio element becomes available
					pendingAudioRef.current = {
						url: audioUrl,
						audio: audio,
						onEnded,
						onError,
					}

					// Don't remove from queue or revoke blob URL yet - we'll retry
					setIsPlaying(false)

					// Note: Audio will automatically retry when user interacts and creates blessed audio element
					return
				}
			} catch (error) {
				console.error("[DiscussModeAudio] Error processing audio:", error)
				setAudioQueue((prev) => prev.slice(1))
				setIsPlaying(false)
			}
		}

		processNextInQueue()
	}, [audioQueue, isPlaying, discussModeSettings?.selectedVoice, discussModeSettings?.speechSpeed])

	// Cleanup on unmount - revoke ALL blob URLs
	useEffect(() => {
		return () => {
			console.log("[DiscussModeAudio] Component unmounting, cleaning up all audio")
			if (audioRef.current) {
				audioRef.current.pause()
				audioRef.current.src = ""
				audioRef.current = null
			}
			// Clean up pending audio
			if (pendingAudioRef.current) {
				const pending = pendingAudioRef.current
				pending.audio.removeEventListener("ended", pending.onEnded)
				pending.audio.removeEventListener("error", pending.onError)
				pending.audio.src = ""
				URL.revokeObjectURL(pending.url)
				pendingAudioRef.current = null
			}
			// Revoke all blob URLs
			activeBlobUrlsRef.current.forEach((url) => {
				URL.revokeObjectURL(url)
			})
			activeBlobUrlsRef.current.clear()
		}
	}, [])

	// Clear queue and DELETE all audio blobs when Discuss Mode is disabled or mode changes
	useEffect(() => {
		if (mode !== "plan" || !discussModeEnabled) {
			console.log("[DiscussModeAudio] Mode/Discuss Mode changed, DELETING ALL AUDIO BLOBS", {
				mode,
				discussModeEnabled,
				activeBlobUrls: activeBlobUrlsRef.current.size,
			})

			// Stop current audio
			if (audioRef.current) {
				audioRef.current.pause()
				audioRef.current.currentTime = 0
				audioRef.current.src = ""
				audioRef.current = null
			}

			// Clean up pending audio
			if (pendingAudioRef.current) {
				const pending = pendingAudioRef.current
				pending.audio.removeEventListener("ended", pending.onEnded)
				pending.audio.removeEventListener("error", pending.onError)
				pending.audio.src = ""
				URL.revokeObjectURL(pending.url)
				activeBlobUrlsRef.current.delete(pending.url)
				pendingAudioRef.current = null
			}

			// Revoke ALL blob URLs to delete audio files from memory
			activeBlobUrlsRef.current.forEach((url) => {
				console.log("[DiscussModeAudio] Deleting audio blob:", url.substring(0, 50))
				URL.revokeObjectURL(url)
			})
			activeBlobUrlsRef.current.clear()

			// Clear all state
			setAudioQueue([])
			setIsPlaying(false)
			setCurrentAudio(null)
			processedMessagesRef.current.clear()
			taskStartTimeRef.current = Date.now()

			console.log("[DiscussModeAudio] All audio blobs deleted and state cleared")
		}
	}, [mode, discussModeEnabled])

	// Expose function to stop current audio (useful when user starts recording)
	const stopAudio = () => {
		if (audioRef.current) {
			console.log("[DiscussModeAudio] Stopping current audio playback")
			audioRef.current.pause()
			audioRef.current.currentTime = 0

			// Clear queue to prevent auto-continuing
			setAudioQueue([])
			setIsPlaying(false)
		}
	}

	return {
		isPlaying,
		queueLength: audioQueue.length,
		stopAudio,
	}
}
