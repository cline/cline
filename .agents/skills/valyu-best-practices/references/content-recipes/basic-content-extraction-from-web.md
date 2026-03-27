# Basic Content Extraction

Turn any web page into clean, structured markdown data.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const data = await valyu.contents({
  urls: ["https://techcrunch.com/category/artificial-intelligence/"],
  responseLength: "medium",  // "short", "medium", "large", "max"
  extractEffort: "auto"      // "auto", "normal", "high"
});

console.log(data.results[0].content);
```

```python
from valyu import Valyu

valyu = Valyu()

data = valyu.contents(
    urls=["https://techcrunch.com/category/artificial-intelligence/"],
    response_length="medium",
    extract_effort="auto"
)

print(data["results"][0]["content"])
```

## CLI
```bash
scripts/valyu contents "https://techcrunch.com/article"
```

## Options

| Parameter | Options | Description |
|-----------|---------|-------------|
| responseLength | short, medium, large, max | Output verbosity |
| extractEffort | auto, normal, high | Processing intensity |
