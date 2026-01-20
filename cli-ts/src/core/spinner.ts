/**
 * Animated loading spinner for CLI output
 *
 * Displays a rotating spinner animation when no output has been
 * received for a configurable delay period. Uses ANSI escape codes
 * to update in-place without scrolling the terminal.
 */

import chalk from "chalk"

/**
 * Spinner animation frames (Braille pattern)
 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/**
 * Default configuration values
 */
const DEFAULT_INTERVAL_MS = 80 // Animation speed
const DEFAULT_DELAY_MS = 1000 // Delay before showing spinner

/**
 * Spinner configuration options
 */
export interface SpinnerOptions {
	/** Message to display alongside spinner */
	message?: string
	/** Animation frame interval in milliseconds (default: 80) */
	intervalMs?: number
	/** Delay before showing spinner in milliseconds (default: 2000) */
	delayMs?: number
	/** Stream to write to (default: process.stdout) */
	stream?: NodeJS.WriteStream
}

/**
 * Animated spinner class
 *
 * Manages the spinner animation lifecycle including delayed start,
 * frame animation, and clean stop with line clearing.
 */
export class Spinner {
	private message: string
	private intervalMs: number
	private delayMs: number
	private stream: NodeJS.WriteStream

	private frameIndex = 0
	private animationTimer: NodeJS.Timeout | null = null
	private delayTimer: NodeJS.Timeout | null = null
	private isSpinning = false
	private isVisible = false

	constructor(options: SpinnerOptions = {}) {
		this.message = options.message || "Thinking..."
		this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS
		this.delayMs = options.delayMs || DEFAULT_DELAY_MS
		this.stream = options.stream || process.stdout
	}

	/**
	 * Check if the output stream is a TTY (supports animations)
	 */
	private isTTY(): boolean {
		return this.stream.isTTY === true
	}

	/**
	 * Write text to the stream
	 */
	private write(text: string): void {
		this.stream.write(text)
	}

	/**
	 * Clear the current line and move cursor to start
	 */
	private clearLine(): void {
		if (this.isTTY()) {
			// \r = carriage return (move to start of line)
			// \x1B[K = clear from cursor to end of line
			this.write("\r\x1B[K")
		}
	}

	/**
	 * Render the current spinner frame
	 */
	private render(): void {
		if (!this.isTTY()) {
			return
		}

		const frame = SPINNER_FRAMES[this.frameIndex]
		const text = chalk.cyan(frame) + " " + chalk.dim(this.message)

		this.clearLine()
		this.write(text)
		this.isVisible = true

		// Advance to next frame
		this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length
	}

	/**
	 * Start the spinner animation after the configured delay
	 *
	 * The spinner will not appear immediately - it waits for the delay
	 * period first. This prevents flickering for quick operations.
	 */
	start(message?: string): void {
		// Don't start if already spinning or not a TTY
		if (this.isSpinning || !this.isTTY()) {
			return
		}

		if (message !== undefined) {
			this.message = message
		}

		this.isSpinning = true
		this.frameIndex = 0

		// Start delay timer - spinner becomes visible after delay
		this.delayTimer = setTimeout(() => {
			this.delayTimer = null

			// Start animation timer
			this.animationTimer = setInterval(() => {
				this.render()
			}, this.intervalMs)

			// Render first frame immediately
			this.render()
		}, this.delayMs)
	}

	/**
	 * Start the spinner immediately without delay
	 *
	 * Use this when you know the operation will take a while
	 * and want immediate feedback.
	 */
	startImmediate(message?: string): void {
		if (this.isSpinning || !this.isTTY()) {
			return
		}

		if (message !== undefined) {
			this.message = message
		}

		this.isSpinning = true
		this.frameIndex = 0

		// Start animation timer immediately
		this.animationTimer = setInterval(() => {
			this.render()
		}, this.intervalMs)

		// Render first frame immediately
		this.render()
	}

