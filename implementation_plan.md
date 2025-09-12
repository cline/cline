# Implementation Plan

## [Overview]
This implementation fixes a bug in the Z AI provider where an invalid model ID (e.g., from a previous provider like Gemini) is not validated before being sent to the Z AI API, resulting in a 400 Unknown Model error for GLM-4.5, while GLM-4.5-air works when explicitly selected.

The bug occurs because the ZAiHandler's getModel() method casts the apiModelId to the expected type without runtime validation against the available models for the selected API line (international or mainland China). If the modelId is invalid (e.g., "gemini-2.5-pro" lingering from switching providers), it uses the invalid ID instead of falling back to the default ("glm-4.5"). This fix adds validation in getModel() to ensure the modelId is a valid key in the appropriate models object, falling back to the default if not. Additionally, update the UI in ZAiProvider.tsx to reset the modelId to the default when the API line changes, preventing invalid selections. No breaking changes; maintains backward compatibility and existing behavior for valid selections like GLM-4.5-air. This fits into the existing API provider system by enhancing model validation consistently across providers, improving user experience when switching configurations.

## [Types]
No new types are required; leverage existing types from @shared/api such as internationalZAiModelId, mainlandZAiModelId, and ModelInfo.

Validation will use keyof typeof internationalZAiModels and mainlandZAiModels to check if modelId is a valid key. No changes to interfaces or enums.

## [Files]
Modify two existing files to implement the fix.

- src/core/api/providers/zai.ts: Add runtime validation in getModel() to check if modelId is a key in the models object before using it; fallback to default if invalid. This ensures the request always uses a valid model ID.
- webview-ui/src/components/settings/providers/ZAiProvider.tsx: In the zaiApiLine dropdown onChange, after updating the line, explicitly set the apiModelId to the corresponding default (internationalZAiDefaultModelId or mainlandZAiDefaultModelId) via handleModeFieldChange to prevent stale invalid model IDs.

No new files, deletions, or configuration updates needed.

## [Functions]
Modify one existing function and add a helper if needed, but primarily update getModel().

- Modified function: getModel() in src/core/api/providers/zai.ts – Add validation: const validModelId = modelId && Object.keys(models).includes(modelId) ? modelId : defaultId; then use validModelId for the return id. This ensures safe fallback without altering the function signature or external behavior.
- No new functions or removals required.

## [Classes]
No class modifications needed; the change is within the existing ZAiHandler class method.

- ZAiHandler class in src/core/api/providers/zai.ts remains unchanged in structure; only internal logic in getModel() is enhanced for validation.

## [Dependencies]
No new dependencies or version changes required; uses existing OpenAI client and shared API types.

## [Testing]
Add unit tests for the updated getModel() function and UI behavior.

- New test file: src/core/api/providers/__tests__/zai.test.ts (if not existing, create it) – Test cases: valid modelId uses it; invalid modelId (e.g., "gemini-2.5-pro") falls back to default; different API lines use correct models/defaults. Use Jest to mock options and assert returned id/info.
- Modify existing tests if any, or add to evals/ for integration testing of API requests with invalid modelIds.
- UI test: In webview-ui/src/components/settings/__tests__/ZAiProvider.spec.tsx (create if needed) – Simulate dropdown change and verify modelId resets to default via handleModeFieldChange mock.
- Manual validation: Switch from Gemini to ZAI in settings, confirm no 400 error on prompt.

## [Implementation Order]
Implement changes in a sequence that allows incremental testing and avoids breaking the current functionality.

1. Update src/core/api/providers/zai.ts: Add validation logic to getModel() with fallback; test locally by setting invalid apiModelId and verifying fallback in a debug session or unit test.
2. Update webview-ui/src/components/settings/providers/ZAiProvider.tsx: Modify onChange for zaiApiLine dropdown to reset modelId to default after line change; test UI by switching lines and confirming model selector updates.
3. Add unit tests for both changes as described in [Testing] section; run npm test to validate.
4. Test end-to-end: In VSCode, switch providers/models, send prompt with ZAI GLM-4.5, confirm no 400 error and correct modelId in network request (use dev tools or logs).
5. Update documentation if needed (e.g., in docs/provider-config/zai.mdx mention improved model validation), but minimal since it's a bugfix.
