---
name: langgraph-human-in-the-loop
description: "INVOKE THIS SKILL when implementing human-in-the-loop patterns, pausing for approval, or handling errors in LangGraph. Covers interrupt(), Command(resume=...), approval/validation workflows, and the 4-tier error handling strategy."
---

<overview>
LangGraph's human-in-the-loop patterns let you pause graph execution, surface data to users, and resume with their input:

- **`interrupt(value)`** — pauses execution, surfaces a value to the caller
- **`Command(resume=value)`** — resumes execution, providing the value back to `interrupt()`
- **Checkpointer** — required to save state while paused
- **Thread ID** — required to identify which paused execution to resume
</overview>

---

## Requirements

Three things are required for interrupts to work:

1. **Checkpointer** — compile with `checkpointer=InMemorySaver()` (dev) or `PostgresSaver` (prod)
2. **Thread ID** — pass `{"configurable": {"thread_id": "..."}}` to every `invoke`/`stream` call
3. **JSON-serializable payload** — the value passed to `interrupt()` must be JSON-serializable

---

## Basic Interrupt + Resume

`interrupt(value)` pauses the graph. The value surfaces in the result under `__interrupt__`. `Command(resume=value)` resumes — the resume value becomes the return value of `interrupt()`.

**Critical**: when the graph resumes, the node restarts from the **beginning** — all code before `interrupt()` re-runs.

<ex-basic-interrupt-resume>
<python>
Pause execution for human review and resume with Command.
```python
from langgraph.types import interrupt, Command
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import StateGraph, START, END
from typing_extensions import TypedDict

class State(TypedDict):
    approved: bool

def approval_node(state: State):
    # Pause and ask for approval
    approved = interrupt("Do you approve this action?")
    # When resumed, Command(resume=...) returns that value here
    return {"approved": approved}

checkpointer = InMemorySaver()
graph = (
    StateGraph(State)
    .add_node("approval", approval_node)
    .add_edge(START, "approval")
    .add_edge("approval", END)
    .compile(checkpointer=checkpointer)
)

config = {"configurable": {"thread_id": "thread-1"}}

# Initial run — hits interrupt and pauses
result = graph.invoke({"approved": False}, config)
print(result["__interrupt__"])
# [Interrupt(value='Do you approve this action?')]

# Resume with the human's response
result = graph.invoke(Command(resume=True), config)
print(result["approved"])  # True
```
</python>
<typescript>
Pause execution for human review and resume with Command.
```typescript
import { interrupt, Command, MemorySaver, StateGraph, StateSchema, START, END } from "@langchain/langgraph";
import { z } from "zod";

const State = new StateSchema({
  approved: z.boolean().default(false),
});

const approvalNode = async (state: typeof State.State) => {
  // Pause and ask for approval
  const approved = interrupt("Do you approve this action?");
  // When resumed, Command({ resume }) returns that value here
  return { approved };
};

const checkpointer = new MemorySaver();
const graph = new StateGraph(State)
  .addNode("approval", approvalNode)
  .addEdge(START, "approval")
  .addEdge("approval", END)
  .compile({ checkpointer });

const config = { configurable: { thread_id: "thread-1" } };

// Initial run — hits interrupt and pauses
let result = await graph.invoke({ approved: false }, config);
console.log(result.__interrupt__);
// [{ value: 'Do you approve this action?', ... }]

// Resume with the human's response
result = await graph.invoke(new Command({ resume: true }), config);
console.log(result.approved);  // true
```
</typescript>
</ex-basic-interrupt-resume>

---

## Approval Workflow

A common pattern: interrupt to show a draft, then route based on the human's decision.

