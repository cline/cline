import { MicIcon } from "lucide-react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// TypeScript declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
	resultIndex: number
	results: SpeechRecognitionResultList
}

interface SpeechRecognitionResultList {
	length: number
	item(index: number): SpeechRecognitionResult
	[index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
	isFinal: boolean
	length: number
	item(index: number): SpeechRecognitionAlternative
	[index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
	transcript: string
	confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
	error: string
	message: string
}

interface SpeechRecognition extends EventTarget {
	continuous: boolean
	interimResults: boolean
	lang: string
	maxAlternatives: number
	start(): void
	stop(): void
	abort(): void
	onstart: ((this: SpeechRecognition, ev: Event) => void) | null
	onend: ((this: SpeechRecognition, ev: Event) => void) | null
	onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null
	onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null
	onspeechend: ((this: SpeechRecognition, ev: Event) => void) | null
}

interface SpeechRecognitionConstructor {
	new (): SpeechRecognition
}

declare global {
	interface Window {
		SpeechRecognition?: SpeechRecognitionConstructor
		webkitSpeechRecognition?: SpeechRecognitionConstructor
	}
}

interface WebSpeechRecorderProps {
	onTranscription: (text: string, isFinal: boolean) => void
	onRecordingStateChange?: (isRecording: boolean) => void
	disabled?: boolean
	language?: string
}

/**
 * WebSpeechRecorder - Real-time voice recognition using Web Speech API
 *
 * This provides Copilot-style real-time streaming transcription directly in the browser.
 * Falls back gracefully if Web Speech API is not supported.
 */
const WebSpeechRecorder: React.FC<WebSpeechRecorderProps> = ({
	onTranscription,
	onRecordingStateChange,
	disabled = false,
	language = "en-US",
}) => {
	const [isListening, setIsListening] = useState(false)
	const [isSupported, setIsSupported] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [interimTranscript, setInterimTranscript] = useState("")
	const recognitionRef = useRef<SpeechRecognition | null>(null)
	const restartTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	// Check if Web Speech API is supported
	useEffect(() => {
		const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
		setIsSupported(!!SpeechRecognitionAPI)
	}, [])

	// Notify parent when recording state changes
	useEffect(() => {
		onRecordingStateChange?.(isListening)
	}, [isListening, onRecordingStateChange])

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (recognitionRef.current) {
				recognitionRef.current.abort()
				recognitionRef.current = null
			}
			if (restartTimeoutRef.current) {
				clearTimeout(restartTimeoutRef.current)
				restartTimeoutRef.current = null
			}
		}
	}, [])

	const startListening = useCallback(() => {
		if (!isSupported || disabled) {
			return
		}

		const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
		if (!SpeechRecognitionAPI) {
			setError("Speech recognition not supported")
			return
		}

		try {
			// Stop any existing recognition
			if (recognitionRef.current) {
				recognitionRef.current.abort()
			}

			const recognition = new SpeechRecognitionAPI()
			recognitionRef.current = recognition

			// Configure for real-time streaming
			recognition.continuous = true // Keep listening until stopped
			recognition.interimResults = true // Get results as user speaks
			recognition.lang = language
			recognition.maxAlternatives = 1

			recognition.onstart = () => {
				setIsListening(true)
				setError(null)
				setInterimTranscript("")
				console.log("Web Speech: Started listening")
			}

			recognition.onresult = (event: SpeechRecognitionEvent) => {
				let finalTranscript = ""
				let currentInterim = ""

				for (let i = event.resultIndex; i < event.results.length; i++) {
					const result = event.results[i]
					const transcript = result[0].transcript

					if (result.isFinal) {
						finalTranscript += transcript
					} else {
						currentInterim += transcript
					}
				}

				// Update interim display
				setInterimTranscript(currentInterim)

				// Send final transcript to parent
				if (finalTranscript) {
					onTranscription(finalTranscript, true)
				} else if (currentInterim) {
					// Send interim for live preview
					onTranscription(currentInterim, false)
				}
			}

			recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
				console.error("Web Speech error:", event.error, event.message)

				// Handle specific errors
				switch (event.error) {
					case "not-allowed":
						setError("Microphone access denied. Please allow microphone access.")
						setIsListening(false)
						break
					case "no-speech":
						// This is normal - just restart if still listening
						if (isListening) {
							restartTimeoutRef.current = setTimeout(() => {
								if (recognitionRef.current && isListening) {
									try {
										recognitionRef.current.start()
									} catch {
										// Already started, ignore
									}
								}
							}, 100)
						}
						break
					case "aborted":
						// User or code stopped it, no error to show
						break
					case "network":
						setError("Network error. Check your connection.")
						setIsListening(false)
						break
					default:
						setError(`Speech error: ${event.error}`)
						setIsListening(false)
				}
			}

			recognition.onend = () => {
				console.log("Web Speech: Session ended")
				// If we're still supposed to be listening, restart
				if (isListening && recognitionRef.current) {
					restartTimeoutRef.current = setTimeout(() => {
						if (recognitionRef.current && isListening) {
							try {
								recognitionRef.current.start()
							} catch {
								// Recognition already started or other error
								setIsListening(false)
							}
						}
					}, 100)
				} else {
					setIsListening(false)
					setInterimTranscript("")
				}
			}

			recognition.onspeechend = () => {
				console.log("Web Speech: Speech ended")
			}

			recognition.start()
		} catch (err) {
			console.error("Failed to start speech recognition:", err)
			setError("Failed to start voice input")
			setIsListening(false)
		}
	}, [isSupported, disabled, language, isListening, onTranscription])

	const stopListening = useCallback(() => {
		if (restartTimeoutRef.current) {
			clearTimeout(restartTimeoutRef.current)
			restartTimeoutRef.current = null
		}

		if (recognitionRef.current) {
			recognitionRef.current.stop()
			recognitionRef.current = null
		}

		setIsListening(false)
		setInterimTranscript("")
		setError(null)
	}, [])

	const toggleListening = useCallback(() => {
		if (isListening) {
			stopListening()
		} else {
			startListening()
		}
	}, [isListening, startListening, stopListening])

	// Don't render if not supported
	if (!isSupported) {
		return null
	}

	const getTooltipContent = () => {
		if (error) {
			return `Error: ${error}`
		}
		if (isListening) {
			return interimTranscript
				? `Listening: "${interimTranscript.slice(0, 50)}${interimTranscript.length > 50 ? "..." : ""}"`
				: "Listening... (speak now)"
		}
		return "Voice Input (Real-time)"
	}

	const getIconColor = () => {
		if (error) {
			return "text-error"
		}
		if (isListening) {
			return "text-green-500"
		}
		return ""
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					className={cn("pt-1 input-icon-button mr-1.5 text-base mt-0.5 relative", getIconColor(), {
						disabled: disabled,
					})}
					data-testid="web-speech-recorder-button"
					onClick={toggleListening}>
					{isListening ? (
						<>
							<MicIcon className="w-4 h-4" />
							{/* Pulsing indicator when listening */}
							<span
								aria-hidden="true"
								className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full animate-pulse"
							/>
						</>
					) : (
						<MicIcon className="w-4 h-4" />
					)}
				</div>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs" side="top">
				{getTooltipContent()}
			</TooltipContent>
		</Tooltip>
	)
}

export default WebSpeechRecorder
