---
name: deep-agents-core
description: "INVOKE THIS SKILL when building ANY Deep Agents application. Covers create_deep_agent(), harness architecture, SKILL.md format, and configuration options."
---

<overview>
Deep Agents are an opinionated agent framework built on LangChain/LangGraph with built-in middleware:

- **Task Planning**: TodoListMiddleware for breaking down complex tasks
- **Context Management**: Filesystem tools with pluggable backends
- **Task Delegation**: SubAgent middleware for spawning specialized agents
- **Long-term Memory**: Persistent storage across threads via Store
- **Human-in-the-loop**: Approval workflows for sensitive operations
- **Skills**: On-demand loading of specialized capabilities

The agent harness provides these capabilities automatically - you configure, not implement.
</overview>

<when-to-use>

| Use Deep Agents When | Use LangChain's create_agent When |
|---------------------|-----------------------------------|
| Multi-step tasks requiring planning | Simple, single-purpose tasks |
| Large context requiring file management | Context fits in a single prompt |
| Need for specialized subagents | Single agent is sufficient |
| Persistent memory across sessions | Ephemeral, single-session work |

</when-to-use>

<middleware-selection>

| If you need to... | Middleware | Notes |
|------------------|------------|-------|
| Track complex tasks | TodoListMiddleware | Default enabled |
| Manage file context | FilesystemMiddleware | Configure backend |
| Delegate work | SubAgentMiddleware | Add custom subagents |
| Add human approval | HumanInTheLoopMiddleware | Requires checkpointer |
| Load skills | SkillsMiddleware | Provide skill directories |
| Access memory | MemoryMiddleware | Requires Store instance |

</middleware-selection>

<ex-basic-agent>
<python>
Create a basic deep agent with a custom tool and invoke it with a user message.
```python
from deepagents import create_deep_agent
from langchain.tools import tool

@tool
def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"It is always sunny in {city}"

agent = create_deep_agent(
    model="claude-sonnet-4-5-20250929",
    tools=[get_weather],
    system_prompt="You are a helpful assistant"
)

config = {"configurable": {"thread_id": "user-123"}}
result = agent.invoke({
    "messages": [{"role": "user", "content": "What's the weather in Tokyo?"}]
}, config=config)
```
</python>
<typescript>
Create a basic deep agent with a custom tool and invoke it with a user message.
```typescript
import { createDeepAgent } from "deepagents";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const getWeather = tool(
  async ({ city }) => `It is always sunny in ${city}`,
  { name: "get_weather", description: "Get weather for a city", schema: z.object({ city: z.string() }) }
);

const agent = await createDeepAgent({
  model: "claude-sonnet-4-5-20250929",
  tools: [getWeather],
  systemPrompt: "You are a helpful assistant"
});

const config = { configurable: { thread_id: "user-123" } };
const result = await agent.invoke({
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }]
}, config);
```
</typescript>
</ex-basic-agent>

<ex-full-configuration>
<python>
Configure a deep agent with all available options including subagents, skills, and persistence.
```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from langgraph.checkpoint.memory import MemorySaver
from langgraph.store.memory import InMemoryStore

agent = create_deep_agent(
    name="my-assistant",
    model="claude-sonnet-4-5-20250929",
    tools=[custom_tool1, custom_tool2],
    system_prompt="Custom instructions",
    subagents=[research_agent, code_agent],
    backend=FilesystemBackend(root_dir=".", virtual_mode=True),
    interrupt_on={"write_file": True},
    skills=["./skills/"],
    checkpointer=MemorySaver(),
    store=InMemoryStore()
)
```
</python>
<typescript>
Configure a deep agent with all available options including subagents, skills, and persistence.
```typescript
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { MemorySaver, InMemoryStore } from "@langchain/langgraph";

const agent = await createDeepAgent({
  name: "my-assistant",
  model: "claude-sonnet-4-5-20250929",
  tools: [customTool1, customTool2],
  systemPrompt: "Custom instructions",
  subagents: [researchAgent, codeAgent],
  backend: new FilesystemBackend({ rootDir: ".", virtualMode: true }),
  interruptOn: { write_file: true },
  skills: ["./skills/"],
  checkpointer: new MemorySaver(),
  store: new InMemoryStore()
});
```
</typescript>
</ex-full-configuration>

