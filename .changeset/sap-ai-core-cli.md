---
"cli": patch
---

feat: Add SAP AI Core CLI integration

This change introduces support for SAP AI Core as a "Bring Your Own" provider in the `cline` CLI.

Users can now configure their SAP AI Core credentials and select from their available deployments directly within the CLI's authentication wizard.

Key changes:
- Added `SAP AI Core` to the list of BYO providers.
- Implemented a dedicated wizard (`SetupSapAiCoreWithDynamicModels`) to guide users through the configuration process.
- Added dynamic model fetching to retrieve available deployments from the user's SAP AI Core instance.
- Updated API configuration logic to store and manage SAP AI Core credentials and deployment IDs.
