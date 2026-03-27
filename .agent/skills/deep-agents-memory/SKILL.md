---
name: deep-agents-memory
description: "INVOKE THIS SKILL when your Deep Agent needs memory, persistence, or filesystem access. Covers StateBackend (ephemeral), StoreBackend (persistent), FilesystemMiddleware, and CompositeBackend for routing."
---

<overview>
Deep Agents use pluggable backends for file operations and memory:

**Short-term (StateBackend)**: Persists within a single thread, lost when thread ends
**Long-term (StoreBackend)**: Persists across threads and sessions
**Hybrid (CompositeBackend)**: Route different paths to different backends

FilesystemMiddleware provides tools: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`
</overview>

<backend-selection>

| Use Case | Backend | Why |
|----------|---------|-----|
| Temporary working files | StateBackend | Default, no setup |
| Local development CLI | FilesystemBackend | Direct disk access |
| Cross-session memory | StoreBackend | Persists across threads |
| Hybrid storage | CompositeBackend | Mix ephemeral + persistent |

</backend-selection>

<ex-default-state-backend>
<python>
Default StateBackend stores files ephemerally within a thread.
```python
from deepagents import create_deep_agent

agent = create_deep_agent()  # Default: StateBackend
result = agent.invoke({
    "messages": [{"role": "user", "content": "Write notes to /draft.txt"}]
}, config={"configurable": {"thread_id": "thread-1"}})
# /draft.txt is lost when thread ends
```
</python>
<typescript>
Default StateBackend stores files ephemerally within a thread.
```typescript
import { createDeepAgent } from "deepagents";

const agent = await createDeepAgent();  // Default: StateBackend
const result = await agent.invoke({
  messages: [{ role: "user", content: "Write notes to /draft.txt" }]
}, { configurable: { thread_id: "thread-1" } });
// /draft.txt is lost when thread ends
```
</typescript>
</ex-default-state-backend>

<ex-composite-backend-for-hybrid>
<python>
Configure CompositeBackend to route paths to different storage backends.
```python
from deepagents import create_deep_agent
from deepagents.backends import CompositeBackend, StateBackend, StoreBackend
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()

composite_backend = lambda rt: CompositeBackend(
    default=StateBackend(rt),
    routes={"/memories/": StoreBackend(rt)}
)

agent = create_deep_agent(backend=composite_backend, store=store)

# /draft.txt -> ephemeral (StateBackend)
# /memories/user-prefs.txt -> persistent (StoreBackend)
```
</python>
<typescript>
Configure CompositeBackend to route paths to different storage backends.
```typescript
import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from "deepagents";
import { InMemoryStore } from "@langchain/langgraph";

const store = new InMemoryStore();

const agent = await createDeepAgent({
  backend: (config) => new CompositeBackend(
    new StateBackend(config),
    { "/memories/": new StoreBackend(config) }
  ),
  store
});

// /draft.txt -> ephemeral (StateBackend)
// /memories/user-prefs.txt -> persistent (StoreBackend)
```
</typescript>
</ex-composite-backend-for-hybrid>

<ex-cross-session-memory>
<python>
Files in /memories/ persist across threads via StoreBackend routing.
```python
# Using CompositeBackend from previous example
config1 = {"configurable": {"thread_id": "thread-1"}}
agent.invoke({"messages": [{"role": "user", "content": "Save to /memories/style.txt"}]}, config=config1)

config2 = {"configurable": {"thread_id": "thread-2"}}
agent.invoke({"messages": [{"role": "user", "content": "Read /memories/style.txt"}]}, config=config2)
# Thread 2 can read file saved by Thread 1
```
</python>
<typescript>
Files in /memories/ persist across threads via StoreBackend routing.
```typescript
// Using CompositeBackend from previous example
const config1 = { configurable: { thread_id: "thread-1" } };
await agent.invoke({ messages: [{ role: "user", content: "Save to /memories/style.txt" }] }, config1);

const config2 = { configurable: { thread_id: "thread-2" } };
await agent.invoke({ messages: [{ role: "user", content: "Read /memories/style.txt" }] }, config2);
// Thread 2 can read file saved by Thread 1
```
</typescript>
</ex-cross-session-memory>

<ex-filesystem-backend-local-dev>
<python>
Use FilesystemBackend for local development with real disk access and human-in-the-loop.
```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    backend=FilesystemBackend(root_dir=".", virtual_mode=True),  # Restrict access
    interrupt_on={"write_file": True, "edit_file": True},
    checkpointer=MemorySaver()
)

# Agent can read/write actual files on disk
```
</python>
<typescript>
Use FilesystemBackend for local development with real disk access and human-in-the-loop.
```typescript
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";

