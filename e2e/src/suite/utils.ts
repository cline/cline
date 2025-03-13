import * as vscode from "vscode"

import { RooCodeAPI } from "../../../src/exports/roo-code"

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

type WaitForToolUseOptions = WaitUntilReadyOptions & {
	taskId: string
	toolName: string
}

export const waitForToolUse = async ({ api, taskId, toolName, ...options }: WaitForToolUseOptions) =>
	waitFor(
		() =>
			api
				.getMessages(taskId)
				.some(({ type, say, text }) => type === "say" && say === "tool" && text && text.includes(toolName)),
		options,
	)

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
