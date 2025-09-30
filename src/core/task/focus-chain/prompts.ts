// Prompt for initial list creation
const initial = `\n
# TODO LIST CREATION REQUIRED - ACT MODE ACTIVATED\n
\n
**You've just switched from PLAN MODE to ACT MODE!**\n
\n
** IMMEDIATE ACTION REQUIRED:**\n
1. Create a comprehensive todo list in your NEXT tool call\n
2. Use the task_progress parameter to provide the list\n
3. Format each item using markdown checklist syntax:\n
	- [ ] For tasks to be done\n
	- [x] For any tasks already completed\n
\n
**Your todo list should include:**\n
   - All major implementation steps\n
   - Testing and validation tasks\n
   - Documentation updates if needed\n
   - Final verification steps\n
\n
**Example format:**\n\
   - [ ] Set up project structure\n
   - [ ] Implement core functionality\n
   - [ ] Add error handling\n-
   - [ ] Write tests\n
   - [ ] Test implementation\n
   - [ ] Document changes\n
\n
**Remember:** Keeping the todo list updated helps track progress and ensures nothing is missed.`

// For when recommending but not requiring a list
const listInstructionsRecommended = `\n
1. Include the task_progress parameter in your next tool call\n
2. Create a comprehensive checklist of all steps needed\n
3. Use markdown format: - [ ] for incomplete, - [x] for complete\n
\n
**Benefits of creating a todo list now:**\n
	- Clear roadmap for implementation\n
	- Progress tracking throughout the task\n
	- Nothing gets forgotten or missed\n
	- Users can see, monitor, and edit the plan\n
\n
**Example structure:**\n\`\`\`\n
- [ ] Analyze requirements\n
- [ ] Set up necessary files\n
- [ ] Implement main functionality\n
- [ ] Handle edge cases\n
- [ ] Test the implementation\n
- [ ] Verify results\n\`\`\`\n
\n
Keeping the todo list updated helps track progress and ensures nothing is missed.`

// Prompt for reminders to update the list periodically
const reminder = `\n
1. To create or update a todo list, include the task_progress parameter in the next tool call\n
2. Review each item and update its status:\n
   - Mark completed items with: - [x]\n
   - Keep incomplete items as: - [ ]\n
   - Add new items if you discover additional steps\n
3. Modify the list as needed:\n
		- Add any new steps you've discovered\n
		- Reorder if the sequence has changed\n
4. Ensure the list accurately reflects the current state\n
\n
**Remember:** Keeping the todo list updated helps track progress and ensures nothing is missed.`

const completed = `\n\n**🎉 EXCELLENT! All {{totalItems}} items have been completed!**

**Completed Items:**
{{currentFocusChainChecklist}}
currentFocusChainChecklist
**Next Steps:**
- If the task is fully complete and meets all requirements, use attempt_completion
- If you've discovered additional work that wasn't in the original scope (new features, improvements, edge cases, etc.), create a new task_progress list with those items
- If there are related tasks or follow-up items the user might want, you can suggest them in a new checklist

**Remember:** Only use attempt_completion if you're confident the task is truly finished. If there's any remaining work, create a new focus chain list to track it.`

const planModeReminder = `\n
# Todo List (Optional - Plan Mode)\n
\n
While in PLAN MODE, if you've outlined concrete steps or requirements for the user, you may include a preliminary todo list using the task_progress parameter.\n
Reminder on how to use the task_progress parameter:\n
${reminder}`

const recommended = `\n
			# TODO LIST RECOMMENDED
			When starting a new task, it is recommended to create a todo list.
			\n
			${listInstructionsRecommended}\n`

const apiRequestCount = `\n
			# TODO LIST \n
			You've made {{apiRequestCount}} API requests without a todo list. Consider creating one to track remaining work.\n
			\n
			${reminder}\n`

export const FocusChainPrompts = {
	initial,
	reminder,
	recommended,
	planModeReminder,
	completed,
	apiRequestCount,
}
