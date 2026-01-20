/**
 * CLI Webview Adapter
 *
 * This module bridges the Controller's state updates with terminal output.
 * It coordinates between state subscriptions and message renderers to format
 * ClineMessages for display in the terminal.
 *
 * Architecture:
 * - StateSubscriber: Handles gRPC subscriptions and message tracking
 * - SayMessageRenderer: Renders "say" type messages
 * - AskMessageRenderer: Renders "ask" type messages
 * - ToolRenderer: Renders tool operations and approvals
 * - BrowserActionRenderer: Renders browser actions
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Controller } from "@/core/controller"
import {
	AskMessageRenderer,
	BrowserActionRenderer,
	type RenderContext,
	SayMessageRenderer,
	ToolRenderer,
} from "./message-rendering/index.js"
import type { OutputFormatter } from "./output/types.js"
import { type ActivitySpinner, createActivitySpinner } from "./spinner.js"
import { type StateChangeHandler, StateSubscriber } from "./state-subscription/index.js"

// Re-export for consumers
export type { StateChangeHandler } from "./state-subscription/index.js"

/**
 * CLI Webview Adapter class
 *
 * Subscribes to Controller state updates and outputs messages to the terminal.
 * Acts as a coordinator between state subscriptions and message rendering.
 */
export class CliWebviewAdapter {
	private stateSubscriber: StateSubscriber
	private sayRenderer: SayMessageRenderer
	private askRenderer: AskMessageRenderer
	private _currentOptions: string[] = []
	private activitySpinner: ActivitySpinner
	private isProcessing = false
	private onStateChange?: StateChangeHandler

	constructor(
		private controller: Controller,
		private formatter: OutputFormatter,
	) {
		// Create activity spinner that shows after 1 second of inactivity
		this.activitySpinner = createActivitySpinner({
			message: "Working hard...",
			delayMs: 1000,
		})

		// Create render context for all renderers
		const renderContext: RenderContext = {
			formatter: this.formatter,
			getMessages: () => this.getMessages(),
			setCurrentOptions: (options: string[]) => {
				this._currentOptions = options
			},
		}

		// Create renderers
		const toolRenderer = new ToolRenderer(renderContext)
		const browserRenderer = new BrowserActionRenderer(renderContext)
		this.sayRenderer = new SayMessageRenderer(renderContext, toolRenderer, browserRenderer)
		this.askRenderer = new AskMessageRenderer(renderContext, toolRenderer)

		// Create state subscriber
		this.stateSubscriber = new StateSubscriber(this.controller, {
			onStateChange: (messages) => this.onStateChange?.(messages),
			onCompleteMessage: (msg) => this.outputMessage(msg),
			getMessages: () => this.getMessages(),
			onActivity: () => {
				if (this.isProcessing) {
					this.activitySpinner.reportActivity()
				}
			},
		})
	}

	/**
	 * Get the current options for numbered selection
	 */
	get currentOptions(): string[] {
		return this._currentOptions
	}

	/**
	 * Set whether the AI is currently processing
	 *
	 * When processing is true, the spinner will start monitoring for inactivity.
	 * When processing is false (e.g., waiting for user input), the spinner is disabled.
	 */
	setProcessing(processing: boolean): void {
		this.isProcessing = processing
		this.activitySpinner.setEnabled(processing)

		if (processing) {
			// Start monitoring for inactivity
			this.activitySpinner.startMonitoring("Processing...")
		} else {
			// Stop spinner when not processing
			this.activitySpinner.stop()
		}
	}

	/**
	 * Start listening for state updates
	 *
	 * @param onStateChange - Optional callback for raw state changes
	 */
	startListening(onStateChange?: StateChangeHandler): void {
		this.onStateChange = onStateChange
		this.stateSubscriber.start()
	}

	/**
	 * Stop listening for state updates
	 */
	stopListening(): void {
		this.stateSubscriber.stop()
		this.activitySpinner.stop()
	}

	/**
	 * Output a ClineMessage to the terminal
	 */
	outputMessage(msg: ClineMessage): void {
		if (msg.type === "say") {
			this.sayRenderer.render(msg)
		} else if (msg.type === "ask") {
			this.askRenderer.render(msg)
		}
	}

	/**
	 * Get the current messages from the Controller
	 */
	getMessages(): ClineMessage[] {
		return this.controller.task?.messageStateHandler.getClineMessages() || []
	}

	/**
	 * Reset the message counter (useful when starting a new task)
	 */
	resetMessageCounter(): void {
		this.stateSubscriber.reset()
	}

	/**
	 * Output all current messages (useful for initial display)
	 */
	outputAllMessages(): void {
		const messages = this.getMessages()
		for (const msg of messages) {
			if (!msg.partial && !this.stateSubscriber.hasBeenPrinted(msg.ts)) {
				this.outputMessage(msg)
				this.stateSubscriber.markPrinted(msg.ts)
			}
		}
	}
}
