---
"roo-cline": patch
---

Adds a function to add temperature setting based on the model id
This is added because openai/o3-mini does not support temperature parameter which causes the request to fail.
This update will allow users to use o3-mini on Unbound without facing any issues.
