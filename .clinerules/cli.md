# CLI Development

The CLI lives in `cli/` and uses React Ink for terminal UI.

- If needed, look at `cli/src/constants/colors.ts` for re-used terminal colors, e.g. `COLORS.primaryBlue` highlight color (selections, spinners, success states).
- Never use `dimColor` with gray (e.g. `<Text color="gray" dimColor>`) - it's too hard to read. Use `color="gray"` for secondary text and normal foreground (no color) for primary text.
- When thinking about how to handle state or messages from core, look at webview for how it communicates with the vs code extension.
- When updating the webview, consider and suggest to the user to update the CLI TUI since we want to provide a similar experience to our terminal users as we do our vs code extension users.

## Adding New API Providers

When adding a new API provider to the extension, you must also update the CLI:

1. **Update `cli/src/components/ModelPicker.tsx`**: Add the provider to the `providerModels` map so `getDefaultModelId()` returns the correct default model. Import the models and default ID from `@shared/api`:
   ```typescript
   import { newProviderDefaultModelId, newProviderModels } from "@/shared/api"

   export const providerModels = {
     // ...existing providers
     "new-provider": { models: newProviderModels, defaultId: newProviderDefaultModelId },
   }
   ```

2. **Use `applyProviderConfig()` for auth flows**: When implementing OAuth or other auth flows for the provider, use the shared utility at `cli/src/utils/provider-config.ts`:
   ```typescript
   import { applyProviderConfig } from "../utils/provider-config"

   // After successful auth:
   await applyProviderConfig({ providerId: "new-provider", controller })
   ```
   This handles setting provider, default model, API key mapping, state persistence, and rebuilding the API handler.

3. **Provider-specific auth**: If the provider uses OAuth (like `openai-codex`), add handling in `SettingsPanelContent.tsx`'s `handleProviderSelect` callback. See the existing Codex OAuth flow as a reference.