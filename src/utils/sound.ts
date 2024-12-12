import * as vscode from "vscode"
import * as path from "path"

/**
 * Minimum interval between sound plays (milliseconds)
 */
const MIN_PLAY_INTERVAL = 500

/**
 * Last time a sound was played
 */
let lastPlayedTime = 0

/**
 * Check if file is WAV format
 * @param filepath string
 * @returns boolean
 */
export const isWAV = (filepath: string): boolean => {
    return path.extname(filepath).toLowerCase() === ".wav"
}

let isSoundEnabled = true

/**
 * Set sound enabled state
 * @param enabled boolean
 */
export const setSoundEnabled = (enabled: boolean): void => {
    isSoundEnabled = enabled
}

/**
 * Play a sound file
 * @param filepath string
 * @return void
 */
export const playSound = (filepath: string): void => {
    try {
        if (!isSoundEnabled) {
            return
        }

        if (!filepath) {
            return
        }

        if (!isWAV(filepath)) {
            throw new Error("Only wav files are supported.")
        }

        const currentTime = Date.now()
        if (currentTime - lastPlayedTime < MIN_PLAY_INTERVAL) {
            return // Skip if within minimum interval
        }

        const player = require("play-sound")()
        player.play(filepath, function (err: any) {
            if (err) {
                throw new Error("Failed to play sound effect")
            }
        })

        lastPlayedTime = currentTime
    } catch (error: any) {
        vscode.window.showErrorMessage(error.message)
    }
}
