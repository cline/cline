// Prompt for initial list creation
const initial = `
# task_progress CREATION REQUIRED - ACT MODE ACTIVATED

**You've just switched from PLAN MODE to ACT MODE!**

** IMMEDIATE ACTION REQUIRED:**
1. Create a detailed execution plan in your NEXT tool call
2. Use the task_progress parameter to provide the plan as a JSON object
3. The JSON must follow this structure:
{
  "steps": [
    {
      "id": "unique_id",
      "description": "Step description",
      "status": "pending" | "in_progress" | "completed" | "failed"
    }
  ]
}

**Your plan should include:**
   - All major implementation steps
   - Testing and validation tasks
   - Documentation updates if needed
   - Final verification steps

**Example:**
{
  "steps": [
    { "id": "1", "description": "Set up project structure", "status": "completed" },
    { "id": "2", "description": "Implement core functionality", "status": "pending" }
  ]
}

**Remember:** Keeping the task_progress plan updated helps track progress and ensures nothing is missed.`

// For when recommending but not requiring a list
const listInstructionsRecommended = `
1. Include a plan using the task_progress parameter in your next tool call
2. Create a comprehensive plan of all steps needed
3. Use JSON format:
{
  "steps": [
    { "id": "1", "description": "Step 1", "status": "pending" }
  ]
}

**Benefits of creating a plan now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

Keeping the task_progress updated helps track progress and ensures nothing is missed.`

// Prompt for reminders to update the list periodically
const reminder = `
1. To create or update the plan, include the task_progress parameter in the next tool call
2. Update the status of existing steps:
   - Mark completed items as "completed"
   - Update in-progress items to "in_progress"
   - Add new steps if you discover additional work
3. Ensure the JSON structure is valid
{
  "steps": [...]
}

**Remember:** Keeping the task_progress plan updated helps track progress and ensures nothing is missed.`

const completed = `

**All {{totalItems}} items have been completed!**

**Completed Items:**
{{currentFocusChainChecklist}}

**Next Steps:**
- If the task is fully complete and meets all requirements, use attempt_completion
- If you've discovered additional work that wasn't in the original scope (new features, improvements, edge cases, etc.), create a new plan with those items
- If there are related tasks or follow-up items the user might want, you can suggest them

**Remember:** Only use attempt_completion if you're confident the task is truly finished.`

const planModeReminder = `
# task_progress Plan (Optional - Plan Mode)

While in PLAN MODE, if you've outlined concrete steps or requirements for the user, you may include a preliminary plan using the task_progress parameter.

Reminder on how to use the task_progress parameter:

${reminder}`

const recommended = `
# task_progress RECOMMENDED

When starting a new task, it is recommended to include a plan using the task_progress parameter.

${listInstructionsRecommended}
`

const apiRequestCount = `
# task_progress

You've made {{apiRequestCount}} API requests without a task_progress parameter. It is strongly recomended that you create one to track remaining work.

${reminder}
`

export const FocusChainPrompts = {
	initial,
	reminder,
	recommended,
	planModeReminder,
	completed,
	apiRequestCount,
}
