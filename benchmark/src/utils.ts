import * as vscode from "vscode"

import { RooCodeAPI, TokenUsage } from "../../src/exports/roo-code"

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

type WaitUntilReadyOptions = WaitForOptions & {
	api: RooCodeAPI
}

export const waitUntilReady = async ({ api, ...options }: WaitUntilReadyOptions) => {
	await vscode.commands.executeCommand("roo-cline.SidebarProvider.focus")
	await waitFor(() => api.isReady(), options)
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
	const map = new Map<string, TokenUsage>()
	api.on("taskCompleted", (taskId, usage) => map.set(taskId, usage))
	await waitFor(() => map.has(taskId), options)
	return map.get(taskId)
}

export const waitForCompletion = async ({
	api,
	taskId,
	...options
}: WaitUntilReadyOptions & {
	taskId: string
}) => waitFor(() => !!getCompletion({ api, taskId }), options)

export const getCompletion = ({ api, taskId }: { api: RooCodeAPI; taskId: string }) =>
	api.getMessages(taskId).find(({ say, partial }) => say === "completion_result" && partial === false)

type WaitForMessageOptions = WaitUntilReadyOptions & {
	taskId: string
	include: string
	exclude?: string
}

export const waitForMessage = async ({ api, taskId, include, exclude, ...options }: WaitForMessageOptions) =>
	waitFor(() => !!getMessage({ api, taskId, include, exclude }), options)

type GetMessageOptions = {
	api: RooCodeAPI
	taskId: string
	include: string
	exclude?: string
}

export const getMessage = ({ api, taskId, include, exclude }: GetMessageOptions) =>
	api
		.getMessages(taskId)
		.find(
			({ type, text }) =>
				type === "say" && text && text.includes(include) && (!exclude || !text.includes(exclude)),
		)

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
