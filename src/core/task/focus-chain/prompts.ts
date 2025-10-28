// Prompt for initial list creation
const initial = `
# TODO LIST CREATION REQUIRED - ACT MODE ACTIVATED

**You've just switched from PLAN MODE to ACT MODE!**

** IMMEDIATE ACTION REQUIRED:**
1. Create a comprehensive todo list in your NEXT tool call
2. Use the task_progress parameter to provide the list
3. Format each item using markdown checklist syntax:
	- [ ] For tasks to be done
	- [x] For any tasks already completed

**Your todo list should include:**
   - All major implementation steps
   - Testing and validation tasks
   - Documentation updates if needed
   - Final verification steps

**Example format:**\
   - [ ] Set up project structure
   - [ ] Implement core functionality
   - [ ] Add error handling
   - [ ] Write tests
   - [ ] Test implementation
   - [ ] Document changes

**Remember:** Keeping the todo list updated helps track progress and ensures nothing is missed.`

// For when recommending but not requiring a list
const listInstructionsRecommended = `
1. Include the task_progress parameter in your next tool call
2. Create a comprehensive checklist of all steps needed
3. Use markdown format: - [ ] for incomplete, - [x] for complete

**Benefits of creating a todo list now:**
	- Clear roadmap for implementation
	- Progress tracking throughout the task
	- Nothing gets forgotten or missed
	- Users can see, monitor, and edit the plan

**Example structure:**\`\`\`
- [ ] Analyze requirements
- [ ] Set up necessary files
- [ ] Implement main functionality
- [ ] Handle edge cases
- [ ] Test the implementation
- [ ] Verify results\`\`\`

Keeping the todo list updated helps track progress and ensures nothing is missed.`

// Prompt for reminders to update the list periodically
const reminder = `
1. To create or update a todo list, include the task_progress parameter in the next tool call
2. Review each item and update its status:
   - Mark completed items with: - [x]
   - Keep incomplete items as: - [ ]
   - Add new items if you discover additional steps
3. Modify the list as needed:
		- Add any new steps you've discovered
		- Reorder if the sequence has changed
4. Ensure the list accurately reflects the current state

**Remember:** Keeping the todo list updated helps track progress and ensures nothing is missed.`

const completed = `

**🎉 EXCELLENT! All {{totalItems}} items have been completed!**

**Completed Items:**
{{currentFocusChainChecklist}}

**Next Steps:**
- If the task is fully complete and meets all requirements, use attempt_completion
- If you've discovered additional work that wasn't in the original scope (new features, improvements, edge cases, etc.), create a new task_progress list with those items
- If there are related tasks or follow-up items the user might want, you can suggest them in a new checklist

**Remember:** Only use attempt_completion if you're confident the task is truly finished. If there's any remaining work, create a new focus chain list to track it.`

const planModeReminder = `
# Todo List (Optional - Plan Mode)

While in PLAN MODE, if you've outlined concrete steps or requirements for the user, you may include a preliminary todo list using the task_progress parameter.

Reminder on how to use the task_progress parameter:

${reminder}`

const recommended = `
# TODO LIST RECOMMENDED

When starting a new task, it is recommended to create a todo list.

${listInstructionsRecommended}
`

const apiRequestCount = `
# TODO LIST

You've made {{apiRequestCount}} API requests without a todo list. Consider creating one to track remaining work.

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
