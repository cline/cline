# News Aggregator

Build a news aggregator that extracts structured content from multiple sources.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const data = await valyu.contents({
  urls: [
    "https://techcrunch.com/category/artificial-intelligence/",
    "https://venturebeat.com/category/entrepreneur/",
    "https://www.bbc.co.uk/news/technology"
  ],
  extractEffort: "auto",
  summary: {
    type: "object",
    properties: {
      headline: { type: "string" },
      summary_text: { type: "string" },
      category: { type: "string" },
      tags: {
        type: "array",
        items: { type: "string" },
        maxItems: 5
      }
    },
    required: ["headline", "summary_text"]
  }
});

data.results.forEach(result => {
  console.log(`Source: ${result.url}`);
  console.log(`Content: ${result.content}`);
});
```

```python
from valyu import Valyu

valyu = Valyu()

data = valyu.contents(
    urls=[
        "https://techcrunch.com/category/artificial-intelligence/",
        "https://venturebeat.com/category/entrepreneur/",
        "https://www.bbc.co.uk/news/technology"
    ],
    extract_effort="auto",
    summary={
        "type": "object",
        "properties": {
            "headline": {"type": "string"},
            "summary_text": {"type": "string"},
            "category": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}, "maxItems": 5}
        },
        "required": ["headline", "summary_text"]
    }
)

for result in data["results"]:
    print(f"Source: {result['url']}")
    print(f"Content: {result['content']}")
```
