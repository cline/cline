// ---------------------------------------------------------------------------
// Backward-compatible re-exports.
//
// Existing test files import from "./utils.js" — this file keeps those
// imports working while the canonical implementations live in helpers/.
// ---------------------------------------------------------------------------

export { clineEnv, testEnv } from "./helpers/env.js"
export { expectVisible, typeAndSubmit } from "./helpers/terminal.js"
