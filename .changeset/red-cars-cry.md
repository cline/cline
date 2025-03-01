---
"claude-dev": patch
---

Add dynamic model fetching for the Requesty provider.

Instead of manually typing the model name, the extension dynamically fetches
all the supported model names from Requesty's /v1/models API.

This allows users to use a fuzzy search logic when choosing the models and
also guarantees the information for each model is up to date.
