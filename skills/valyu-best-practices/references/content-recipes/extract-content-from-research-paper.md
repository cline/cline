# Extract Research Paper Data

Extract structured academic data from research papers.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const data = await valyu.contents({
  urls: ["https://arxiv.org/abs/2301.00001"],
  responseLength: "max",
  extractEffort: "high",
  summary: {
    type: "object",
    properties: {
      title: { type: "string" },
      abstract: { type: "string" },
      methodology: { type: "string" },
      key_findings: {
        type: "array",
        items: { type: "string" }
      },
      limitations: { type: "string" }
    },
    required: ["title"]
  }
});

console.log(data.results[0].content);
```

```python
from valyu import Valyu

valyu = Valyu()

data = valyu.contents(
    urls=["https://arxiv.org/abs/2301.00001"],
    response_length="max",
    extract_effort="high",
    summary={
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "abstract": {"type": "string"},
            "methodology": {"type": "string"},
            "key_findings": {"type": "array", "items": {"type": "string"}},
            "limitations": {"type": "string"}
        },
        "required": ["title"]
    }
)

print(data["results"][0]["content"])
```
