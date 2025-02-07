---
"claude-dev": minor
---

# Add Codestral as a free alternative to Mistral API

### Description

Added Codestral as a new LLM provider that offers a free alternative to Mistral's paid API. Key changes include:

* Added new `CodestralHandler` class implementing the `ApiHandler` interface
* Integrated Codestral model definitions with appropriate token limits and pricing (free for personal use)
* Updated UI to support Codestral API key configuration and model selection
* Fixed Mistral console URL to point to the correct domain
* Reused Mistral message format transformation since both APIs share similar structure

The implementation leverages the existing Mistral client but configures it to use Codestral's endpoint, allowing users to benefit from similar capabilities while avoiding usage costs.

### Test Procedure

* Verified Codestral provider initialization with custom endpoint
* Tested message streaming functionality works correctly
* Confirmed proper token usage tracking
* Validated UI changes for provider selection and API key configuration
* Ensured model selection dropdown displays correct Codestral models
* Tested error handling for invalid API keys and failed requests
* Verified links to console for obtaining API keys work correctly

### Type of Change

- [ ] 🐛 Bug fix (non-breaking change which fixes an issue)
- [x] ✨ New feature (non-breaking change which adds functionality)
- [ ] 💥 Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] 📚 Documentation update

### Pre-flight Checklist

- [x] Changes are limited to a single feature, bugfix or chore (split larger changes into separate PRs)
- [x] Tests are passing (`npm test`) and code is formatted and linted (`npm run format && npm run lint`)
- [x] I have created a changeset using `npm run changeset` (required for user-facing changes)
- [x] I have reviewed [contributor guidelines](https://github.com/cline/cline/blob/main/CONTRIBUTING.md)

### Additional Notes

The Codestral integration maintains feature parity with Mistral while providing a cost-free option for users. The implementation is designed to be maintainable by reusing existing code patterns and transformation logic where possible.
