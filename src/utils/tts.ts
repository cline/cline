interface Say {
	speak: (text: string, voice?: string, speed?: number, callback?: (err?: string) => void) => void
	stop: () => void
}

type PlayTtsOptions = {
	onStart?: () => void
	onStop?: () => void
}

type QueueItem = {
	message: string
	options: PlayTtsOptions
}

let isTtsEnabled = false

export const setTtsEnabled = (enabled: boolean) => (isTtsEnabled = enabled)

let speed = 1.0

export const setTtsSpeed = (newSpeed: number) => (speed = newSpeed)

let sayInstance: Say | undefined = undefined
let queue: QueueItem[] = []

export const playTts = async (message: string, options: PlayTtsOptions = {}) => {
	if (!isTtsEnabled) {
		return
	}

	try {
		queue.push({ message, options })
		await processQueue()
	} catch (error) {}
}

export const stopTts = () => {
	sayInstance?.stop()
	sayInstance = undefined
	queue = []
}

const processQueue = async (): Promise<void> => {
	if (!isTtsEnabled || sayInstance) {
		return
	}

	const item = queue.shift()

	if (!item) {
		return
	}

	try {
		const { message: nextUtterance, options } = item

		await new Promise<void>((resolve, reject) => {
			const say: Say = require("say")
			sayInstance = say
			options.onStart?.()

			say.speak(nextUtterance, undefined, speed, (err) => {
				options.onStop?.()

				if (err) {
					reject(new Error(err))
				} else {
					resolve()
				}

				sayInstance = undefined
			})
		})

		await processQueue()
	} catch (error: any) {
		sayInstance = undefined
		await processQueue()
	}
}