<ex-approval-workflow>
<python>
Interrupt for human review, then route to send or end based on the decision.
```python
from langgraph.types import interrupt, Command
from langgraph.graph import StateGraph, START, END
from typing import Literal
from typing_extensions import TypedDict

class EmailAgentState(TypedDict):
    email_content: str
    draft_response: str
    classification: dict

def human_review(state: EmailAgentState) -> Command[Literal["send_reply", "__end__"]]:
    """Pause for human review using interrupt and route based on decision."""
    classification = state.get("classification", {})

    # interrupt() must come first — any code before it will re-run on resume
    human_decision = interrupt({
        "email_id": state.get("email_content", ""),
        "draft_response": state.get("draft_response", ""),
        "urgency": classification.get("urgency"),
        "action": "Please review and approve/edit this response"
    })

    # Process the human's decision
    if human_decision.get("approved"):
        return Command(
            update={"draft_response": human_decision.get("edited_response", state.get("draft_response", ""))},
            goto="send_reply"
        )
    else:
        # Rejection — human will handle directly
        return Command(update={}, goto=END)
```
</python>
<typescript>
Interrupt for human review, then route to send or end based on the decision.
```typescript
import { interrupt, Command, END, GraphNode } from "@langchain/langgraph";

const humanReview: GraphNode<typeof EmailAgentState> = async (state) => {
  const classification = state.classification!;

  // interrupt() must come first — any code before it will re-run on resume
  const humanDecision = interrupt({
    emailId: state.emailContent,
    draftResponse: state.responseText,
    urgency: classification.urgency,
    action: "Please review and approve/edit this response",
  });

  // Process the human's decision
  if (humanDecision.approved) {
    return new Command({
      update: { responseText: humanDecision.editedResponse || state.responseText },
      goto: "sendReply",
    });
  } else {
    return new Command({ update: {}, goto: END });
  }
};
```
</typescript>
</ex-approval-workflow>

---

## Validation Loop

Use `interrupt()` in a loop to validate human input and re-prompt if invalid.

<ex-validation-loop>
<python>
Validate human input in a loop, re-prompting until valid.
```python
from langgraph.types import interrupt

def get_age_node(state):
    prompt = "What is your age?"

    while True:
        answer = interrupt(prompt)

        # Validate the input
        if isinstance(answer, int) and answer > 0:
            break
        else:
            # Invalid input — ask again with a more specific prompt
            prompt = f"'{answer}' is not a valid age. Please enter a positive number."

    return {"age": answer}
```

Each `Command(resume=...)` call provides the next answer. If invalid, the loop re-interrupts with a clearer message.
```python
config = {"configurable": {"thread_id": "form-1"}}
first = graph.invoke({"age": None}, config)
# __interrupt__: "What is your age?"

retry = graph.invoke(Command(resume="thirty"), config)
# __interrupt__: "'thirty' is not a valid age..."

final = graph.invoke(Command(resume=30), config)
print(final["age"])  # 30
```
</python>
<typescript>
Validate human input in a loop, re-prompting until valid.
```typescript
import { interrupt } from "@langchain/langgraph";

const getAgeNode = (state: typeof State.State) => {
  let prompt = "What is your age?";

  while (true) {
    const answer = interrupt(prompt);

    // Validate the input
    if (typeof answer === "number" && answer > 0) {
      return { age: answer };
    } else {
      // Invalid input — ask again with a more specific prompt
      prompt = `'${answer}' is not a valid age. Please enter a positive number.`;
    }
  }
};
```
</typescript>
</ex-validation-loop>

---

## Multiple Interrupts

When parallel branches each call `interrupt()`, resume all of them in a single invocation by mapping each interrupt ID to its resume value.

