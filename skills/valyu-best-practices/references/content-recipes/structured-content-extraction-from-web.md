# Structured Content Extraction

Specify the structure of content extraction using JSON schemas.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const data = await valyu.contents({
  urls: ["https://store.example.com/product"],
  maxPriceDollars: 0.10,
  extractEffort: "auto",
  summary: {
    type: "object",
    properties: {
      product_name: { type: "string" },
      price: { type: "number", description: "Price in USD" },
      features: {
        type: "array",
        items: { type: "string" },
        maxItems: 5
      },
      availability: {
        type: "string",
        enum: ["in_stock", "out_of_stock", "preorder"]
      }
    },
    required: ["product_name", "price"]
  }
});

console.log(data.results[0].content);
```

```python
from valyu import Valyu

valyu = Valyu()

data = valyu.contents(
    urls=["https://store.example.com/product"],
    max_price_dollars=0.10,
    extract_effort="auto",
    summary={
        "type": "object",
        "properties": {
            "product_name": {"type": "string"},
            "price": {"type": "number", "description": "Price in USD"},
            "features": {"type": "array", "items": {"type": "string"}, "maxItems": 5},
            "availability": {"type": "string", "enum": ["in_stock", "out_of_stock", "preorder"]}
        },
        "required": ["product_name", "price"]
    }
)

print(data["results"][0]["content"])
```

## CLI
```bash
scripts/valyu contents "https://example.com" --structured '{
  "type": "object",
  "properties": {
    "title": {"type": "string"},
    "summary": {"type": "string"}
  }
}'
```
