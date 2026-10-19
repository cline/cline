import { Ollama } from "ollama"
import { fetch } from "@/shared/net"
import { OllamaPullProgress } from "@/shared/proto/cline/models"

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
const PROGRESS_THROTTLE_MS = 250

type PullListener = (progress: OllamaPullProgress) => void

interface ActivePull {
	progress: OllamaPullProgress
	listeners: Set<PullListener>
	abort: () => void
	done: Promise<void>
}

// Downloads outlive the settings page that started them (an 18 GB pull takes a
// while), so they are tracked here and any reopened page can re-subscribe.
const activePulls = new Map<string, ActivePull>()

export function createOllamaClient(baseUrl: string | undefined): Ollama {
	const host = baseUrl?.trim().replace(/\/+$/, "") || DEFAULT_OLLAMA_BASE_URL
	return new Ollama({ host, fetch })
}

export function getActiveOllamaPulls(): OllamaPullProgress[] {
	return [...activePulls.values()].map((pull) => pull.progress)
}

export function getOrStartOllamaPull(baseUrl: string | undefined, model: string): ActivePull {
	const existing = activePulls.get(model)
	if (existing) {
		return existing
	}

	const client = createOllamaClient(baseUrl)
	let aborted = false
	let abortStream: (() => void) | undefined
	const pull: ActivePull = {
		progress: OllamaPullProgress.create({ model, status: "starting" }),
		listeners: new Set(),
		abort: () => {
			aborted = true
			abortStream?.()
		},
		done: Promise.resolve(),
	}

	pull.done = (async () => {
		try {
			const stream = await client.pull({ model, stream: true })
			abortStream = () => stream.abort()
			if (aborted) {
				stream.abort()
			}
			let lastNotifiedAt = 0
			for await (const part of stream) {
				const statusChanged = part.status !== pull.progress.status
				pull.progress = OllamaPullProgress.create({
					model,
					status: part.status,
					// Layer-less status lines ("pulling manifest") carry no byte counts; keep the last ones.
					completed: part.completed ?? (statusChanged ? 0 : pull.progress.completed),
					total: part.total ?? (statusChanged ? 0 : pull.progress.total),
				})
				const now = Date.now()
				if (statusChanged || now - lastNotifiedAt >= PROGRESS_THROTTLE_MS) {
					lastNotifiedAt = now
					for (const listener of pull.listeners) {
						listener(pull.progress)
					}
				}
			}
		} catch (error) {
			if (aborted) {
				throw new Error("Download cancelled")
			}
			throw error
		} finally {
			activePulls.delete(model)
		}
	})()
	// Rejections are surfaced to subscribers; avoid an unhandled rejection when nobody is listening.
	pull.done.catch(() => {})

	activePulls.set(model, pull)
	return pull
}

export function cancelOllamaPull(model: string): void {
	activePulls.get(model)?.abort()
}