<ex-multiple-interrupts>
<python>
Resume multiple parallel interrupts by mapping interrupt IDs to values.
```python
from typing import Annotated, TypedDict
import operator
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, END, StateGraph
from langgraph.types import Command, interrupt

class State(TypedDict):
    vals: Annotated[list[str], operator.add]

def node_a(state):
    answer = interrupt("question_a")
    return {"vals": [f"a:{answer}"]}

def node_b(state):
    answer = interrupt("question_b")
    return {"vals": [f"b:{answer}"]}

graph = (
    StateGraph(State)
    .add_node("a", node_a)
    .add_node("b", node_b)
    .add_edge(START, "a")
    .add_edge(START, "b")
    .add_edge("a", END)
    .add_edge("b", END)
    .compile(checkpointer=InMemorySaver())
)

config = {"configurable": {"thread_id": "1"}}

# Both parallel nodes hit interrupt() and pause
result = graph.invoke({"vals": []}, config)
# result["__interrupt__"] contains both Interrupt objects with IDs

# Resume all pending interrupts at once using a map of id -> value
resume_map = {
    i.id: f"answer for {i.value}"
    for i in result["__interrupt__"]
}
result = graph.invoke(Command(resume=resume_map), config)
# result["vals"] = ["a:answer for question_a", "b:answer for question_b"]
```
</python>
<typescript>
Resume multiple parallel interrupts by mapping interrupt IDs to values.
```typescript
import { Command, END, MemorySaver, START, StateGraph, interrupt, isInterrupted, INTERRUPT, Annotation } from "@langchain/langgraph";

const State = Annotation.Root({
  vals: Annotation<string[]>({
    reducer: (left, right) => left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),
});

function nodeA(_state: typeof State.State) {
  const answer = interrupt("question_a") as string;
  return { vals: [`a:${answer}`] };
}

function nodeB(_state: typeof State.State) {
  const answer = interrupt("question_b") as string;
  return { vals: [`b:${answer}`] };
}

const graph = new StateGraph(State)
  .addNode("a", nodeA)
  .addNode("b", nodeB)
  .addEdge(START, "a")
  .addEdge(START, "b")
  .addEdge("a", END)
  .addEdge("b", END)
  .compile({ checkpointer: new MemorySaver() });

const config = { configurable: { thread_id: "1" } };

const interruptedResult = await graph.invoke({ vals: [] }, config);

// Resume all pending interrupts at once
const resumeMap: Record<string, string> = {};
if (isInterrupted(interruptedResult)) {
  for (const i of interruptedResult[INTERRUPT]) {
    if (i.id != null) {
      resumeMap[i.id] = `answer for ${i.value}`;
    }
  }
}
const result = await graph.invoke(new Command({ resume: resumeMap }), config);
// result.vals = ["a:answer for question_a", "b:answer for question_b"]
```
</typescript>
</ex-multiple-interrupts>

User-fixable errors use `interrupt()` to pause and collect missing data — that's the pattern covered by this skill. For the full 4-tier error handling strategy (RetryPolicy, Command error loops, etc.), see the **fundamentals** skill.

---

## Side Effects Before Interrupt Must Be Idempotent

When the graph resumes, the node restarts from the **beginning** — ALL code before `interrupt()` re-runs. In subgraphs, BOTH the parent node and the subgraph node re-execute.

<idempotency-rules>

**Do:**
- Use **upsert** (not insert) operations before `interrupt()`
- Use **check-before-create** patterns
- Place side effects **after** `interrupt()` when possible
- Separate side effects into their own nodes

**Don't:**
- Create new records before `interrupt()` — duplicates on each resume
- Append to lists before `interrupt()` — duplicate entries on each resume

</idempotency-rules>

