---
"cline": patch
---

feat(cli): Add SAP AI Core provider support to the CLI

- Add SapAiCoreSetup component with form-style configuration
- Support for Client ID, Client Secret, Base URL, Token URL, Resource Group
- Orchestration Mode toggle for simplified deployment configuration
- Dynamic model fetching from SAP AI Core API
- Pre-fill form with existing configuration when reconfiguring
- Store deployment IDs per mode (plan/act) on model selection
- Clear config when switching to different providers
