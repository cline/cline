# Academic Search

Search peer-reviewed papers across multiple scholarly databases.

## Available Datasets
- `valyu/valyu-arxiv` - Preprints across all research fields
- `valyu/valyu-pubmed` - Medical and life sciences
- `wiley/wiley-finance-papers` - Finance and economics
- `valyu/valyu-biorxiv` - Life sciences preprints
- `valyu/valyu-medrxiv` - Clinical and health research preprints

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

// Search specific academic sources
const response = await valyu.search({
  query: "CRISPR gene editing therapeutic applications",
  searchType: "proprietary",
  includedSources: ["valyu/valyu-arxiv", "valyu/valyu-pubmed"],
  maxNumResults: 20,
  startDate: "2024-01-01",
});

// Cross-disciplinary research
const crossDisciplinary = await valyu.search({
  query: "transformer architecture neural networks",
  searchType: "proprietary",
  includedSources: [
    "valyu/valyu-arxiv",
    "nature.com",
    "science.org"
  ],
  maxNumResults: 15,
});
```

```python
from valyu import Valyu

valyu = Valyu()

# Search specific academic sources
response = valyu.search(
    query="CRISPR gene editing therapeutic applications",
    search_type="proprietary",
    included_sources=["valyu/valyu-arxiv", "valyu/valyu-pubmed"],
    max_num_results=20,
    start_date="2024-01-01",
)

# Cross-disciplinary research
cross_disciplinary = valyu.search(
    query="transformer architecture neural networks",
    search_type="proprietary",
    included_sources=[
        "valyu/valyu-arxiv",
        "nature.com",
        "science.org"
    ],
    max_num_results=15,
)
```

## CLI
```bash
scripts/valyu search paper "CRISPR gene editing therapeutic applications" 20
```
