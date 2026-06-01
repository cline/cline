import { PLATFORM_CONFIG } from "../../config/platform.config"
import {
	buildAnnotationAgentPrompt,
	buildAskAboutMapAgentPrompt,
	buildBatchAnnotationsAgentPrompt,
	buildDelineateAgentPrompt,
	type MapAgentInspectContext,
	type MapAnnotationContext,
	type MapBatchAnnotationsContext,
} from "./mapAgentPrompts"

export type { MapAgentInspectContext, MapAnnotationContext, MapBatchAnnotationsContext }

function newRequestId(): string {
	return `map-agent-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Start an agent task from the map and focus the chat sidebar (host handles initTask).
 */
export function startMapAgentTask(prompt: string): Promise<{ ok: boolean; error?: string }> {
	const requestId = newRequestId()
	return new Promise((resolve) => {
		const timeout = window.setTimeout(() => {
			window.removeEventListener("message", onMessage)
			resolve({ ok: false, error: "Timed out waiting for agent task to start" })
		}, 60_000)

		const onMessage = (event: MessageEvent) => {
			const data = event.data
			if (!data || data.type !== "aihydro-map-agent-result" || data.requestId !== requestId) {
				return
			}
			window.clearTimeout(timeout)
			window.removeEventListener("message", onMessage)
			resolve({ ok: Boolean(data.ok), error: data.error })
		}
		window.addEventListener("message", onMessage)
		PLATFORM_CONFIG.postMessage({
			type: "aihydro-map-agent-task",
			requestId,
			prompt,
		})
	})
}

export async function askAgentToDelineate(ctx: MapAgentInspectContext): Promise<{ ok: boolean; error?: string }> {
	const prompt = buildDelineateAgentPrompt(ctx)
	return startMapAgentTask(prompt)
}

export async function askAgentAboutMap(
	ctx: MapAgentInspectContext,
	userQuestion?: string,
): Promise<{ ok: boolean; error?: string }> {
	const prompt = buildAskAboutMapAgentPrompt({ ...ctx, userQuestion })
	return startMapAgentTask(prompt)
}

export async function askAgentAboutTransect(
	ctx: import("./mapAgentPrompts").MapTransectContext,
): Promise<{ ok: boolean; error?: string }> {
	const { buildTransectAgentPrompt } = await import("./mapAgentPrompts")
	const prompt = buildTransectAgentPrompt(ctx)
	return startMapAgentTask(prompt)
}

export async function askAgentAboutBatchTransects(
	ctx: import("./mapAgentPrompts").MapBatchTransectsContext,
): Promise<{ ok: boolean; error?: string }> {
	const { buildBatchTransectsAgentPrompt } = await import("./mapAgentPrompts")
	const prompt = buildBatchTransectsAgentPrompt(ctx)
	return startMapAgentTask(prompt)
}

export async function askAgentAboutBatchAnnotations(ctx: MapBatchAnnotationsContext): Promise<{ ok: boolean; error?: string }> {
	const prompt = buildBatchAnnotationsAgentPrompt(ctx)
	return startMapAgentTask(prompt)
}

export async function askAgentAboutAnnotation(ctx: MapAnnotationContext): Promise<{ ok: boolean; error?: string }> {
	const prompt = buildAnnotationAgentPrompt(ctx)
	return startMapAgentTask(prompt)
}
