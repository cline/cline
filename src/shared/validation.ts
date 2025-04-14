import type { z } from 'zod'

export const validateSchemaWithDefault = <T extends z.ZodSchema>(
    schema: T,
    value: unknown,
    defaultValue: z.infer<T>
): z.infer<T> => {
    if (!value) {
        return defaultValue
    }
    const result = schema.safeParse(value)
    if (result.success) {
        return result.data
    }

    return defaultValue
}
