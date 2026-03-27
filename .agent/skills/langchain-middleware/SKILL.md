---
name: langchain-middleware
description: "INVOKE THIS SKILL when you need human-in-the-loop approval, custom middleware, or structured output. Covers HumanInTheLoopMiddleware for human approval of dangerous tool calls, creating custom middleware with hooks, Command resume patterns, and structured output with Pydantic/Zod."
---

<overview>
Middleware patterns for production LangChain agents:

- **HumanInTheLoopMiddleware** / **humanInTheLoopMiddleware**: Pause before dangerous tool calls for human approval
- **Custom middleware**: Intercept tool calls for error handling, logging, retry logic
- **Command resume**: Continue execution after human decisions (approve, edit, reject)

**Requirements:** Checkpointer + thread_id config for all HITL workflows.
</overview>

---

## Human-in-the-Loop

<ex-basic-hitl-setup>
<python>
Set up an agent with HITL middleware that pauses before sending emails for approval.
```python
from langchain.agents import create_agent
from langchain.agents.middleware import HumanInTheLoopMiddleware
from langgraph.checkpoint.memory import MemorySaver
from langchain.tools import tool

@tool
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email."""
    return f"Email sent to {to}"

agent = create_agent(
    model="gpt-4.1",
    tools=[send_email],
    checkpointer=MemorySaver(),  # Required for HITL
    middleware=[
        HumanInTheLoopMiddleware(
            interrupt_on={
                "send_email": {"allowed_decisions": ["approve", "edit", "reject"]},
            }
        )
    ],
)
```
</python>
<typescript>
Set up an agent with HITL that pauses before sending emails for human approval.
```typescript
import { createAgent, humanInTheLoopMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const sendEmail = tool(
  async ({ to, subject, body }) => `Email sent to ${to}`,
  {
    name: "send_email",
    description: "Send an email",
    schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  }
);

const agent = createAgent({
  model: "anthropic:claude-sonnet-4-5",
  tools: [sendEmail],
  checkpointer: new MemorySaver(),
  middleware: [
    humanInTheLoopMiddleware({
      interruptOn: { send_email: { allowedDecisions: ["approve", "edit", "reject"] } },
    }),
  ],
});
```
</typescript>
</ex-basic-hitl-setup>

<ex-running-with-interrupts>
<python>
Run the agent, detect an interrupt, then resume execution after human approval.
```python
from langgraph.types import Command

config = {"configurable": {"thread_id": "session-1"}}

# Step 1: Agent runs until it needs to call tool
result1 = agent.invoke({
    "messages": [{"role": "user", "content": "Send email to john@example.com"}]
}, config=config)

# Check for interrupt
if "__interrupt__" in result1:
    print(f"Waiting for approval: {result1['__interrupt__']}")

# Step 2: Human approves
result2 = agent.invoke(
    Command(resume={"decisions": [{"type": "approve"}]}),
    config=config
)
```
</python>
<typescript>
Run the agent, detect an interrupt, then resume execution after human approval.
```typescript
import { Command } from "@langchain/langgraph";

const config = { configurable: { thread_id: "session-1" } };

// Step 1: Agent runs until it needs to call tool
const result1 = await agent.invoke({
  messages: [{ role: "user", content: "Send email to john@example.com" }]
}, config);

// Check for interrupt
if (result1.__interrupt__) {
  console.log(`Waiting for approval: ${result1.__interrupt__}`);
}

// Step 2: Human approves
const result2 = await agent.invoke(
  new Command({ resume: { decisions: [{ type: "approve" }] } }),
  config
);
```
</typescript>
</ex-running-with-interrupts>

