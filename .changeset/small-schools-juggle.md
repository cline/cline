---
"claude-dev": patch
---

feat: enhance testing infrastructure and API providersThis update improves the project's testing infrastructure and API providers. Changes include:- Testing Infrastructure: - Added test scripts with commands for different testing scenarios - Added code coverage support with nyc - Updated tsconfig.test.json to use NodeNext module system - Expanded .gitignore patterns - Removed obsolete shell.test.ts- API Provider Enhancements: - Added JSDoc documentation to Gemini API Handler - Fixed error handling for safety filters and null responses - Fixed content unescaping for Windows paths - Fixed ESM/CommonJS compatibility in OpenRouter using require instead of import- Path Utilities: - Updated getReadablePath with better normalization and cross-platform support - Improved path comparison with consistent separator handling - Fixed path display issues on WindowsThese changes improve maintainability and reliability across different platforms and API integrations.
