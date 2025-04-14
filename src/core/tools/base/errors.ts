export class ToolError extends Error {
    constructor(message: string) {
        super(message)
        this.name = this.constructor.name
    }
}

export class ToolInputValidationError extends ToolError {
    constructor(
        public readonly errors: Array<{
            path: (string | number)[]
            message: string
        }>,
        public readonly input: unknown
    ) {
        // Format message to be clear and structured for LLM understanding
        const formattedErrors = errors.map((e) => ({
            field: e.path.join('.'),
            issue: e.message,
        }))

        const message = [
            'Tool input validation failed.',
            'Issues found:',
            ...formattedErrors.map((e) => `- Field '${e.field}': ${e.issue}`),
            '\nProvided input:',
            JSON.stringify(input, null, 2),
        ].join('\n')

        super(message)
    }
}

export class ToolOutputValidationError extends ToolError {
    constructor(
        public readonly errors: Array<{
            path: (string | number)[]
            message: string
        }>,
        public readonly output: unknown
    ) {
        // Format message to be clear and structured for LLM understanding
        const formattedErrors = errors.map((e) => ({
            field: e.path.join('.'),
            issue: e.message,
        }))

        const message = [
            'Tool output validation failed (API response was not in expected format).',
            'Schema violations:',
            ...formattedErrors.map((e) => `- Field '${e.field}': ${e.issue}`),
            '\nAPI Response received:',
            JSON.stringify(output, null, 2),
        ].join('\n')

        super(message)
    }
}
