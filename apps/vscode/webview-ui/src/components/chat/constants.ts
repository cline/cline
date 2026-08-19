/**
 * Shared constants for chat components
 */

/**
 * Marker string used to separate hook metadata from hook output in hook messages.
 * When a hook executes, its metadata (status, tool info, etc.) is followed by this
 * marker, which is then followed by the actual output from the hook script.
 */
export const HOOK_OUTPUT_STRING = "__HOOK_OUTPUT__"
