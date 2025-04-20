export const newTaskToolResponse = () =>
	`<explicit_instructions type="new_task">
The user has explicitly asked you to help them create a new task with preloaded context, which you will create. In this message the user has potentially added instructions or context which you should consider, if given, when creating the new task.
Irrespective of whether additional information or instructions are given, you are only allowed to respond to this message by calling the new_task tool.

To refresh your memory, the tool definition for new_task and an example for calling the tool is described below:

## new_task tool definition:

Description: Request to create a new task with preloaded context. The user will be presented with a preview of the context and can choose to create a new task or keep chatting in the current conversation. The user may choose to start a new task at any point.
Parameters:
- context: (required) The context to preload the new task with. This should include:
  * Comprehensively explain what has been accomplished in the current task - mention specific file names that are relevant
  * The specific next steps or focus for the new task - mention specific file names that are relevant
  * Any critical information needed to continue the work
  * Clear indication of how this new task relates to the overall workflow
  * This should be akin to a long handoff file, enough for a totally new developer to be able to pick up where you left off and know exactly what to do next and which files to look at.
Usage:
<new_task>
<context>context to preload new task with</context>
</new_task>

## Tool use example:

<new_task>
<context>
Authentication System Implementation:
- We've implemented the basic user model with email/password
- Password hashing is working with bcrypt
- Login endpoint is functional with proper validation
- JWT token generation is implemented

Next Steps:
- Implement refresh token functionality
- Add token validation middleware
- Create password reset flow
- Implement role-based access control
</context>
</new_task>

Below is the the user's input when they indicated that they wanted to create a new task.
</explicit_instructions>\n
`
