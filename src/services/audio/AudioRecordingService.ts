import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { spawn, ChildProcess } from "child_process"
import { Logger } from "@services/logging/Logger"

export class AudioRecordingService {
	private recordingProcess: ChildProcess | null = null
	private isRecording: boolean = false
	private startTime: number = 0
	private outputFile: string = ""

	constructor() {}

	async startRecording(): Promise<{ success: boolean; error?: string }> {
		try {
			if (this.isRecording) {
				return { success: false, error: "Already recording" }
			}

			// Create temporary file for audio output
			const tempDir = os.tmpdir()
			this.outputFile = path.join(tempDir, `cline_recording_${Date.now()}.wav`)

			Logger.info("Starting audio recording...")

			// Get the recording program path
			const recordProgram = this.getRecordProgram()
			Logger.info(`Using recording program: ${recordProgram}`)

			// Set up recording arguments for rec/sox
			const args = [
				"-c",
				"1", // Mono
				"-e",
				"signed", // Encoding
				"-b",
				"16", // 16-bit
				this.outputFile, // Output file
			]
			// Note: We don't specify sample rate to avoid warnings - rec will use system default

			// Spawn the recording process
			this.recordingProcess = spawn(recordProgram, args)
			this.isRecording = true
			this.startTime = Date.now()

			// Handle process errors
			this.recordingProcess.on("error", (error) => {
				Logger.error(`Recording process error: ${error.message}`)
				this.isRecording = false
			})

			// Handle process exit
			this.recordingProcess.on("exit", (code) => {
				if (code !== 0 && code !== null) {
					Logger.warn(`Recording process exited with code: ${code}`)
				}
			})

			// Log stderr for debugging
			this.recordingProcess.stderr?.on("data", (data) => {
				const message = data.toString().trim()
				if (message && !message.includes("In:") && !message.includes("Out:")) {
					Logger.info(`Recording stderr: ${message}`)
				}
			})

			Logger.info("Audio recording started successfully")
			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			Logger.error("Failed to start audio recording: " + errorMessage)
			return { success: false, error: `Failed to start recording: ${errorMessage}` }
		}
	}

	async stopRecording(): Promise<{ success: boolean; audioBase64?: string; error?: string }> {
		try {
			if (!this.isRecording || !this.recordingProcess) {
				return { success: false, error: "Not currently recording" }
			}

			Logger.info("Stopping audio recording...")

			// Send SIGINT to stop recording gracefully (like Ctrl+C)
			this.recordingProcess.kill("SIGINT")

			// Wait for the process to finish
			await new Promise<void>((resolve) => {
				if (this.recordingProcess) {
					this.recordingProcess.on("exit", () => resolve())
					// Timeout after 2 seconds
					setTimeout(() => resolve(), 2000)
				} else {
					resolve()
				}
			})

			this.recordingProcess = null
			this.isRecording = false

			// Wait a moment for file to be fully written
			await new Promise((resolve) => setTimeout(resolve, 500))

			// Read the audio file and convert to base64
			if (!fs.existsSync(this.outputFile)) {
				return { success: false, error: "Recording file not found" }
			}

			const audioBuffer = fs.readFileSync(this.outputFile)
			const audioBase64 = audioBuffer.toString("base64")

			// Clean up temporary file
			try {
				fs.unlinkSync(this.outputFile)
			} catch (cleanupError) {
				Logger.warn(
					"Failed to cleanup temporary audio file: " +
						(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)),
				)
			}

			Logger.info("Audio recording stopped and converted to base64")
			return { success: true, audioBase64 }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			Logger.error("Failed to stop audio recording: " + errorMessage)
			return { success: false, error: `Failed to stop recording: ${errorMessage}` }
		}
	}

	getRecordingStatus(): { isRecording: boolean; durationSeconds: number; error?: string } {
		const durationSeconds = this.isRecording ? (Date.now() - this.startTime) / 1000 : 0
		return {
			isRecording: this.isRecording,
			durationSeconds,
		}
	}

	private getRecordProgram(): string {
		// Determine the best recording program for the platform
		const platform = os.platform()

		switch (platform) {
			case "darwin": // macOS
				// Try different options in order of preference
				if (fs.existsSync("/usr/local/bin/rec")) {
					return "/usr/local/bin/rec" // from SoX if installed
				} else if (fs.existsSync("/opt/homebrew/bin/rec")) {
					return "/opt/homebrew/bin/rec" // from SoX via Homebrew on M1
				} else if (fs.existsSync("/usr/local/bin/sox")) {
					return "/usr/local/bin/sox" // sox command directly
				} else if (fs.existsSync("/opt/homebrew/bin/sox")) {
					return "/opt/homebrew/bin/sox" // sox via Homebrew
				} else {
					// Last resort - try just the command name and hope it's in PATH
					return "rec"
				}
			case "linux":
				// On Linux, use arecord which is part of ALSA
				if (fs.existsSync("/usr/bin/arecord")) {
					return "/usr/bin/arecord"
				}
				return "arecord"
			case "win32": // Windows
				// On Windows, SoX is usually in Program Files
				const soxPath = "C:\\Program Files (x86)\\sox\\sox.exe"
				if (fs.existsSync(soxPath)) {
					return soxPath
				}
				return "sox"
			default:
				return "rec"
		}
	}

	// Cleanup method
	cleanup(): void {
		if (this.isRecording && this.recordingProcess) {
			try {
				this.recordingProcess.kill("SIGINT")
				this.recordingProcess = null
				this.isRecording = false
			} catch (error) {
				Logger.error("Error during cleanup: " + (error instanceof Error ? error.message : String(error)))
			}
		}

		// Clean up any leftover temp files
		if (this.outputFile && fs.existsSync(this.outputFile)) {
			try {
				fs.unlinkSync(this.outputFile)
			} catch (error) {
				Logger.warn(
					"Failed to cleanup temp file during service cleanup: " +
						(error instanceof Error ? error.message : String(error)),
				)
			}
		}
	}
}

export const audioRecordingService = new AudioRecordingService()
