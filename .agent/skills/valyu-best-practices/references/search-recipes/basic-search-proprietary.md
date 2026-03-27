# Search Proprietary Data

Valyu has many proprietary data sources. Set the `searchType` parameter to `proprietary`.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const response = await valyu.search({
  query: "latest developments in quantum computing",
  searchType: "proprietary",
});

response.results.forEach(result => {
  console.log(`Title: ${result.title}`);
  console.log(`URL: ${result.url}`);
  console.log(`Source: ${result.sourceType}`);
  console.log(`Content: ${result.content.substring(0, 200)}...`);
});
```

```python
from valyu import Valyu

valyu = Valyu(YOUR_VALYU_API_KEY_HERE)

response = valyu.search(
    query="latest developments in quantum computing",
    max_num_results=5,
    search_type="proprietary",
)

for result in response["results"]:
    print(f"Title: {result['title']}")
    print(f"URL: {result['url']}")
    print(f"Source: {result['source_type']}")
    print(f"Content: {result['content'][:200]}...")
```

## CLI
```bash
scripts/valyu search paper "latest developments in quantum computing" 10
```
