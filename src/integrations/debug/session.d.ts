import * as vscode from "vscode"
import { z } from "zod"
export declare const listDebugSessions: () => {
	content: {
		type: string
		json: {
			sessions: {
				id: string
				name: string
				configuration: vscode.DebugConfiguration
			}[]
		}
	}[]
	isError: boolean
}
export declare const listDebugSessionsSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>
export declare const startDebugSession: (params: {
	workspaceFolder: string
	configuration: {
		type: string
		request: string
		name: string
		[key: string]: any
	}
}) => Promise<{
	content: {
		type: string
		text: string
	}[]
	isError: boolean
}>
export declare const startDebugSessionSchema: z.ZodObject<
	{
		workspaceFolder: z.ZodString
		configuration: z.ZodObject<
			{
				type: z.ZodString
				request: z.ZodString
				name: z.ZodString
			},
			"passthrough",
			z.ZodTypeAny,
			z.objectOutputType<
				{
					type: z.ZodString
					request: z.ZodString
					name: z.ZodString
				},
				z.ZodTypeAny,
				"passthrough"
			>,
			z.objectInputType<
				{
					type: z.ZodString
					request: z.ZodString
					name: z.ZodString
				},
				z.ZodTypeAny,
				"passthrough"
			>
		>
	},
	"strip",
	z.ZodTypeAny,
	{
		workspaceFolder: string
		configuration: {
			name: string
			type: string
			request: string
		} & {
			[k: string]: unknown
		}
	},
	{
		workspaceFolder: string
		configuration: {
			name: string
			type: string
			request: string
		} & {
			[k: string]: unknown
		}
	}
>
export declare const stopDebugSession: (params: { sessionName: string }) => Promise<{
	content: {
		type: string
		text: string
	}[]
	isError: boolean
}>
export declare const stopDebugSessionSchema: z.ZodObject<
	{
		sessionName: z.ZodString
	},
	"strip",
	z.ZodTypeAny,
	{
		sessionName: string
	},
	{
		sessionName: string
	}
>
export declare const resumeDebugSession: (params: { sessionId: string }) => Promise<{
	content: {
		type: string
		text: string
	}[]
	isError: boolean
}>
export declare const resumeDebugSessionSchema: z.ZodObject<
	{
		sessionId: z.ZodString
	},
	"strip",
	z.ZodTypeAny,
	{
		sessionId: string
	},
	{
		sessionId: string
	}
>
