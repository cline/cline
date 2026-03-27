# Answer with Streaming

Enable streaming for progressive answer generation.

The stream sends data in sequence: search results first, then content chunks, then metadata.

```typescript
import { Valyu } from "valyu-js";

const valyu = new Valyu(YOUR_VALYU_API_KEY_HERE);

const stream = await valyu.answer({
  query: "Explain the implications of recent AI regulation",
  streaming: true
});

for await (const chunk of stream) {
  switch (chunk.type) {
    case 'search_results':
      console.log('Sources found:', chunk.data.length);
      break;
    case 'content':
      process.stdout.write(chunk.data);
      break;
    case 'metadata':
      console.log('\nCost:', chunk.data.cost);
      break;
    case 'done':
      console.log('\nComplete');
      break;
    case 'error':
      console.error('Error:', chunk.data);
      break;
  }
}
```

## Chunk Types

| Type | Description |
|------|-------------|
| `search_results` | Found sources |
| `content` | Answer text chunks |
| `metadata` | Cost and usage info |
| `done` | Completion signal |
| `error` | Error information |
