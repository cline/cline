import { EventEmitter } from "events"
import * as vscode from "vscode"

import { ClineProvider } from "../core/webview/ClineProvider"
import { openClineInNewTab } from "../activate/registerCommands"

import { RooCodeSettings, RooCodeEvents, RooCodeEventName, ClineMessage } from "../schemas"
import { IpcOrigin, IpcMessageType, TaskCommandName, TaskEvent } from "../schemas/ipc"
import { RooCodeAPI } from "./interface"
import { IpcServer } from "./ipc"
import { outputChannelLog } from "./log"

export class API extends EventEmitter<RooCodeEvents> implements RooCodeAPI {
	private readonly outputChannel: vscode.OutputChannel
	private readonly sidebarProvider: ClineProvider
	private tabProvider?: ClineProvider
	private readonly context: vscode.ExtensionContext
	private readonly ipc?: IpcServer
	private readonly taskMap = new Map<string, ClineProvider>()
	private readonly log: (...args: unknown[]) => void

	constructor(
		outputChannel: vscode.OutputChannel,
		provider: ClineProvider,
		socketPath?: string,
		enableLogging = false,
	) {
		super()

		this.outputChannel = outputChannel
		this.sidebarProvider = provider
		this.context = provider.context

		this.log = enableLogging
			? (...args: unknown[]) => {
					outputChannelLog(this.outputChannel, ...args)
					console.log(args)
				}
			: () => {}

		this.registerListeners(this.sidebarProvider)

		if (socketPath) {
			const ipc = (this.ipc = new IpcServer(socketPath, this.log))

			ipc.listen()
			this.log(`[API] ipc server started: socketPath=${socketPath}, pid=${process.pid}, ppid=${process.ppid}`)

			ipc.on(IpcMessageType.TaskCommand, async (_clientId, { commandName, data }) => {
				switch (commandName) {
					case TaskCommandName.StartNewTask:
						this.log(`[API] StartNewTask -> ${data.text}, ${JSON.stringify(data.configuration)}`)
						await this.startNewTask(data)
						break
					case TaskCommandName.CancelTask:
						this.log(`[API] CancelTask -> ${data}`)
						await this.cancelTask(data)
						break
					case TaskCommandName.CloseTask:
						this.log(`[API] CloseTask -> ${data}`)
						await vscode.commands.executeCommand("workbench.action.files.saveFiles")
						await vscode.commands.executeCommand("workbench.action.closeWindow")
						break
				}
			})
		}
	}

	public override emit<K extends keyof RooCodeEvents>(
		eventName: K,
		...args: K extends keyof RooCodeEvents ? RooCodeEvents[K] : never
	) {
		const data = { eventName: eventName as RooCodeEventName, payload: args } as TaskEvent
		this.ipc?.broadcast({ type: IpcMessageType.TaskEvent, origin: IpcOrigin.Server, data })
		return super.emit(eventName, ...args)
	}

	public async startNewTask({
		configuration,
		text,
		images,
		newTab,
	}: {
		configuration: RooCodeSettings
		text?: string
		images?: string[]
		newTab?: boolean
	}) {
		let provider: ClineProvider

		if (newTab) {
			await vscode.commands.executeCommand("workbench.action.closeAllEditors")

			if (!this.tabProvider) {
				this.tabProvider = await openClineInNewTab({ context: this.context, outputChannel: this.outputChannel })
				this.registerListeners(this.tabProvider)
			}

			provider = this.tabProvider
		} else {
			provider = this.sidebarProvider
		}

		if (configuration) {
			await provider.setValues(configuration)

			if (configuration.allowedCommands) {
				await vscode.workspace
					.getConfiguration("roo-cline")
					.update("allowedCommands", configuration.allowedCommands, vscode.ConfigurationTarget.Global)
			}
		}

		await provider.removeClineFromStack()
		await provider.postStateToWebview()
		await provider.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		await provider.postMessageToWebview({ type: "invoke", invoke: "newChat", text, images })

		const { taskId } = await provider.initClineWithTask(text, images)
		return taskId
	}

	public getCurrentTaskStack() {
		return this.sidebarProvider.getCurrentTaskStack()
	}

	public async clearCurrentTask(lastMessage?: string) {
		await this.sidebarProvider.finishSubTask(lastMessage)
		await this.sidebarProvider.postStateToWebview()
	}

	public async cancelCurrentTask() {
		await this.sidebarProvider.cancelTask()
	}

	public async cancelTask(taskId: string) {
		const provider = this.taskMap.get(taskId)

		if (provider) {
			await provider.cancelTask()
			this.taskMap.delete(taskId)
		}
	}

