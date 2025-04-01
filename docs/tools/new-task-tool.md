# New Task Tool

The `new_task` tool allows Cline to create a new task with preloaded context. This is particularly useful for managing context window limitations and creating focused subtasks.

## Overview

When the context window is approaching capacity or when you want to create a focused subtask, Cline can suggest creating a new task with relevant context preloaded. This helps maintain continuity between tasks while keeping each task focused and efficient.

## How It Works

1. Cline uses the `new_task` tool to suggest creating a new task with specific context
2. You'll see a preview of the context that will be preloaded into the new task
3. You can choose to:
   - Click "Create New Task" to start a new task with the preloaded context in Plan Mode
   - Respond with a message to continue the current conversation (effectively declining the new task)

## Use Cases

### Context Window Management

As conversations get longer, the context window may approach capacity. Cline can proactively suggest creating a new task with relevant context to continue the work without losing important information.

```
Cline: I notice our conversation is getting quite long. Would you like me to create a new task with the relevant context to continue our work on the authentication system?

<new_task>
We've been working on implementing an authentication system for the web application. So far, we've:
1. Set up the basic user model
2. Implemented password hashing with bcrypt
3. Created login and registration endpoints

Next steps:
- Implement JWT token generation
- Add token validation middleware
- Set up refresh token functionality
</new_task>
```

### Breaking Down Complex Tasks

For complex projects, you can break down the work into focused subtasks, with each new task containing the relevant context from the previous work.

```
Cline: Now that we've completed the backend API, let's focus on the frontend implementation. I'll create a new task for this:

<new_task>
We've completed the backend API for our task management application with the following endpoints:
- GET /api/tasks - List all tasks
- POST /api/tasks - Create a new task
- PUT /api/tasks/:id - Update a task
- DELETE /api/tasks/:id - Delete a task

Now we need to implement the React frontend that will consume these endpoints.
</new_task>
```

### Maintaining Workflow Continuity

When you need to pause work on one aspect of a project and return to it later, Cline can help you create a new task with the necessary context to pick up where you left off.

```
Cline: Let's save our progress on the database schema design so we can come back to it later:

<new_task>
Database schema design for e-commerce application:
- Users table: id, email, password_hash, name, created_at, updated_at
- Products table: id, name, description, price, inventory_count, category_id
- Categories table: id, name, parent_category_id
- Orders table: id, user_id, status, total, created_at, updated_at
- OrderItems table: id, order_id, product_id, quantity, price

We still need to design:
- Payment processing tables
- Shipping information tables
- Review and rating tables
</new_task>
```

## Best Practices

- **Be Selective**: Only include relevant context in the new task to keep it focused
- **Summarize**: Summarize previous work rather than copying everything verbatim
- **Include Next Steps**: Clearly indicate what needs to be done in the new task
- **Maintain Continuity**: Ensure the new task has enough context to continue the work without confusion

## Implementation Details

The `new_task` tool is implemented as part of Cline's tool system. When used, it presents a UI component with a preview of the context and a button to create the new task. The new task is created in Plan Mode, allowing you to review and refine the approach before switching to Act Mode for implementation.
