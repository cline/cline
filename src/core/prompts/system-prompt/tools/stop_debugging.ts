import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.STOP_DEBUGGING,
	name: "stop_debugging",
	description: `Stop the current debug session. This will terminate the debugging process, remove all breakpoints for the session, and return to normal execution mode. Use this when you have finished debugging, found the issue, or want to start a new debug session. Any breakpoints set during the session will be cleared.`,
	contextRequirements: (context) => context.ide === "VSCode",
	parameters: [],
}

const nextGen = { ...generic, variant: ModelFamily.NEXT_GEN }

export const stop_debugging_variants = [generic, nextGen]
