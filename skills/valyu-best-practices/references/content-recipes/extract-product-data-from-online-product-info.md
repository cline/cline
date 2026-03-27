# Extract Product Data

Extract structured product information from e-commerce pages.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const data = await valyu.contents({
  urls: [
    "https://store.example.com/product-1",
    "https://store.example.com/product-2"
  ],
  extractEffort: "auto",
  summary: {
    type: "object",
    properties: {
      product_name: { type: "string" },
      features: {
        type: "array",
        items: { type: "string" }
      },
      pricing: { type: "string" },
      target_audience: { type: "string" }
    },
    required: ["product_name"]
  }
});

console.log(data.results[0].content);
```

```python
from valyu import Valyu

valyu = Valyu()

data = valyu.contents(
    urls=["https://store.example.com/product"],
    extract_effort="auto",
    summary={
        "type": "object",
        "properties": {
            "product_name": {"type": "string"},
            "features": {"type": "array", "items": {"type": "string"}},
            "pricing": {"type": "string"},
            "target_audience": {"type": "string"}
        },
        "required": ["product_name"]
    }
)

print(data["results"][0]["content"])
```

## CLI
```bash
scripts/valyu contents "https://amazon.com/product" --structured '{"type":"object","properties":{"name":{"type":"string"},"price":{"type":"number"}}}'
```
