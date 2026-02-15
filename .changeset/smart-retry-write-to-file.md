---
"cline": patch
---

Fix infinite retry loop when write_to_file fails with missing content parameter. Provides progressive guidance to the model, escalating from suggestions to hard stops, with context window awareness to break the loop.
