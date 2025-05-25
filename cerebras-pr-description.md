# Cerebras API Integration PR

### Description

This PR adds comprehensive Cerebras API support to Cline, enabling users to access Cerebras's high-performance inference platform with 5 different models including reasoning-capable models.

**Key Features Added:**
- **Native Cerebras SDK Integration**: Uses `@cerebras/cerebras_cloud_sdk` for optimal performance and compatibility
- **5 Cerebras Models**: llama3.1-8b (default), llama-4-scout-17b-16e-instruct, llama-3.3-70b, qwen-3-32b, and deepseek-r1-distill-llama-70b
- **Reasoning Support**: Qwen and DeepSeek R1 Distill models support `<think>` tag handling for enhanced reasoning capabilities
- **Streaming Responses**: Full streaming support with proper error handling and real-time token usage tracking
- **Cost Calculation**: Token counting and cost tracking (set to free/$0 for all models)
- **UI Integration**: Complete settings UI with API key configuration, model selection dropdown, and help links
- **Proper Context Windows**: 8192 tokens for Llama models, 16384 tokens for Qwen models

**Problem Solved:**
Users can now leverage Cerebras's ultra-fast inference speeds (2000+ tokens/second) directly within Cline, providing an alternative high-performance API provider option alongside existing providers like Anthropic, OpenRouter, and others.

### Test Procedure

**Testing Completed:**
- ✅ **API Key Configuration**: Tested API key input, validation, and secure storage
- ✅ **Model Selection**: Verified all 5 models appear in dropdown and can be selected
- ✅ **Basic Chat**: Confirmed successful API requests and streaming responses
- ✅ **Reasoning Models**: Tested `<think>` tag handling with qwen-3-32b and deepseek-r1-distill-llama-70b
- ✅ **Error Handling**: Verified proper error messages for invalid API keys and network issues
- ✅ **Token Tracking**: Confirmed usage statistics are properly calculated and displayed
- ✅ **UI Integration**: Tested settings panel, help links, and model descriptions
- ✅ **TypeScript Compilation**: All code compiles without errors
- ✅ **Webview Build**: React components build successfully

**Confidence Level: High**
- Follows established patterns from other API providers (SambaNova, XAI, etc.)
- Uses official Cerebras SDK with proper error handling
- Comprehensive logging added during development and removed for production
- All TypeScript types properly defined and validated

### Type of Change

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [x] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] ♻️ Refactor Changes
- [ ] 💅 Cosmetic Changes
- [x] 📚 Documentation update
- [ ] 🏃 Workflow Changes

### Pre-flight Checklist

- [x] Changes are limited to a single feature, bugfix or chore (split larger changes into separate PRs)
- [x] Tests are passing (`npm test`) and code is formatted and linted (`npm run format && npm run lint`)
- [x] I have created a changeset using `npm run changeset` (required for user-facing changes)
- [x] I have reviewed [contributor guidelines](https://github.com/cline/cline/blob/main/CONTRIBUTING.md)

### Screenshots

*Settings UI showing Cerebras provider selection and API key configuration*
*Model dropdown showing all 5 Cerebras models with descriptions*
*Successful chat interaction using Cerebras API*

### Additional Notes

**Files Modified:**
- `src/api/providers/cerebras.ts` - New Cerebras API handler
- `src/api/index.ts` - Registered Cerebras handler
- `src/shared/api.ts` - Added Cerebras models and types
- `src/core/storage/state-keys.ts` - Added cerebrasApiKey to SecretKey type
- `src/core/storage/state.ts` - Updated secret storage functions
- `webview-ui/src/components/settings/ApiOptions.tsx` - Added Cerebras UI integration
- `package.json` - Added @cerebras/cerebras_cloud_sdk dependency
- `README.md` - Updated to include Cerebras in supported providers
- `.clinerules/cline-overview.md` - Added Cerebras to provider documentation
- `.changeset/cerebras-provider.md` - Comprehensive changeset documentation

**Dependencies Added:**
- `@cerebras/cerebras_cloud_sdk: ^1.35.0` - Official Cerebras SDK

**Architecture Notes:**
- Follows the same pattern as other API providers for consistency
- Implements proper message conversion from Anthropic format to Cerebras format
- Includes reasoning model support with `<think>` tag parsing
- Uses streaming with proper error handling and recovery
- Maintains state consistency across webview reloads

**Future Considerations:**
- Monitor Cerebras SDK updates for new features
- Consider adding more Cerebras models as they become available
- Potential to add Cerebras-specific optimizations based on user feedback 