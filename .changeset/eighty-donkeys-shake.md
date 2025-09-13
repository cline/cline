---
"claude-dev": patch
---

OpenAI-compatible (gpt-5 Responses API):

- Fix provider image-cap errors by batching images across multiple requests (≤10 per request) with no image loss.
- Preserve all non-image content (input_text, function_call, etc.) across batches; prune empty messages.
- Retain cross-batch context:
  - Intermediate batches emit terse BATCH_NOTES (captured internally and carried forward as assistant context; not surfaced to the user).
  - Each batch injects BATCH_META (JSON with: total_images, batch_index, batches_total, images_in_batch, images_seen_so_far, images_remaining).
  - Final batch adds BATCH_SUMMARY and instructs ALL_IMAGES_PROVIDED; only the final output is surfaced.
- Aggregate usage across all batches and emit a single combined usage event after completion.
- Honor Retry-After (seconds or HTTP-date) and apply a sliding-window RPM/TPM limiter per batch.
- Update transforms/conversions and add tests:
  - Unit tests for batching helper (0 images, 1–10, 11+, mixed content/function_call).
  - Provider-level tests for multi-call execution, per-batch instructions, suppression of intermediate output, and aggregated usage.
- No breaking changes; non-gpt-5 paths and other providers are unchanged.
