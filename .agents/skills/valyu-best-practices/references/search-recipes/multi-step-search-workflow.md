# Multi-Step Search Workflow

For complex research tasks, break your search into multiple steps rather than relying on a single query. This works especially well for technical domains like research, finance, and medicine.

```typescript
// Multi-step search workflow
async function researchAgent(query: string) {
  // Step 1: Break down the query into focused searches
  const subQueries = decomposeQuery(query);

  const results: Record<string, any> = {};

  for (let i = 0; i < subQueries.length; i++) {
    const subQuery = subQueries[i];

    // Step 2: Adjust strategy based on what you've found
    const strategy = adaptStrategy(subQuery, results);

    const searchResult = await valyu.search({
      query: subQuery,
      includedSources: strategy.sources,
      maxPrice: strategy.budget,
      relevanceThreshold: 0.65
    });
    results[`step_${i}`] = searchResult;

    // Step 3: Fill in any gaps
    const gaps = identifyKnowledgeGaps(searchResult, query);
    if (gaps && gaps.length > 0) {
      const gapResult = await valyu.search({
        query: gaps[0].refined_query,
        includedSources: gaps[0].target_sources,
        maxPrice: 50.0
      });
      results[`gap_fill_${i}`] = gapResult;
    }
  }

  // Step 4: Combine everything
  return synthesizeMultiSourceFindings(results);
}
```

```python
async def research_agent(query: str):
    # Step 1: Break down the query into focused searches
    sub_queries = decompose_query(query)

    results = {}
    for i, sub_query in enumerate(sub_queries):
        # Step 2: Adjust strategy based on what you've found
        strategy = adapt_strategy(sub_query, results)

        search_result = valyu.search(
            query=sub_query,
            included_sources=strategy.sources,
            max_price=strategy.budget,
            relevance_threshold=0.65
        )
        results[f"step_{i}"] = search_result

        # Step 3: Fill in any gaps
        gaps = identify_knowledge_gaps(search_result, query)
        if gaps:
            gap_result = valyu.search(
                query=gaps[0].refined_query,
                included_sources=gaps[0].target_sources,
                max_price=50.0
            )
            results[f"gap_fill_{i}"] = gap_result

    # Step 4: Combine everything
    return synthesize_multi_source_findings(results)
```
