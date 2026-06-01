/**
 * Live-model eval scenarios (foundation — not yet implemented).
 *
 * These will replay real tasks (e.g. the original failing course run) through a configured
 * model via the API and score the outcome. They implement the same EvalScenario interface as
 * the offline battery, so they feed the same runScorecard / formatScorecard engine.
 *
 * Implementation notes for whoever builds this:
 *  - Each scenario's run() drives a Task to completion against a fixed model + prompt, then
 *    scores the result (did it call the expected tools, reach attempt_completion, avoid the
 *    mistake-limit ask, etc.). Keep run() async.
 *  - Gate execution behind an env flag (e.g. AIHYDRO_LIVE_EVALS=1) and a model/API-key check
 *    so the offline scorecard stays the default, free, deterministic path in CI.
 *  - Compare pass-rates across models (DeepSeek-v4 vs. Claude) to quantify the harness gap.
 */

import type { EvalScenario } from "../scorecard"

export const liveScenarios: EvalScenario[] = []
