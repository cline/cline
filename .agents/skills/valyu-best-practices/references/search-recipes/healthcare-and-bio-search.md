# Healthcare & Bio Search

Search clinical research and pharmaceutical data across multiple authoritative sources.

## Available Datasets

**Clinical Research:**
- `valyu/valyu-clinical-trials` - ClinicalTrials.gov
- `valyu/valyu-drug-labels` - FDA drug labels (DailyMed)
- `valyu/valyu-pubmed` - Biomedical literature
- `valyu/valyu-biorxiv` - Life sciences preprints
- `valyu/valyu-medrxiv` - Clinical research preprints

**Pharmaceutical Business:**
- `valyu/valyu-sec-filings` - Pharma company SEC filings
- `valyu/valyu-stocks` - Stock data
- `valyu/valyu-earnings-US` - Quarterly earnings

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

// Search clinical trials
const trials = await valyu.search({
  query: "GLP-1 agonist weight loss Phase 3 recruiting",
  searchType: "proprietary",
  includedSources: ["valyu/valyu-clinical-trials"],
  maxNumResults: 20,
});

// Drug safety information
const drugInfo = await valyu.search({
  query: "semaglutide adverse effects warnings",
  searchType: "proprietary",
  includedSources: ["valyu/valyu-drug-labels"],
  maxNumResults: 10,
});

// Research literature with date filter
const research = await valyu.search({
  query: "immunotherapy cancer treatment efficacy",
  searchType: "proprietary",
  includedSources: ["valyu/valyu-pubmed", "valyu/valyu-biorxiv"],
  maxNumResults: 25,
  startDate: "2024-01-01",
});
```

```python
from valyu import Valyu

valyu = Valyu()

# Search clinical trials
trials = valyu.search(
    query="GLP-1 agonist weight loss Phase 3 recruiting",
    search_type="proprietary",
    included_sources=["valyu/valyu-clinical-trials"],
    max_num_results=20,
)

# Drug safety information
drug_info = valyu.search(
    query="semaglutide adverse effects warnings",
    search_type="proprietary",
    included_sources=["valyu/valyu-drug-labels"],
    max_num_results=10,
)
```

## CLI
```bash
scripts/valyu search bio "GLP-1 agonist weight loss clinical trials" 20
```
