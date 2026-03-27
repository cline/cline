# Finance Search

Search structured financial data across multiple specialized datasets.

## Available Datasets

**Market Data:**
- `valyu/valyu-stocks` - Real-time stock prices
- `valyu/valyu-crypto` - Cryptocurrency data
- `valyu/valyu-forex` - Foreign exchange rates

**Fundamental Analysis:**
- `valyu/valyu-earnings-US` - Quarterly earnings
- `valyu/valyu-balance-sheet-US` - Balance sheets
- `valyu/valyu-income-statement-US` - Income statements
- `valyu/valyu-cash-flow-US` - Cash flow data

**Regulatory:**
- `valyu/valyu-sec-filings` - SEC documents (10-K, 10-Q, 8-K)

**Economic:**
- `valyu/valyu-fred` - Federal Reserve data
- `valyu/valyu-bls` - Bureau of Labor Statistics
- `valyu/valyu-world-bank` - World Bank indicators

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

// Earnings search
const earnings = await valyu.search({
  query: "Tesla quarterly earnings Q4 2024",
  searchType: "proprietary",
  includedSources: ["valyu/valyu-earnings-US"],
  maxNumResults: 10,
});

// Comprehensive financial analysis
const comprehensive = await valyu.search({
  query: "Apple financial performance 2024",
  searchType: "proprietary",
  includedSources: [
    "valyu/valyu-income-statement-US",
    "valyu/valyu-balance-sheet-US",
    "valyu/valyu-cash-flow-US"
  ],
  maxNumResults: 15,
});

// Financial news
const news = await valyu.search({
  query: "Federal Reserve interest rate decision",
  searchType: "news",
  includedSources: ["bloomberg.com", "reuters.com", "wsj.com"],
  maxNumResults: 20,
});
```

```python
from valyu import Valyu

valyu = Valyu()

# Earnings search
earnings = valyu.search(
    query="Tesla quarterly earnings Q4 2024",
    search_type="proprietary",
    included_sources=["valyu/valyu-earnings-US"],
    max_num_results=10,
)

# Comprehensive financial analysis
comprehensive = valyu.search(
    query="Apple financial performance 2024",
    search_type="proprietary",
    included_sources=[
        "valyu/valyu-income-statement-US",
        "valyu/valyu-balance-sheet-US",
        "valyu/valyu-cash-flow-US"
    ],
    max_num_results=15,
)
```

## CLI
```bash
scripts/valyu search finance "Tesla quarterly earnings Q4 2024" 10
scripts/valyu search sec "Apple 10-K 2024" 10
```
