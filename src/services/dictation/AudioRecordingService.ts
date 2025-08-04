import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { spawn, ChildProcess } from "child_process"
import { Logger } from "@services/logging/Logger"
import { AUDIO_PROGRAM_CONFIG } from "@/shared/audioProgramConstants"

function isExecutable(filePath: string): boolean {
	try {
		fs.accessSync(filePath, fs.constants.X_OK)
		return true
	} catch (e) {
		return false
	}
}

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

			// Check if recording software is available
			const checkResult = this.checkRecordingDependencies()
			if (!checkResult.available) {
				return { success: false, error: checkResult.error }
			}

			// Create temporary file for audio output
			const tempDir = os.tmpdir()
			this.outputFile = path.join(tempDir, `cline_recording_${Date.now()}.webm`)

			Logger.info("Starting audio recording...")

			// Get the recording program path
			const recordProgram = this.getRecordProgram()
			if (!recordProgram) {
				return { success: false, error: "Recording program not found" }
			}
			Logger.info(`Using recording program: ${recordProgram.path}`)

			// Set up recording arguments
			const args = recordProgram.getArgs(this.outputFile)

			// Spawn the recording process
			this.recordingProcess = spawn(recordProgram.path, args)
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
					// Timeout after 5 seconds
					const timeoutId = setTimeout(() => {
						resolve()
					}, 5000)

					this.recordingProcess.on("exit", (code) => {
						clearTimeout(timeoutId) // Clear the timeout since process exited
						resolve()
					})
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

	private checkRecordingDependencies(): { available: boolean; error?: string } {
		const program = this.getRecordProgram()
		if (!program) {
			const platform = os.platform() as keyof typeof AUDIO_PROGRAM_CONFIG
			const config = AUDIO_PROGRAM_CONFIG[platform]
			const error = config ? config.error : `Audio recording is not supported on platform: ${platform}`
			return { available: false, error }
		}
		return { available: true }
	}

	private getRecordProgram(): { path: string; getArgs: (outputFile: string) => string[] } | undefined {
		const platform = os.platform() as keyof typeof AUDIO_PROGRAM_CONFIG
		const config = AUDIO_PROGRAM_CONFIG[platform]

		if (!config) {
			return undefined
		}

		// 1. Check if the command is in the system's PATH
		const pathDirs = (process.env.PATH || "").split(path.delimiter)
		for (const dir of pathDirs) {
			const fullPath = path.join(dir, config.command)
			if (fs.existsSync(fullPath) && isExecutable(fullPath)) {
				return { path: fullPath, getArgs: config.getArgs }
			}
		}

		// 2. Check fallback paths if not in PATH
		for (const p of config.fallbackPaths) {
			if (fs.existsSync(p) && isExecutable(p)) {
				return { path: p, getArgs: config.getArgs }
			}
		}

		return undefined
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
