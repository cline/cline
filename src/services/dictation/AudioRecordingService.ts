import { ChildProcess, execSync, spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { AUDIO_PROGRAM_CONFIG } from "@/shared/audioProgramConstants"
import { Logger } from "@/shared/services/Logger"

function isExecutable(filePath: string): boolean {
	try {
		fs.accessSync(filePath, fs.constants.X_OK)
		return true
	} catch {
		return false
	}
}

/**
 * Detects the first available audio input device on Windows using FFmpeg
 * Returns the device's alternative name (GUID format) which is more reliable
 */
function detectWindowsAudioDevice(ffmpegPath: string): string | null {
	try {
		Logger.info("Detecting Windows audio devices...")
		const result = execSync(`"${ffmpegPath}" -list_devices true -f dshow -i dummy 2>&1`, {
			encoding: "utf8",
			timeout: 5000,
		})

		Logger.info(`FFmpeg device list output:\n${result}`)

		// Look for audio devices and their alternative names
		// Format is:
		//   "Device Name" (audio)
		//   Alternative name
		//   "@device_cm_{...}\wave_{...}"
		const lines = result.split("\n")
		let foundAudioDevice = false
		let waitingForAltName = false

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]

			if (line.includes("(audio)")) {
				foundAudioDevice = true
				Logger.info(`Found audio device: ${line.trim()}`)
				continue
			}

			if (foundAudioDevice && line.includes("Alternative name")) {
				waitingForAltName = true
				continue
			}

			if (waitingForAltName) {
				// This line should contain the device ID in quotes
				const match = line.match(/"([^"]+)"/)
				if (match) {
					Logger.info(`Using audio device ID: ${match[1]}`)
					return match[1]
				}
				// Reset if we didn't find a quoted string
				waitingForAltName = false
			}
		}

		// Fallback: try to extract device name directly
		if (foundAudioDevice) {
			for (const line of lines) {
				if (line.includes("(audio)")) {
					const match = line.match(/"([^"]+)"/)
					if (match) {
						Logger.info(`Using audio device name as fallback: ${match[1]}`)
						return match[1]
					}
				}
			}
		}

		Logger.warn("No audio device found")
		return null
	} catch (error) {
		Logger.error(`Failed to detect audio devices: ${error instanceof Error ? error.message : String(error)}`)
		return null
	}
}

export class AudioRecordingService {
	private recordingProcess: ChildProcess | null = null
	private startTime: number = 0
	private outputFile: string = ""
	private _isRecordingActive: boolean = false

	constructor() {}

	/**
	 * Determines if recording is currently active
	 * Uses explicit flag rather than just process state, since process may exit but recording data is still valid
	 */
	private get isRecording(): boolean {
		return this._isRecordingActive
	}

	private set isRecording(value: boolean) {
		this._isRecordingActive = value
	}

	/**
	 * Resets the recording state variables
	 */
	private resetRecordingState(): void {
		this.recordingProcess = null
		this.startTime = 0
		this._isRecordingActive = false
	}

	/**
	 * Cleans up the temporary audio file
	 */
	private async cleanupTempFile(): Promise<void> {
		if (this.outputFile && fs.existsSync(this.outputFile)) {
			try {
				fs.unlinkSync(this.outputFile)
				Logger.info("Temporary audio file cleaned up")
			} catch (error) {
				Logger.warn("Failed to cleanup temporary audio file: " + (error instanceof Error ? error.message : String(error)))
			} finally {
				this.outputFile = ""
			}
		}
	}

	/**
	 * Terminates the recording process gracefully
	 */
	private async terminateProcess(): Promise<void> {
		if (!this.recordingProcess) {
			return
		}

		Logger.info("Terminating recording process...")

		// On Windows, we need to handle FFmpeg differently
		// FFmpeg responds to 'q' on stdin to quit gracefully
		if (process.platform === "win32" && this.recordingProcess.stdin) {
			try {
				this.recordingProcess.stdin.write("q")
				this.recordingProcess.stdin.end()
				Logger.info("Sent 'q' to FFmpeg stdin for graceful shutdown")
			} catch (e) {
				Logger.warn("Failed to write to stdin, falling back to kill: " + (e instanceof Error ? e.message : String(e)))
				this.recordingProcess.kill()
			}
		} else {
			// Unix-like systems can use SIGINT
			this.recordingProcess.kill("SIGINT")
		}

		// Wait for the process to finish with timeout
		await new Promise<void>((resolve) => {
			const timeoutId = setTimeout(() => {
				Logger.warn("Process termination timed out after 5 seconds, forcing kill...")
				try {
					this.recordingProcess?.kill("SIGKILL")
				} catch (_e) {
					// Ignore - process may already be dead
				}
				resolve()
			}, 5000)

			this.recordingProcess?.on("exit", (code) => {
				clearTimeout(timeoutId)
				Logger.info(`Recording process exited with code: ${code}`)
				resolve()
			})
		})
	}

	/**
	 * Performs comprehensive cleanup of recording resources
	 * @param options - Cleanup options
	 * @param options.keepFile - If true, preserves the temporary file
	 */
	private async performCleanup(options?: { keepFile?: boolean }): Promise<void> {
		await this.terminateProcess()
		this.resetRecordingState()

		if (!options?.keepFile) {
			await this.cleanupTempFile()
		}
	}

