# Content Extraction with Summary

Extract content with automatic or custom summarization.

## Basic Summary

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

// Enable basic summary
const data = await valyu.contents({
  urls: ["https://example.com/article"],
  responseLength: "medium",
  extractEffort: "auto",
  summary: true
});
```

## Custom Summary Instructions

```typescript
const data = await valyu.contents({
  urls: ["https://example.com/research-paper"],
  responseLength: "large",
  extractEffort: "high",
  summary: "Summarize the methodology, key findings, and practical applications in 2-3 paragraphs"
});
```

```python
from valyu import Valyu

valyu = Valyu()

# Custom summary
data = valyu.contents(
    urls=["https://example.com/research-paper"],
    response_length="large",
    extract_effort="high",
    summary="Summarize the methodology, key findings, and practical applications in 2-3 paragraphs"
)

print(data["results"][0]["content"])
```

## CLI
```bash
# Basic summary
scripts/valyu contents "https://example.com" --summary

# Custom instructions
scripts/valyu contents "https://example.com" --summary "Key points in 3 bullets"
```