const agent = await createDeepAgent({
  backend: new FilesystemBackend({ rootDir: ".", virtualMode: true }),
  interruptOn: { write_file: true, edit_file: true },
  checkpointer: new MemorySaver()
});
```
</typescript>

**Security: Never use FilesystemBackend in web servers - use StateBackend or sandbox instead.**
</ex-filesystem-backend-local-dev>

<ex-store-in-custom-tools>
<python>
Access the store directly in custom tools for long-term memory operations.
```python
from langchain.tools import tool, ToolRuntime
from langchain.agents import create_agent
from langgraph.store.memory import InMemoryStore

@tool
def get_user_preference(key: str, runtime: ToolRuntime) -> str:
    """Get a user preference from long-term storage."""
    store = runtime.store
    result = store.get(("user_prefs",), key)
    return str(result.value) if result else "Not found"

@tool
def save_user_preference(key: str, value: str, runtime: ToolRuntime) -> str:
    """Save a user preference to long-term storage."""
    store = runtime.store
    store.put(("user_prefs",), key, {"value": value})
    return f"Saved {key}={value}"

store = InMemoryStore()

agent = create_agent(
    model="gpt-4.1",
    tools=[get_user_preference, save_user_preference],
    store=store
)
```
</python>
</ex-store-in-custom-tools>

<boundaries>
### What Agents CAN Configure

- Backend type and configuration
- Routing rules for CompositeBackend
- Root directory for FilesystemBackend
- Human-in-the-loop for file operations

### What Agents CANNOT Configure

- Tool names (ls, read_file, write_file, edit_file, glob, grep)
- Access files outside virtual_mode restrictions
- Cross-thread file access without proper backend setup
</boundaries>

<fix-storebackend-requires-store>
<python>
StoreBackend requires a store instance.
```python
# WRONG
agent = create_deep_agent(backend=lambda rt: StoreBackend(rt))

# CORRECT
agent = create_deep_agent(backend=lambda rt: StoreBackend(rt), store=InMemoryStore())
```
</python>
<typescript>
StoreBackend requires a store instance.
```typescript
// WRONG
const agent = await createDeepAgent({ backend: (c) => new StoreBackend(c) });

// CORRECT
const agent = await createDeepAgent({ backend: (c) => new StoreBackend(c), store: new InMemoryStore() });
```
</typescript>
</fix-storebackend-requires-store>

<fix-statebackend-files-dont-persist>
<python>
StateBackend files are thread-scoped - use same thread_id or StoreBackend for cross-thread access.
```python
# WRONG: thread-2 can't read file from thread-1
agent.invoke({"messages": [...]}, config={"configurable": {"thread_id": "thread-1"}})  # Write
agent.invoke({"messages": [...]}, config={"configurable": {"thread_id": "thread-2"}})  # File not found!
```
</python>
<typescript>
StateBackend files are thread-scoped - use same thread_id or StoreBackend for cross-thread access.
```typescript
// WRONG: thread-2 can't read file from thread-1
await agent.invoke({ messages: [...] }, { configurable: { thread_id: "thread-1" } });  // Write
await agent.invoke({ messages: [...] }, { configurable: { thread_id: "thread-2" } });  // File not found!
```
</typescript>
</fix-statebackend-files-dont-persist>

<fix-path-prefix-for-persistence>
<python>
Path must match CompositeBackend route prefix for persistence.
```python
# With routes={"/memories/": StoreBackend(rt)}:
agent.invoke(...)  # /prefs.txt -> ephemeral (no match)
agent.invoke(...)  # /memories/prefs.txt -> persistent (matches route)
```
</python>
<typescript>
Path must match CompositeBackend route prefix for persistence.
```typescript
// With routes: { "/memories/": StoreBackend }:
await agent.invoke(...);  // /prefs.txt -> ephemeral (no match)
await agent.invoke(...);  // /memories/prefs.txt -> persistent (matches route)
```
</typescript>
</fix-path-prefix-for-persistence>

<fix-production-store>
<python>
Use PostgresStore for production (InMemoryStore lost on restart).
```python
# WRONG                              # CORRECT
store = InMemoryStore()              store = PostgresStore(connection_string="postgresql://...")
```
</python>
<typescript>
Use PostgresStore for production (InMemoryStore lost on restart).
```typescript
// WRONG                                    // CORRECT
const store = new InMemoryStore();          const store = new PostgresStore({ connectionString: "..." });
```
</typescript>
</fix-production-store>

<fix-filesystem-backend-needs-virtual-mode>
<python>
Enable virtual_mode=True to restrict path access (prevents ../ and ~/ escapes).
```python
backend = FilesystemBackend(root_dir="/project", virtual_mode=True)  # Secure
```
</python>
</fix-filesystem-backend-needs-virtual-mode>

<fix-longest-prefix-match>
<python>
CompositeBackend matches longest prefix first.
```python
routes = {"/mem/": StoreBackend(rt), "/mem/temp/": StateBackend(rt)}
# /mem/file.txt -> StoreBackend, /mem/temp/file.txt -> StateBackend (longer match)
```
</python>
</fix-longest-prefix-match>