	async startRecording(): Promise<{ success: boolean; error?: string }> {
		try {
			// Defensive cleanup before starting - ensures clean state
			if (this.recordingProcess || this.outputFile) {
				Logger.info("Performing pre-recording cleanup of stale resources...")
				await this.performCleanup()
			}

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

			// Set up recording arguments - for Windows, detect device dynamically
			let args = recordProgram.getArgs(this.outputFile)

			// On Windows, detect the actual audio device
			if (os.platform() === "win32") {
				const detectedDevice = detectWindowsAudioDevice(recordProgram.path)
				if (detectedDevice) {
					// Replace the placeholder device with the detected one
					args = args.map((arg) => {
						if (arg.startsWith("audio=")) {
							return `audio=${detectedDevice}`
						}
						return arg
					})
					Logger.info(`Using detected Windows audio device: ${detectedDevice}`)
				} else {
					Logger.warn("Could not detect Windows audio device, using default from config")
				}
			}

			Logger.info(`FFmpeg args: ${args.join(" ")}`)
			Logger.info(`Output file will be: ${this.outputFile}`)

			// Spawn the recording process
			this.recordingProcess = spawn(recordProgram.path, args)
			this.startTime = Date.now()
			this._isRecordingActive = true
			Logger.info(`Recording process spawned with PID: ${this.recordingProcess.pid}`)

			// Handle process errors
			this.recordingProcess.on("error", (error) => {
				Logger.error(`Recording process error: ${error.message}`)
				this.resetRecordingState()
			})

			// Handle process exit - DON'T reset recording state here, let stopRecording handle it
			this.recordingProcess.on("exit", (code) => {
				Logger.info(`Recording process exited with code: ${code}`)
				if (code !== 0 && code !== null) {
					Logger.warn(`Recording process exited with non-zero code: ${code}`)
				}
			})

			this.recordingProcess.stderr?.on("data", (data) => {
				const message = data.toString().trim()
				// Log ALL stderr output for debugging
				Logger.info(`FFmpeg stderr: ${message}`)
			})

			this.recordingProcess.stdout?.on("data", (data) => {
				Logger.info(`FFmpeg stdout: ${data.toString().trim()}`)
			})

			Logger.info("Audio recording started successfully")
			return { success: true }
		} catch (error) {
			await this.performCleanup()
			const errorMessage = error instanceof Error ? error.message : String(error)
			Logger.error("Failed to start audio recording: " + errorMessage)
			return { success: false, error: `Failed to start recording: ${errorMessage}` }
		}
	}

	async stopRecording(): Promise<{ success: boolean; audioBase64?: string; error?: string }> {
		try {
			Logger.info(`stopRecording called. isRecording=${this.isRecording}, outputFile=${this.outputFile}`)

			if (!this.isRecording) {
				Logger.error("stopRecording: Not currently recording")
				return { success: false, error: "Not currently recording" }
			}

			Logger.info("Stopping audio recording...")

			// Terminate the process but keep the file for reading
			const outputFilePath = this.outputFile // Save before reset
			await this.terminateProcess()
			this.resetRecordingState()

			// Wait a moment for file to be fully written
			Logger.info(`Waiting for file to be written: ${outputFilePath}`)
			await new Promise((resolve) => setTimeout(resolve, 1000))

			// Read the audio file and convert to base64
			Logger.info(`Checking if file exists: ${outputFilePath}`)
			if (!fs.existsSync(outputFilePath)) {
				Logger.error(`Recording file not found: ${outputFilePath}`)
				return { success: false, error: `Recording file not found: ${outputFilePath}` }
			}

			const stats = fs.statSync(outputFilePath)
			Logger.info(`Recording file size: ${stats.size} bytes`)

			if (stats.size === 0) {
				Logger.error("Recording file is empty (0 bytes)")
				return { success: false, error: "Recording file is empty - no audio was captured" }
			}

			const audioBuffer = fs.readFileSync(outputFilePath)
			const audioBase64 = audioBuffer.toString("base64")
			Logger.info(`Audio file read: ${audioBuffer.length} bytes, base64 length: ${audioBase64.length}`)

			// Clean up temporary file after reading
			this.outputFile = outputFilePath // Restore for cleanup
			await this.cleanupTempFile()

			Logger.info("Audio recording stopped and converted to base64")
			return { success: true, audioBase64 }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			Logger.error("Failed to stop audio recording: " + errorMessage)

			// Ensure cleanup happens even on error
			await this.performCleanup()

			return { success: false, error: `Failed to stop recording: ${errorMessage}` }
		}
	}

	async cancelRecording(): Promise<{ success: boolean; error?: string }> {
		try {
			if (!this.isRecording) {
				return { success: false, error: "Not currently recording" }
			}

			Logger.info("Canceling audio recording...")

			// Perform full cleanup including file deletion
			await this.performCleanup()

			Logger.info("Audio recording canceled successfully")
			return { success: true }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			Logger.error("Failed to cancel audio recording: " + errorMessage)

			// Ensure cleanup happens even on error
			await this.performCleanup()

			return { success: false, error: `Failed to cancel recording: ${errorMessage}` }
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

	/**
	 * Public cleanup method for service shutdown
	 */
	cleanup(): void {
		// Use async cleanup but don't await since this is often called in sync contexts
		this.performCleanup().catch((error) => {
			Logger.error("Error during cleanup: " + (error instanceof Error ? error.message : String(error)))
		})
	}
}

export const audioRecordingService = new AudioRecordingService()