	/**
	 * Stop the spinner and clear the line
	 *
	 * Cleans up all timers and removes the spinner from display.
	 */
	stop(): void {
		if (!this.isSpinning) {
			return
		}

		// Clear delay timer if still waiting
		if (this.delayTimer) {
			clearTimeout(this.delayTimer)
			this.delayTimer = null
		}

		// Clear animation timer
		if (this.animationTimer) {
			clearInterval(this.animationTimer)
			this.animationTimer = null
		}

		// Clear the line if we rendered anything
		if (this.isVisible) {
			this.clearLine()
			this.isVisible = false
		}

		this.isSpinning = false
	}

	/**
	 * Check if the spinner is currently active (spinning or waiting to spin)
	 */
	get active(): boolean {
		return this.isSpinning
	}

	/**
	 * Check if the spinner is currently visible on screen
	 */
	get visible(): boolean {
		return this.isVisible
	}

	/**
	 * Update the spinner message while it's running
	 */
	setMessage(message: string): void {
		this.message = message
	}

	/**
	 * Reset the delay timer
	 *
	 * Call this when activity is detected but you want to restart
	 * the delay countdown. The spinner will stop if visible and
	 * restart the delay timer.
	 */
	reset(): void {
		if (!this.isSpinning) {
			return
		}

		// Stop current animation
		this.stop()

		// Start again (will wait for delay)
		this.start()
	}
}

/**
 * Create a new spinner instance
 */
export function createSpinner(options?: SpinnerOptions): Spinner {
	return new Spinner(options)
}

/**
 * ActivitySpinner - automatically manages spinner based on activity
 *
 * This is a higher-level wrapper that:
 * - Starts spinner after inactivity timeout
 * - Automatically stops when activity is reported
 * - Restarts the timer after each activity
 */
export class ActivitySpinner {
	private spinner: Spinner
	private inactivityTimer: NodeJS.Timeout | null = null
	private delayMs: number
	private enabled = true

	constructor(options: SpinnerOptions = {}) {
		this.delayMs = options.delayMs || DEFAULT_DELAY_MS
		// Create spinner with no delay - we handle delay ourselves
		this.spinner = new Spinner({ ...options, delayMs: 0 })
	}

	/**
	 * Enable or disable the spinner
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled
		if (!enabled) {
			this.stop()
		}
	}

	/**
	 * Report activity - resets the inactivity timer
	 *
	 * Call this whenever output is received or activity is detected.
	 * The spinner will be stopped if visible and the timer will be reset.
	 */
	reportActivity(): void {
		// Stop spinner if it's showing
		if (this.spinner.active) {
			this.spinner.stop()
		}

		// Clear existing timer
		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer)
			this.inactivityTimer = null
		}

		// Start new inactivity timer if enabled
		if (this.enabled) {
			this.inactivityTimer = setTimeout(() => {
				this.inactivityTimer = null
				this.spinner.startImmediate()
			}, this.delayMs)
		}
	}

	/**
	 * Start monitoring for inactivity
	 *
	 * Begins the inactivity timer. If no activity is reported
	 * within the delay period, the spinner will appear.
	 */
	startMonitoring(message?: string): void {
		if (message !== undefined) {
			this.spinner.setMessage(message)
		}

		this.reportActivity() // Start the timer
	}

	/**
	 * Stop monitoring and hide spinner
	 */
	stop(): void {
		if (this.inactivityTimer) {
			clearTimeout(this.inactivityTimer)
			this.inactivityTimer = null
		}

		if (this.spinner.active) {
			this.spinner.stop()
		}
	}

	/**
	 * Update the spinner message
	 */
	setMessage(message: string): void {
		this.spinner.setMessage(message)
	}

	/**
	 * Check if spinner is currently visible
	 */
	get visible(): boolean {
		return this.spinner.visible
	}

	/**
	 * Check if monitoring is active
	 */
	get monitoring(): boolean {
		return this.inactivityTimer !== null || this.spinner.active
	}
}

/**
 * Create a new activity spinner instance
 */
export function createActivitySpinner(options?: SpinnerOptions): ActivitySpinner {
	return new ActivitySpinner(options)
}