	public async sendMessage(text?: string, images?: string[]) {
		await this.sidebarProvider.postMessageToWebview({ type: "invoke", invoke: "sendMessage", text, images })
	}

	public async pressPrimaryButton() {
		await this.sidebarProvider.postMessageToWebview({ type: "invoke", invoke: "primaryButtonClick" })
	}

	public async pressSecondaryButton() {
		await this.sidebarProvider.postMessageToWebview({ type: "invoke", invoke: "secondaryButtonClick" })
	}

	public getConfiguration() {
		return this.sidebarProvider.getValues()
	}

	public async setConfiguration(values: RooCodeSettings) {
		await this.sidebarProvider.setValues(values)
		await this.sidebarProvider.postStateToWebview()
	}

	public async createProfile(name: string): Promise<string> {
		// Input validation
		if (!name || !name.trim()) {
			throw new Error("Profile name cannot be empty")
		}

		const currentSettings = this.getConfiguration()
		const profiles = currentSettings.listApiConfigMeta || []

		if (profiles.some((profile) => profile.name === name)) {
			throw new Error(`A profile with the name "${name}" already exists`)
		}

		// Generate unique ID and create profile
		const id = this.sidebarProvider.providerSettingsManager.generateId()
		const newProfile = {
			id,
			name: name.trim(),
			apiProvider: "openai" as const, // Type assertion for better type safety
		}

		// Update configuration with new profile
		await this.setConfiguration({
			...currentSettings,
			listApiConfigMeta: [...profiles, newProfile],
		})
		return id
	}

	public getProfiles(): string[] {
		const profiles = this.getConfiguration().listApiConfigMeta || []
		return profiles.map((profile) => profile.name)
	}

	public async setActiveProfile(name: string): Promise<void> {
		const currentSettings = this.getConfiguration()
		const profiles = currentSettings.listApiConfigMeta || []

		const profile = profiles.find((p) => p.name === name)
		if (!profile) {
			throw new Error(`Profile with name "${name}" does not exist`)
		}

		await this.setConfiguration({
			...currentSettings,
			currentApiConfigName: profile.name,
		})
	}

	public getActiveProfile(): string | undefined {
		return this.getConfiguration().currentApiConfigName
	}

	public async deleteProfile(name: string): Promise<void> {
		const currentSettings = this.getConfiguration()
		const profiles = currentSettings.listApiConfigMeta || []
		const targetIndex = profiles.findIndex((p) => p.name === name)
		if (targetIndex === -1) {
			throw new Error(`Profile with name "${name}" does not exist`)
		}

		const profileToDelete = profiles[targetIndex]
		profiles.splice(targetIndex, 1)

		// If we're deleting the active profile, clear the currentApiConfigName
		const newSettings: RooCodeSettings = {
			...currentSettings,
			listApiConfigMeta: profiles,
			currentApiConfigName:
				currentSettings.currentApiConfigName === profileToDelete.name
					? undefined
					: currentSettings.currentApiConfigName,
		}
		await this.setConfiguration(newSettings)
	}

	public isReady() {
		return this.sidebarProvider.viewLaunched
	}

	private registerListeners(provider: ClineProvider) {
		provider.on("clineCreated", (cline) => {
			cline.on("taskStarted", () => {
				this.emit(RooCodeEventName.TaskStarted, cline.taskId)
				this.taskMap.set(cline.taskId, provider)
			})

			cline.on("message", (message) => this.emit(RooCodeEventName.Message, { taskId: cline.taskId, ...message }))

			cline.on("taskModeSwitched", (taskId, mode) => this.emit(RooCodeEventName.TaskModeSwitched, taskId, mode))

			cline.on("taskTokenUsageUpdated", (_, usage) =>
				this.emit(RooCodeEventName.TaskTokenUsageUpdated, cline.taskId, usage),
			)

			cline.on("taskAskResponded", () => this.emit(RooCodeEventName.TaskAskResponded, cline.taskId))

			cline.on("taskAborted", () => {
				this.emit(RooCodeEventName.TaskAborted, cline.taskId)
				this.taskMap.delete(cline.taskId)
			})

			cline.on("taskCompleted", (_, usage) => {
				this.emit(RooCodeEventName.TaskCompleted, cline.taskId, usage)
				this.taskMap.delete(cline.taskId)
			})

			cline.on("taskSpawned", (childTaskId) => this.emit(RooCodeEventName.TaskSpawned, cline.taskId, childTaskId))
			cline.on("taskPaused", () => this.emit(RooCodeEventName.TaskPaused, cline.taskId))
			cline.on("taskUnpaused", () => this.emit(RooCodeEventName.TaskUnpaused, cline.taskId))

			this.emit(RooCodeEventName.TaskCreated, cline.taskId)
		})
	}
}
