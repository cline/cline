/**
 * Webview-side feature flag identifiers.
 *
 * Keep these in sync with the `FeatureFlag` enum in
 * `apps/vscode/src/shared/services/feature-flags/feature-flags.ts`.
 * They are duplicated here as plain string constants because the extension-side
 * enum module imports Node/extension-only dependencies that do not resolve in
 * the webview bundle.
 */

/** Enables Cline Pass provider/model exposure (settings + onboarding). */
export const CLINE_PASS_FEATURE_FLAG = "ext-cline-pass"
