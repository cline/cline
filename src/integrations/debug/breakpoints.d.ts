import { z } from "zod"
export declare const setBreakpoint: (params: { filePath: string; line: number }) => Promise<{
	content: {
		type: string
		text: string
	}[]
	isError: boolean
}>
export declare const setBreakpointSchema: z.ZodObject<
	{
		filePath: z.ZodString
		line: z.ZodNumber
	},
	"strip",
	z.ZodTypeAny,
	{
		filePath: string
		line: number
	},
	{
		filePath: string
		line: number
	}
>
export declare const listBreakpoints: (params?: { filePath?: string }) => {
	content: {
		type: string
		json: {
			breakpoints: (
				| {
						id: string
						enabled: boolean
						condition: string | undefined
						hitCondition: string | undefined
						logMessage: string | undefined
						file: {
							path: string
							name: string
						}
						location: {
							line: number
							column: number
						}
						functionName?: undefined
						type?: undefined
				  }
				| {
						id: string
						enabled: boolean
						functionName: string
						condition: string | undefined
						hitCondition: string | undefined
						logMessage: string | undefined
						file?: undefined
						location?: undefined
						type?: undefined
				  }
				| {
						id: string
						enabled: boolean
						type: string
						condition?: undefined
						hitCondition?: undefined
						logMessage?: undefined
						file?: undefined
						location?: undefined
						functionName?: undefined
				  }
			)[]
			count: number
			filter:
				| {
						filePath: string
				  }
				| undefined
		}
	}[]
	isError: boolean
}
export declare const listBreakpointsSchema: z.ZodObject<
	{
		filePath: z.ZodOptional<z.ZodString>
	},
	"strip",
	z.ZodTypeAny,
	{
		filePath?: string | undefined
	},
	{
		filePath?: string | undefined
	}
>
