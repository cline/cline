---
"claude-dev": minor
---

Added Databricks as a Provider

This update adds comprehensive Databricks API support to Cline, enabling users to access both Anthropic Claude and through Databricks' ML inference platform.

**Key Features:**
- Native integration with Databricks Anthropic API endpoint  
- 3 Claude models: databricks-claude-sonnet-4-5 (default), databricks-claude-sonnet-4, and databricks-claude-opus-4-1
- Full support for prompt caching and extended thinking mode
- Image input support across all models
- Streaming responses (simulated from non-streaming due to Databricks API limitations)
- Bearer token authentication with automatic `/anthropic` endpoint appending
- Complete UI integration with API key and base URL configuration
- Automatic URL normalization to ensure `/serving-endpoints` format

**Files Modified:**
- `src/core/api/providers/databricks.ts` - New Databricks API handler using Anthropic SDK
- `src/core/api/index.ts` - Registered Databricks handler in API factory
- `src/shared/api.ts` - Added Databricks models, types, and pricing
- `src/core/storage/state-keys.ts` - Added databricksApiKey and databricksBaseUrl to storage
- `src/core/storage/utils/state-helpers.ts` - Added Databricks settings persistence
- `src/core/storage/StateManager.ts` - Added Databricks configuration management
- `proto/cline/state.proto` - Added Databricks fields to Protocol Buffer definitions
- `proto/cline/models.proto` - Added DATABRICKS provider enum and configuration fields
- `src/shared/proto-conversions/models/api-configuration-conversion.ts` - Added Databricks proto conversions
- `webview-ui/src/components/settings/ApiOptions.tsx` - Added Databricks to provider dropdown
- `webview-ui/src/components/settings/providers/DatabricksProvider.tsx` - New Databricks configuration UI
- `webview-ui/src/components/settings/utils/providerUtils.ts` - Added Databricks configuration utilities
- `README.md` - Updated supported providers list
- `docs/provider-config/databricks.mdx` - Comprehensive Databricks setup documentation
