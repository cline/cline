# Using Collections to Search

Organize sources into named groups for reuse across searches.

## Setup

1. Navigate to Collections in your Valyu dashboard
2. Click "Create Collection"
3. Add sources (datasets, domains, URLs)
4. Save with a descriptive name

## Usage

Reference collections using the `collection:` prefix.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu();

// Use a saved collection
const response = await valyu.search({
  query: "market trends 2024",
  searchType: "all",
  includedSources: ["collection:my-finance-sources"]
});

// Combine collection with other sources
const combined = await valyu.search({
  query: "healthcare innovation",
  searchType: "all",
  includedSources: [
    "collection:medical-research",
    "techcrunch.com",
    "valyu/valyu-patents"
  ]
});
```

```python
from valyu import Valyu

valyu = Valyu()

# Use a saved collection
response = valyu.search(
    query="market trends 2024",
    search_type="all",
    included_sources=["collection:my-finance-sources"]
)

# Combine collection with other sources
combined = valyu.search(
    query="healthcare innovation",
    search_type="all",
    included_sources=[
        "collection:medical-research",
        "techcrunch.com",
        "valyu/valyu-patents"
    ]
)
```
