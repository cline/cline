// Centralized z-index constants for settings UI overlays
// Use these instead of importing from specific provider components.

// Base stacking context for dropdown inputs and popovers in the settings view
export const SETTINGS_DROPDOWN_BASE_Z_INDEX = 1_000

// Backward-compat alias kept to minimize churn across files.
// Prefer importing SETTINGS_DROPDOWN_BASE_Z_INDEX in new code.
export const OPENROUTER_MODEL_PICKER_Z_INDEX = SETTINGS_DROPDOWN_BASE_Z_INDEX