<built-in-tools>
Every deep agent has access to:

1. **Planning**: `write_todos` - Track multi-step tasks
2. **Filesystem**: `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`
3. **Delegation**: `task` - Spawn specialized subagents
</built-in-tools>

---

## SKILL.md Format

<skill-md-format>
Skills use **progressive disclosure** - agents only load content when relevant.

### Directory Structure
```
skills/
└── my-skill/
    ├── SKILL.md        # Required: main skill file
    ├── examples.py     # Optional: supporting files
    └── templates/      # Optional: templates
```

### SKILL.md Format
```markdown
---
name: my-skill
description: Clear, specific description of what this skill does
---

# Skill Name

## Overview
Brief explanation of the skill's purpose.

## When to Use
Conditions when this skill applies.

## Instructions
Step-by-step guidance for the agent.
```
</skill-md-format>

<skills-vs-memory>

| Skills | Memory (AGENTS.md) |
|--------|-------------------|
| On-demand loading | Always loaded at startup |
| Task-specific instructions | General preferences |
| Large documentation | Compact context |
| SKILL.md in directories | Single AGENTS.md file |

</skills-vs-memory>

<ex-skills-with-filesystem-backend>
<python>
Set up an agent with skills directory and filesystem backend for on-demand skill loading.
```python
from deepagents import create_deep_agent
from deepagents.backends import FilesystemBackend
from langgraph.checkpoint.memory import MemorySaver

agent = create_deep_agent(
    backend=FilesystemBackend(root_dir=".", virtual_mode=True),
    skills=["./skills/"],
    checkpointer=MemorySaver()
)

result = agent.invoke({
    "messages": [{"role": "user", "content": "Use the python-testing skill"}]
}, config={"configurable": {"thread_id": "session-1"}})
```
</python>
<typescript>
Set up an agent with skills directory and filesystem backend for on-demand skill loading.
```typescript
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";

const agent = await createDeepAgent({
  backend: new FilesystemBackend({ rootDir: ".", virtualMode: true }),
  skills: ["./skills/"],
  checkpointer: new MemorySaver()
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Use the python-testing skill" }]
}, { configurable: { thread_id: "session-1" } });
```
</typescript>
</ex-skills-with-filesystem-backend>

<ex-skills-with-store-backend>
<python>
Load skill content into a Store backend for environments without filesystem access.
```python
from deepagents import create_deep_agent
from deepagents.backends import StoreBackend
from deepagents.backends.utils import create_file_data
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()

# Load skill content into store
skill_content = """---
name: python-testing
description: Best practices for Python testing with pytest
---
# Python Testing Skill
..."""

store.put(
    namespace=("filesystem",),
    key="/skills/python-testing/SKILL.md",
    value=create_file_data(skill_content)
)

agent = create_deep_agent(
    backend=lambda rt: StoreBackend(rt),
    store=store,
    skills=["/skills/"]
)
```
</python>
</ex-skills-with-store-backend>

<boundaries>
### What Agents CAN Configure

- Model selection and parameters
- Additional custom tools
- System prompt customization
- Backend storage strategy
- Which tools require approval
- Custom subagents with specialized tools

### What Agents CANNOT Configure

- Core middleware removal (TodoList, Filesystem, SubAgent always present)
- The write_todos, task, or filesystem tool names
- The SKILL.md frontmatter format
</boundaries>

