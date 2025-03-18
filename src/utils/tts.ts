import * as vscode from "vscode"

let isTtsEnabled = false
let speed = 1.0
let isSpeaking = false
const utteranceQueue: string[] = []

/**
 * Set tts configuration
 * @param enabled boolean
 */
export const setTtsEnabled = (enabled: boolean): void => {
	isTtsEnabled = enabled
}

/**
 * Set tts speed
 * @param speed number
 */
export const setTtsSpeed = (newSpeed: number): void => {
	speed = newSpeed
}

/**
 * Process the next item in the utterance queue
 */
const processQueue = async (): Promise<void> => {
	if (!isTtsEnabled || isSpeaking || utteranceQueue.length === 0) {
		return
	}

	try {
		isSpeaking = true
		const nextUtterance = utteranceQueue.shift()!
		const say = require("say")

		// Wrap say.speak in a promise to handle completion
		await new Promise<void>((resolve, reject) => {
			say.speak(nextUtterance, null, speed, (err: Error) => {
				if (err) {
					reject(err)
				} else {
					resolve()
				}
			})
		})

		isSpeaking = false
		// Process next item in queue if any
		await processQueue()
	} catch (error: any) {
		isSpeaking = false
		//vscode.window.showErrorMessage(error.message)
		// Try to continue with next item despite error
		await processQueue()
	}
}

/**
 * Queue a tts message to be spoken
 * @param message string
 * @return void
 */
export const playTts = async (message: string): Promise<void> => {
	if (!isTtsEnabled) {
		return
	}

	try {
		utteranceQueue.push(message)
		await processQueue()
	} catch (error: any) {
		//vscode.window.showErrorMessage(error.message)
	}
}
