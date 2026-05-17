/**
 * Priority level for a presentation flush request.
 *
 * - `"immediate"` — flush synchronously (delay = 0 ms). Used at semantic
 *   boundaries: first visible token, tool-call transitions, and finalization.
 * - `"normal"` — flush after the configured cadence delay, coalescing
 *   intermediate chunks to reduce message-passing overhead.
 */
export type PresentationPriority = "immediate" | "normal"