<fix-checkpointer-for-interrupts>
<python>
Interrupts require a checkpointer.
```python
# WRONG
agent = create_deep_agent(interrupt_on={"write_file": True})

# CORRECT
agent = create_deep_agent(interrupt_on={"write_file": True}, checkpointer=MemorySaver())
```
</python>
<typescript>
Interrupts require a checkpointer.
```typescript
// WRONG
const agent = await createDeepAgent({ interruptOn: { write_file: true } });

// CORRECT
const agent = await createDeepAgent({ interruptOn: { write_file: true }, checkpointer: new MemorySaver() });
```
</typescript>
</fix-checkpointer-for-interrupts>

<fix-store-for-memory>
<python>
StoreBackend requires a Store instance for persistent memory across threads.
```python
# WRONG
agent = create_deep_agent(backend=lambda rt: StoreBackend(rt))

# CORRECT
agent = create_deep_agent(backend=lambda rt: StoreBackend(rt), store=InMemoryStore())
```
</python>
<typescript>
StoreBackend requires a Store instance for persistent memory across threads.
```typescript
// WRONG
const agent = await createDeepAgent({ backend: (config) => new StoreBackend(config) });

// CORRECT
const agent = await createDeepAgent({ backend: (config) => new StoreBackend(config), store: new InMemoryStore() });
```
</typescript>
</fix-store-for-memory>

<fix-thread-id-for-conversations>
<python>
Use consistent thread_id to maintain conversation context across invocations.
```python
# WRONG: Each invocation is isolated
agent.invoke({"messages": [{"role": "user", "content": "Hi"}]})
agent.invoke({"messages": [{"role": "user", "content": "What did I say?"}]})

# CORRECT
config = {"configurable": {"thread_id": "user-123"}}
agent.invoke({"messages": [...]}, config=config)
agent.invoke({"messages": [...]}, config=config)
```
</python>
<typescript>
Use consistent thread_id to maintain conversation context across invocations.
```typescript
// WRONG: Each invocation is isolated
await agent.invoke({ messages: [{ role: "user", content: "Hi" }] });
await agent.invoke({ messages: [{ role: "user", content: "What did I say?" }] });

// CORRECT
const config = { configurable: { thread_id: "user-123" } };
await agent.invoke({ messages: [...] }, config);
await agent.invoke({ messages: [...] }, config);
```
</typescript>
</fix-thread-id-for-conversations>

<fix-frontmatter-required>
```markdown
# WRONG: Missing frontmatter in SKILL.md
# My Skill
This is my skill...

# CORRECT: Include YAML frontmatter
---
name: my-skill
description: Python testing best practices with pytest fixtures and mocking
---
# My Skill
This is my skill...
```
</fix-frontmatter-required>

<fix-backend-for-skills>
<python>
Skills require a proper backend to load from the filesystem.
```python
# WRONG: Skills won't load without proper backend
agent = create_deep_agent(skills=["./skills/"])

# CORRECT: Use FilesystemBackend for local skills
agent = create_deep_agent(
    backend=FilesystemBackend(root_dir=".", virtual_mode=True),
    skills=["./skills/"]
)
```
</python>
</fix-backend-for-skills>

<fix-specific-skill-descriptions>
Use specific descriptions to help agents decide when to use a skill.
```markdown
# WRONG: Vague description
---
name: helper
description: Helpful skill
---

# CORRECT: Specific description
---
name: python-testing
description: Python testing best practices with pytest fixtures, mocking, and async patterns
---
```
</fix-specific-skill-descriptions>

<fix-subagent-skills>
<python>
Skills are not inherited by subagents - provide them explicitly.
```python
# WRONG: Custom subagents don't inherit skills
agent = create_deep_agent(
    skills=["/main-skills/"],
    subagents=[{"name": "helper", ...}]  # No skills
)

# CORRECT: Provide skills explicitly
agent = create_deep_agent(
    skills=["/main-skills/"],
    subagents=[{"name": "helper", "skills": ["/helper-skills/"], ...}]
)
```
</python>
</fix-subagent-skills>
