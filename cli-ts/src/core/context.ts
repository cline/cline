/**
 * Re-export the VSCode context initialization from the standalone module
 *
 * This reuses the existing implementation that creates a VSCode-like
 * ExtensionContext for standalone (non-VSCode) mode.
 */
export { initializeContext } from "@/standalone/vscode-context"
