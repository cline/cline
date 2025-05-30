import { z } from "zod"
import { getCallStack } from "./common"
export { getCallStack }
export declare const getCallStackSchema: z.ZodObject<
	{
		sessionName: z.ZodOptional<z.ZodString>
	},
	"strip",
	z.ZodTypeAny,
	{
		sessionName?: string | undefined
	},
	{
		sessionName?: string | undefined
	}
>
export declare const getStackFrameVariables: (params: {
	sessionId: string
	frameId: number
	threadId: number
	filter?: string
}) => Promise<
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
					frameId: number
					threadId: number
					variablesByScope: any[]
					filter: string | undefined
				}
			}[]
			isError: boolean
	  }
>
export declare const getStackFrameVariablesSchema: z.ZodObject<
	{
		sessionId: z.ZodString
		frameId: z.ZodNumber
		threadId: z.ZodNumber
		filter: z.ZodOptional<z.ZodString>
	},
	"strip",
	z.ZodTypeAny,
	{
		sessionId: string
		threadId: number
		frameId: number
		filter?: string | undefined
	},
	{
		sessionId: string
		threadId: number
		frameId: number
		filter?: string | undefined
	}
>
