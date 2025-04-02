import * as vscode from "vscode"

import type { RooCodeAPI } from "../../../src/exports/roo-code"

type WaitForOptions = {
	timeout?: number
	interval?: number
}

export const waitFor = (
	condition: (() => Promise<boolean>) | (() => boolean),
	{ timeout = 30_000, interval = 250 }: WaitForOptions = {},
) => {
	let timeoutId: NodeJS.Timeout | undefined = undefined

	return Promise.race([
		new Promise<void>((resolve) => {
			const check = async () => {
				const result = condition()
				const isSatisfied = result instanceof Promise ? await result : result

				if (isSatisfied) {
					if (timeoutId) {
						clearTimeout(timeoutId)
						timeoutId = undefined
					}

					resolve()
				} else {
					setTimeout(check, interval)
				}
			}

			check()
		}),
		new Promise((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error(`Timeout after ${Math.floor(timeout / 1000)}s`))
			}, timeout)
		}),
	])
}

type WaitUntilAbortedOptions = WaitForOptions & {
	api: RooCodeAPI
	taskId: string
}

export const waitUntilAborted = async ({ api, taskId, ...options }: WaitUntilAbortedOptions) => {
	const set = new Set<string>()
	api.on("taskAborted", (taskId) => set.add(taskId))
	await waitFor(() => set.has(taskId), options)
}

type WaitUntilCompletedOptions = WaitForOptions & {
	api: RooCodeAPI
	taskId: string
}

export const waitUntilCompleted = async ({ api, taskId, ...options }: WaitUntilCompletedOptions) => {
	const set = new Set<string>()
	api.on("taskCompleted", (taskId) => set.add(taskId))
	await waitFor(() => set.has(taskId), options)
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
