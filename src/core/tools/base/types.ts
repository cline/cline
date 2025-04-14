export type ToolInput<T> = T

export interface ToolOutput<T> {
    success: boolean
    data?: T
    error?: string
}