<ex-idempotent-patterns>
<python>
Idempotent operations before interrupt vs non-idempotent (wrong).
```python
# GOOD: Upsert is idempotent — safe before interrupt
def node_a(state: State):
    db.upsert_user(user_id=state["user_id"], status="pending_approval")
    approved = interrupt("Approve this change?")
    return {"approved": approved}

# GOOD: Side effect AFTER interrupt — only runs once
def node_a(state: State):
    approved = interrupt("Approve this change?")
    if approved:
        db.create_audit_log(user_id=state["user_id"], action="approved")
    return {"approved": approved}

# BAD: Insert creates duplicates on each resume!
def node_a(state: State):
    audit_id = db.create_audit_log({  # Runs again on resume!
        "user_id": state["user_id"],
        "action": "pending_approval",
    })
    approved = interrupt("Approve this change?")
    return {"approved": approved}
```
</python>
<typescript>
Idempotent operations before interrupt vs non-idempotent (wrong).
```typescript
// GOOD: Upsert is idempotent — safe before interrupt
const nodeA = async (state: typeof State.State) => {
  await db.upsertUser({ userId: state.userId, status: "pending_approval" });
  const approved = interrupt("Approve this change?");
  return { approved };
};

// GOOD: Side effect AFTER interrupt — only runs once
const nodeA = async (state: typeof State.State) => {
  const approved = interrupt("Approve this change?");
  if (approved) {
    await db.createAuditLog({ userId: state.userId, action: "approved" });
  }
  return { approved };
};

// BAD: Insert creates duplicates on each resume!
const nodeA = async (state: typeof State.State) => {
  await db.createAuditLog({  // Runs again on resume!
    userId: state.userId,
    action: "pending_approval",
  });
  const approved = interrupt("Approve this change?");
  return { approved };
};
```
</typescript>
</ex-idempotent-patterns>

<subgraph-interrupt-re-execution>

### Subgraph re-execution on resume

When a subgraph contains an `interrupt()`, resuming re-executes BOTH the parent node (that invoked the subgraph) AND the subgraph node (that called `interrupt()`):

<python>
```python
def node_in_parent_graph(state: State):
    some_code()  # <-- Re-executes on resume
    subgraph_result = subgraph.invoke(some_input)
    # ...

def node_in_subgraph(state: State):
    some_other_code()  # <-- Also re-executes on resume
    result = interrupt("What's your name?")
    # ...
```
</python>
<typescript>
```typescript
async function nodeInParentGraph(state: State) {
  someCode();  // <-- Re-executes on resume
  const subgraphResult = await subgraph.invoke(someInput);
  // ...
}

async function nodeInSubgraph(state: State) {
  someOtherCode();  // <-- Also re-executes on resume
  const result = interrupt("What's your name?");
  // ...
}
```
</typescript>
</subgraph-interrupt-re-execution>

---

## Command(resume) Warning

`Command(resume=...)` is the **only** Command pattern intended as input to `invoke()`/`stream()`. Do NOT pass `Command(update=...)` as input — it resumes from the latest checkpoint and the graph appears stuck. See the fundamentals skill for the full antipattern explanation.

---

## Fixes

<fix-checkpointer-required-for-interrupts>
<python>
Checkpointer required for interrupt functionality.
```python
# WRONG
graph = builder.compile()

# CORRECT
graph = builder.compile(checkpointer=InMemorySaver())
```
</python>
<typescript>
Checkpointer required for interrupt functionality.
```typescript
// WRONG
const graph = builder.compile();

// CORRECT
const graph = builder.compile({ checkpointer: new MemorySaver() });
```
</typescript>
</fix-checkpointer-required-for-interrupts>

<fix-resume-with-command>
<python>
Use Command to resume from an interrupt (regular dict restarts graph).
```python
# WRONG
graph.invoke({"resume_data": "approve"}, config)

# CORRECT
graph.invoke(Command(resume="approve"), config)
```
</python>
<typescript>
Use Command to resume from an interrupt (regular object restarts graph).
```typescript
// WRONG
await graph.invoke({ resumeData: "approve" }, config);

// CORRECT
await graph.invoke(new Command({ resume: "approve" }), config);
```
</typescript>
</fix-resume-with-command>

<boundaries>
### What You Should NOT Do

- Use interrupts without a checkpointer — will fail
- Resume without the same thread_id — creates a new thread instead of resuming
- Pass `Command(update=...)` as invoke input — graph appears stuck (use plain dict)
- Perform non-idempotent side effects before `interrupt()` — creates duplicates on resume
- Assume code before `interrupt()` only runs once — it re-runs every resume
</boundaries>
