import * as vscode from "vscode"
import * as path from "path"

/**
 * 連続再生を防ぐための最小インターバル（ミリ秒）
 */
const MIN_PLAY_INTERVAL = 500

/**
 * 最後に音声を再生した時刻
 */
let lastPlayedTime = 0

/**
 * WAVファイルかどうかを判定する
 * @param filepath string
 * @returns boolean
 */
export const isWAV = (filepath: string): boolean => {
	return path.extname(filepath).toLowerCase() === ".wav"
}

let isSoundEnabled = true

/**
 * 音声設定を設定する
 * @param enabled boolean
 */
export const setSoundEnabled = (enabled: boolean): void => {
	isSoundEnabled = enabled
}

/**
 * 音声を再生する
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
			return // 連続再生を防ぐため、最小インターバル内の再生をスキップ
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
