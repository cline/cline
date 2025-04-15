import type { ToolInput, ToolOutput } from './types'
import { z } from 'zod'
import { ToolInputValidationError, ToolOutputValidationError } from './errors'
import type { ToolUse } from '../../assistant-message'
export abstract class BaseTool<TInput, TOutput> {
    abstract autoApprove: boolean
    abstract readonly name: string
    abstract readonly description: string
    abstract readonly inputSchema: z.ZodSchema<TInput>
    abstract readonly outputSchema: z.ZodSchema<TOutput>
    abstract execute(input: ToolInput<TInput>): Promise<ToolOutput<TOutput>>

    protected preprocessInputSchema<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
        const jsonFields = ['body', 'query'] as const
        return z.preprocess((data) => {
            if (data && typeof data === 'object') {
                const processed = { ...data } as Record<string, unknown>
                for (const field of jsonFields) {
                    if (field in processed) {
                        try {
                            processed[field] = JSON.parse(processed[field] as string)
                        } catch (e) {
                            throw new ToolInputValidationError(
                                [
                                    {
                                        message: `Failed to parse JSON ${field}`,
                                        path: [field],
                                    },
                                ],
                                data
                            )
                        }
                    }
                }
                return processed
            }
            return data
        }, schema)
    }

    validateInput(input: unknown): TInput {
        const result = this.preprocessInputSchema(this.inputSchema).safeParse(input)
        if (!result.success) {
            throw new ToolInputValidationError(result.error.errors, input)
        }
        return result.data
    }

    validateOutput(output: unknown): TOutput {
        const result = this.outputSchema.safeParse(output)
        if (!result.success) {
            throw new ToolOutputValidationError(result.error.errors, output)
        }
        return result.data
    }

    abstract getToolUsageDescription(block: ToolUse): string

    formatOutputForAssistant(output: ToolOutput<TOutput>): string {
        return JSON.stringify(output, null, 3)
    }
}
