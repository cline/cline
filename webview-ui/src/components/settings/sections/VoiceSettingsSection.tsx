import { EmptyRequest } from "@shared/proto/cline/common"
import { ValidateApiKeyRequest } from "@shared/proto/cline/tts"
import { DiscussVoiceSettingsRequest } from "@shared/proto/cline/ui"
import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { Eye, EyeOff, Volume2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TtsServiceClient, UiServiceClient } from "@/services/grpc-client"
import Section from "../Section"

interface VoiceSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

import type { Voice as TtsVoice } from "@shared/proto/cline/tts"

const VoiceSettingsSection = ({ renderSectionHeader }: VoiceSettingsSectionProps) => {
	const { discussModeSettings } = useExtensionState()

	const [apiKey, setApiKey] = useState("")
	const [showApiKey, setShowApiKey] = useState(false)
	const [isValidating, setIsValidating] = useState(false)
	const [validationError, setValidationError] = useState<string | null>(null)
	const [isValid, setIsValid] = useState(false)

	const [voices, setVoices] = useState<TtsVoice[]>([])
	const [isLoadingVoices, setIsLoadingVoices] = useState(false)
	const [voicesError, setVoicesError] = useState<string | null>(null)

	const [selectedVoice, setSelectedVoice] = useState(discussModeSettings?.selectedVoice || "")
	const [speechSpeed, setSpeechSpeed] = useState(discussModeSettings?.speechSpeed || 1.0)
	const [autoSpeak, setAutoSpeak] = useState(discussModeSettings?.autoSpeak || false)
	const [autoListen, setAutoListen] = useState(discussModeSettings?.autoListen || false)

	// Sync with global settings whenever they change
	useEffect(() => {
		if (discussModeSettings) {
			setSelectedVoice(discussModeSettings.selectedVoice || "")
			setSpeechSpeed(discussModeSettings.speechSpeed || 1.0)
			setAutoSpeak(discussModeSettings.autoSpeak || false)
			setAutoListen(discussModeSettings.autoListen || false)
		}
	}, [discussModeSettings])

	// Load API key and voices on mount
	useEffect(() => {
		const loadInitialData = async () => {
			// Check if API key is already configured
			try {
				const response = await TtsServiceClient.CheckApiKeyConfigured(EmptyRequest.create())

				if (response.isValid) {
					// API key exists and is valid
					setIsValid(true)
					setValidationError(null)
					// Don't show the actual key for security, but indicate it exists
					setApiKey("••••••••••••••••")
					// Load voices automatically
					await loadVoices()
				}
			} catch (error) {
				console.error("Failed to check API key:", error)
			}
		}
		loadInitialData()
	}, [])

	const validateApiKey = async (key: string) => {
		if (!key.trim()) {
			setValidationError("API key is required")
			setIsValid(false)
			return
		}

		setIsValidating(true)
		setValidationError(null)

		try {
			const response = await TtsServiceClient.ValidateApiKey(ValidateApiKeyRequest.create({ apiKey: key }))

			if (response.isValid) {
				setIsValid(true)
				setValidationError(null)
				// Note: API key will be saved by the backend handler
				// Load voices
				await loadVoices()
			} else {
				setIsValid(false)
				setValidationError(response.error || "Invalid API key")
			}
		} catch (error) {
			setIsValid(false)
			setValidationError("Failed to validate API key: " + (error as Error).message)
		} finally {
			setIsValidating(false)
		}
	}

	const loadVoices = async () => {
		setIsLoadingVoices(true)
		setVoicesError(null)

		try {
			const response = await TtsServiceClient.GetAvailableVoices(EmptyRequest.create())

			if (response.error) {
				setVoicesError(response.error)
				setVoices([])
			} else {
				setVoices(response.voices)

				// Auto-select "Liam" voice if available and no voice is currently selected
				if (response.voices.length > 0 && !selectedVoice) {
					// Try to find Liam voice
					const liamVoice = response.voices.find((v) => v.name.toLowerCase().includes("liam"))

					if (liamVoice) {
						// Found Liam, select it automatically
						setSelectedVoice(liamVoice.id)
						// Save to state
						await UiServiceClient.updateDiscussVoiceSettings(
							DiscussVoiceSettingsRequest.create({ selectedVoice: liamVoice.id }),
						)
						console.log("Auto-selected Liam voice:", liamVoice.name)
					}
				}
			}
		} catch (error) {
			setVoicesError("Failed to load voices: " + (error as Error).message)
			setVoices([])
		} finally {
			setIsLoadingVoices(false)
		}
	}

	const handleApiKeyChange = (e: any) => {
		const value = e.target.value
		setApiKey(value)
		setIsValid(false)
		setValidationError(null)
	}

	const handleApiKeyBlur = async () => {
		if (apiKey.trim()) {
			await validateApiKey(apiKey)
		}
	}

	const handleVoiceChange = useCallback(async (e: any) => {
		const voice = e.target.value
		setSelectedVoice(voice)

		// Save to state via gRPC
		await UiServiceClient.updateDiscussVoiceSettings(DiscussVoiceSettingsRequest.create({ selectedVoice: voice }))
	}, [])

	const handleSpeedChange = useCallback(async (e: any) => {
		const speed = parseFloat(e.target.value)
		setSpeechSpeed(speed)

		// Save to state via gRPC
		await UiServiceClient.updateDiscussVoiceSettings(DiscussVoiceSettingsRequest.create({ speechSpeed: speed }))
	}, [])

	const handleAutoSpeakChange = useCallback(async (e: any) => {
		const checked = e.target.checked === true
		setAutoSpeak(checked)

		// Save to state via gRPC
		await UiServiceClient.updateDiscussVoiceSettings(DiscussVoiceSettingsRequest.create({ autoSpeak: checked }))
	}, [])

	const handleAutoListenChange = useCallback(async (e: any) => {
		const checked = e.target.checked === true
		setAutoListen(checked)

		// Save to state via gRPC
		await UiServiceClient.updateDiscussVoiceSettings(DiscussVoiceSettingsRequest.create({ autoListen: checked }))
	}, [])

	const handleTestVoice = async () => {
		if (!selectedVoice) {
			console.error("No voice selected")
			alert("Please select a voice first")
			return
		}

		try {
			console.log("Testing voice:", selectedVoice, "at speed:", speechSpeed)

			// Synthesize a test phrase
			const testText = "Hello! This is a test of the text-to-speech voice."
			console.log("Requesting TTS for:", testText)

			const response = await TtsServiceClient.SynthesizeSpeech({
				text: testText,
				voiceId: selectedVoice,
				speed: speechSpeed,
			})

			console.log("TTS Response:", {
				audioDataLength: response.audioData.length,
				contentType: response.contentType,
				error: response.error,
			})

			if (response.error) {
				console.error("TTS Error:", response.error)
				alert("Failed to test voice: " + response.error)
				return
			}

			if (!response.audioData || response.audioData.length === 0) {
				console.error("Empty audio data received")
				alert("Failed to test voice: No audio data received")
				return
			}

			// Play the audio using a DOM audio element (works better in VSCode webview)
			console.log("Converting audio data...")
			const audioArray = new Uint8Array(response.audioData)
			console.log("Audio array length:", audioArray.length)

			const blob = new Blob([audioArray], { type: response.contentType || "audio/mpeg" })
			console.log("Blob created:", blob.size, "bytes, type:", blob.type)

			const url = URL.createObjectURL(blob)
			console.log("Object URL created:", url)

			// Create audio element in DOM (VSCode webview friendly)
			const audioElement = document.createElement("audio")
			audioElement.src = url
			audioElement.preload = "auto"

			// Add to DOM temporarily
			audioElement.style.display = "none"
			document.body.appendChild(audioElement)

			audioElement.onerror = (e) => {
				console.error("Audio playback error:", e, audioElement.error)
				alert("Failed to play audio: " + (audioElement.error?.message || "Unknown error"))
				URL.revokeObjectURL(url)
				document.body.removeChild(audioElement)
			}

			audioElement.onended = () => {
				console.log("Audio playback completed")
				URL.revokeObjectURL(url)
				document.body.removeChild(audioElement)
			}

			audioElement.onloadeddata = () => {
				console.log("Audio data loaded, duration:", audioElement.duration)
			}

			audioElement.oncanplay = () => {
				console.log("Audio ready to play")
			}

			console.log("Starting audio playback...")
			try {
				await audioElement.play()
				console.log("Audio.play() called successfully")
			} catch (playError) {
				console.error("Play error:", playError)
				alert(
					"Audio playback blocked: " +
						(playError as Error).message +
						"\n\nTip: Try clicking in the window first, or check your browser/VSCode audio settings.",
				)
				URL.revokeObjectURL(url)
				document.body.removeChild(audioElement)
			}
		} catch (error) {
			console.error("Test voice error:", error)
			alert("Failed to test voice: " + (error as Error).message)
		}
	}

	return (
		<div>
			{renderSectionHeader("voice")}
			<Section>
				<div className="mb-[5px]">
					<h4 className="text-sm font-semibold mb-2">Text-to-Speech Configuration</h4>
					<p className="text-sm text-description mb-4">
						Configure voice output for Discuss Mode. Cline will speak responses during interactive planning
						conversations.
					</p>
				</div>

				{/* API Key Input */}
				<div className="mb-[5px]">
					<label className="text-sm font-medium mb-2 block">ElevenLabs API Key</label>
					<div className="flex gap-2 items-start">
						<div className="flex-1">
							<VSCodeTextField
								className="w-full"
								onBlur={handleApiKeyBlur}
								onChange={handleApiKeyChange}
								placeholder="Enter your ElevenLabs API key"
								type={showApiKey ? "text" : "password"}
								value={apiKey}
							/>
						</div>
						<VSCodeButton
							appearance="icon"
							onClick={() => setShowApiKey(!showApiKey)}
							title={showApiKey ? "Hide API key" : "Show API key"}>
							{showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
						</VSCodeButton>
						<VSCodeButton disabled={isValidating || !apiKey.trim()} onClick={() => validateApiKey(apiKey)}>
							{isValidating ? "Validating..." : "Validate"}
						</VSCodeButton>
					</div>

					{validationError && <p className="text-sm mt-2 text-red-500">{validationError}</p>}

					{isValid && <p className="text-sm mt-2 text-green-500">✓ API key is valid</p>}

					<p className="text-sm mt-2 text-description">
						Get your free API key from{" "}
						<a className="text-link underline" href="https://elevenlabs.io" rel="noopener noreferrer" target="_blank">
							elevenlabs.io
						</a>
					</p>
				</div>

				{/* Voice Selection */}
				{isValid && (
					<div className="mb-[5px]">
						<label className="text-sm font-medium mb-2 block">Voice Selection</label>
						<div className="flex gap-2 items-start">
							<select
								className="flex-1 px-2 py-1 bg-input text-foreground border border-input-border rounded"
								disabled={isLoadingVoices}
								onChange={handleVoiceChange}
								value={selectedVoice}>
								<option value="">Select a voice...</option>
								{voices.map((voice) => (
									<option key={voice.id} value={voice.id}>
										{voice.name}
									</option>
								))}
							</select>
							<VSCodeButton disabled={!selectedVoice || isLoadingVoices} onClick={handleTestVoice}>
								<Volume2 className="w-4 h-4 mr-1" />
								Test
							</VSCodeButton>
						</div>

						{isLoadingVoices && <p className="text-sm mt-2 text-description">Loading voices...</p>}

						{voicesError && <p className="text-sm mt-2 text-red-500">{voicesError}</p>}

						{selectedVoice && voices.length > 0 && (
							<p className="text-sm mt-2 text-description">
								{voices.find((v) => v.id === selectedVoice)?.description || ""}
							</p>
						)}
					</div>
				)}

				{/* Speech Speed */}
				{isValid && selectedVoice && (
					<div className="mb-[5px]">
						<label className="text-sm font-medium mb-2 block">Speech Speed: {speechSpeed.toFixed(1)}x</label>
						<input
							className="w-full"
							max="1.2"
							min="0.7"
							onChange={handleSpeedChange}
							step="0.1"
							type="range"
							value={speechSpeed}
						/>
						<p className="text-sm mt-2 text-description">
							Adjust how fast Cline speaks (0.7x = slower, 1.2x = faster)
						</p>
					</div>
				)}

				{/* Auto-Speak Toggle */}
				{isValid && selectedVoice && (
					<div className="mb-[5px]">
						<VSCodeCheckbox checked={autoSpeak} onChange={handleAutoSpeakChange}>
							Automatically speak responses
						</VSCodeCheckbox>
						<p className="text-sm mt-2 text-description">
							When enabled, Cline will automatically speak text responses in Plan Mode with Discuss Mode active
						</p>
					</div>
				)}

				{/* Auto-Listen Toggle */}
				{isValid && selectedVoice && autoSpeak && (
					<div className="mb-[5px]">
						<VSCodeCheckbox checked={autoListen} onChange={handleAutoListenChange}>
							Auto-continue conversation
						</VSCodeCheckbox>
						<p className="text-sm mt-2 text-description">
							When enabled, voice input will automatically start after Cline finishes speaking, creating a natural
							conversation flow
						</p>
					</div>
				)}

				{/* Voice Input Information */}
				{isValid && selectedVoice && (
					<div className="mb-[5px] mt-4 p-3 bg-[rgba(var(--vscode-textBlockQuote-background-rgb),0.5)] border-l-2 border-[var(--vscode-textBlockQuote-border)] rounded">
						<h5 className="text-sm font-semibold mb-2">Voice Input (Speech-to-Text)</h5>
						<p className="text-sm text-description mb-2">
							Voice input for Discuss Mode uses your ElevenLabs API key for transcription (Scribe v1 model).
						</p>
						<p className="text-sm text-description mb-2">
							When both Discuss Mode and Dictation are enabled, you'll see a microphone button in the chat input.
							Click it to record your voice, and your audio will be transcribed using ElevenLabs' Speech-to-Text
							API.
						</p>
						<p className="text-sm text-description mb-2">
							<strong>Features:</strong> Supports 99 languages, high accuracy transcription, speaker diarization,
							and word-level timestamps.
						</p>
						<p className="text-sm text-description">
							<strong>Note:</strong> Voice input requires macOS (for audio recording) and your ElevenLabs API key
							(already configured above).
						</p>
					</div>
				)}
			</Section>
		</div>
	)
}

export default VoiceSettingsSection