<ex-editing-tool-arguments>
<python>
Edit the tool arguments before approving when the original values need correction.
```python
# Human edits the arguments — edited_action must include name + args
result2 = agent.invoke(
    Command(resume={
        "decisions": [{
            "type": "edit",
            "edited_action": {
                "name": "send_email",
                "args": {
                    "to": "alice@company.com",  # Fixed email
                    "subject": "Project Meeting - Updated",
                    "body": "...",
                },
            },
        }]
    }),
    config=config
)
```
</python>
<typescript>
Edit the tool arguments before approving when the original values need correction.
```typescript
// Human edits the arguments — editedAction must include name + args
const result2 = await agent.invoke(
  new Command({
    resume: {
      decisions: [{
        type: "edit",
        editedAction: {
          name: "send_email",
          args: {
            to: "alice@company.com",  // Fixed email
            subject: "Project Meeting - Updated",
            body: "...",
          },
        },
      }]
    }
  }),
  config
);
```
</typescript>
</ex-editing-tool-arguments>

<ex-rejecting-with-feedback>
<python>
Reject a tool call and provide feedback explaining why it was rejected.
```python
# Human rejects
result2 = agent.invoke(
    Command(resume={
        "decisions": [{
            "type": "reject",
            "feedback": "Cannot delete customer data without manager approval",
        }]
    }),
    config=config
)
```
</python>
</ex-rejecting-with-feedback>

<ex-multiple-tools-different-policies>
<python>
Configure different HITL policies for each tool based on risk level.
```python
agent = create_agent(
    model="gpt-4.1",
    tools=[send_email, read_email, delete_email],
    checkpointer=MemorySaver(),
    middleware=[
        HumanInTheLoopMiddleware(
            interrupt_on={
                "send_email": {"allowed_decisions": ["approve", "edit", "reject"]},
                "delete_email": {"allowed_decisions": ["approve", "reject"]},  # No edit
                "read_email": False,  # No HITL for reading
            }
        )
    ],
)
```
</python>
</ex-multiple-tools-different-policies>

<boundaries>
### What You CAN Configure

- Which tools require approval (per-tool policies)
- Allowed decisions per tool (approve, edit, reject)
- Custom middleware hooks: `before_model`, `after_model`, `wrap_tool_call`, `before_agent`, `after_agent`
- Tool-specific middleware (apply only to certain tools)

### What You CANNOT Configure

- Interrupt after tool execution (must be before)
- Skip checkpointer requirement for HITL
</boundaries>

<fix-missing-checkpointer>
<python>
HITL middleware requires a checkpointer to persist state.
```python
# WRONG
agent = create_agent(model="gpt-4.1", tools=[send_email], middleware=[HumanInTheLoopMiddleware({...})])

# CORRECT
agent = create_agent(
    model="gpt-4.1", tools=[send_email],
    checkpointer=MemorySaver(),  # Required
    middleware=[HumanInTheLoopMiddleware({...})]
)
```
</python>
<typescript>
HITL requires a checkpointer to persist state.
```typescript
// WRONG: No checkpointer
const agent = createAgent({
  model: "anthropic:claude-sonnet-4-5", tools: [sendEmail],
  middleware: [humanInTheLoopMiddleware({ interruptOn: { send_email: true } })],
});

// CORRECT: Add checkpointer
const agent = createAgent({
  model: "anthropic:claude-sonnet-4-5", tools: [sendEmail],
  checkpointer: new MemorySaver(),
  middleware: [humanInTheLoopMiddleware({ interruptOn: { send_email: true } })],
});
```
</typescript>
</fix-missing-checkpointer>

<fix-no-thread-id>
<python>
Always provide thread_id when using HITL to track conversation state.
```python
# WRONG
agent.invoke(input)  # No config!

# CORRECT
agent.invoke(input, config={"configurable": {"thread_id": "user-123"}})
```
</python>
</fix-no-thread-id>

<fix-wrong-resume-syntax>
<python>
Use Command class to resume execution after an interrupt.
```python
# WRONG
agent.invoke({"resume": {"decisions": [...]}})

# CORRECT
from langgraph.types import Command
agent.invoke(Command(resume={"decisions": [{"type": "approve"}]}), config=config)
```
</python>
<typescript>
Use Command class to resume execution after an interrupt.
```typescript
// WRONG
await agent.invoke({ resume: { decisions: [...] } });

// CORRECT
import { Command } from "@langchain/langgraph";
await agent.invoke(new Command({ resume: { decisions: [{ type: "approve" }] } }), config);
```
</typescript>
</fix-wrong-resume-syntax>
