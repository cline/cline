import * as vscode from "vscode"
import { z } from "zod"
import { BreakpointHitInfo } from "./common"
export declare const breakpointEventEmitter: vscode.EventEmitter<BreakpointHitInfo>
export declare const onBreakpointHit: vscode.Event<BreakpointHitInfo>
export declare const waitForBreakpointHit: (params: { sessionId?: string; sessionName?: string; timeout?: number }) => Promise<
	| {
			content: {
				type: string
				text: string
			}[]
			isError: boolean
	  }
	| {
			content: {
				type: string
				json: {
					sessionId: string
					sessionName: string
					threadId: number
					reason: string
					frameId?: number
					filePath?: string
					line?: number
				}
			}[]
			isError: boolean
	  }
>
export declare const subscribeToBreakpointEvents: (params: { sessionId?: string; sessionName?: string }) => Promise<{
	content: {
		type: string
		json: {
			subscriptionId: string
			message: string
		}
	}[]
	isError: boolean
	_meta: {
		subscriptionId: string
		type: string
		filter: {
			sessionId: string | undefined
			sessionName: string | undefined
		}
	}
}>
export declare const subscribeToBreakpointEventsSchema: z.ZodObject<
	{
		sessionId: z.ZodOptional<z.ZodString>
		sessionName: z.ZodOptional<z.ZodString>
	},
	"strip",
	z.ZodTypeAny,
	{
		sessionId?: string | undefined
		sessionName?: string | undefined
	},
	{
		sessionId?: string | undefined
		sessionName?: string | undefined
	}
>
export declare const waitForBreakpointHitSchema: z.ZodObject<
	{
		sessionId: z.ZodOptional<z.ZodString>
		sessionName: z.ZodOptional<z.ZodString>
		timeout: z.ZodOptional<z.ZodNumber>
	},
	"strip",
	z.ZodTypeAny,
	{
		sessionId?: string | undefined
		sessionName?: string | undefined
		timeout?: number | undefined
	},
	{
		sessionId?: string | undefined
		sessionName?: string | undefined
		timeout?: number | undefined
	}
>
