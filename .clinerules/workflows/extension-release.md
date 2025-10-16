The goal of this workflow is to take a changeset for a release of Cline, an autonomous coding agent extension that plugs right into your IDE, and write the updated announcement component, and the updated changelog. 


For reference, here are some examples of how we converted previous changesets to announcement components / changelogs. 


- 3.14
<changeset>
This PR was opened by the Changesets release GitHub action. When you're ready to do a release, you can merge this and publish to npm yourself or setup this action to publish automatically. If you're not ready to do a release yet, that's fine, whenever you add more changesets to main, this PR will be updated.

Releases
claude-dev@3.14.0
Minor Changes
77c9863: create clinerules folder if its currently a file and creating new rule
0ffb7dd: disabling shift hint for now & improving tooltip behavior
79b76fd: Add support for custom model ID in AWS Bedrock provider, enabling use of Application Inference Profile.
eb6e481: Full support for LaTeX rendering
df37f29: Add support for custom API request timeout. Previously, timeouts were hardcoded to 30 seconds for providers like Ollama or 15 seconds for OpenRouter and Cline. Now users can set a custom timeout value in milliseconds through the settings interface.
e4d26be: allow cursorrules and windsurfrules
c5de50f: Fix Handle @withRetry() SyntaxError when running extension locally issue
61d2f42: enabled pricing calculation for gemini and vertex + more robust caching & cache tracking for gemini & vertex
aed152b: add truncation notice when truncating manually
2fe2405: Migrate Cline Tools Section to new docs
19cc8bc: Add a timeout setting for the terminal connection, allowing users to adjust this if they are having timeout issues
03d4410: Added copy button to code blocks.
c78fe23: addressed race condition in terminal command usage
91e222f: add checkpoints after more messages
14230e7: add newrule slash command
1c7d33a: Add remote config with posthog allowing for disabling new features until they're reading, making for a better developer experience.
4196c14: add cache ui for open router and cline provider
d97424f: showing expanded task by default
5294e78: Refactor to not pass a message for showing the MCP View from the servers modal
70cc437: Fix Windows path issue: Correct handling of import.meta.url to avoid leading slash in pathname
4b697d8: Migrate the addRemoteServer to protobus
Patch Changes
c63d9a1: updated drag and drop text to say "drop" instead of "drag"
459adf0: Add markdown copy to chat
74ec823: Minor UX improvement to drag and drop ux
b0961f4: Remove linear pull request action
e9ce384: searchCommits protobus migration
5802b68: createRuleFile protobus migration
df7f9fc: Add dependsOn to more blocks in the tasks.json
41ae732: Fix for git commit mentions in repos with no git commits
7e78445: Adding args to allow Cursor to open workspaces (for checkpoint testing/development)
bdfda6f: feat(bedrock): Introduce Amazon Nova Premier
65243ad: Introduce UI library for future UI development
4565e06: checkIsImageURL migrated to protobus
5a8e9d8: protobus migration for openImage
deeda6e: Lowering Gemini cache TTL time
db0b022: Adding UI to show openrouter balance next to provider
4650ffa: deleteRuleFile protobus migration
d4bd755: fix cost calculation
</changeset>

<changelog>
## [3.14.0]

-   Add UI to show openrouter balance next to provider
-   Add support for custom model ID in AWS Bedrock provider, enabling use of Application Inference Profile (Thanks @clicube!)
-   Add more robust caching & cache tracking for gemini & vertex providers
-   Add support for LaTeX rendering
-   Add support for custom API request timeout. Timeouts were 15-30s, but can now be configured via settings for OpenRouter/Cline & Ollama (Thanks @WingsDrafterwork!)
-   Add truncation notice when truncating manually
-   Add a timeout setting for the terminal connection, allowing users to set a time to wait for terminal startup
-   Add copy button to code blocks
-   Add copy button to markdown blocks (Thanks @weshoke!)
-   Add checkpoints to more messages
-   Add slash command to create a new rules file (/newrule)
-   Add cache ui for open router and cline provider
-   Add Amazon Nova Premier model to Bedrock (Thanks @watany!)
-   Add support for cursorrules and windsurfrules
-   Add support for batch history deletion (Thanks @danix800!)
-   Improve Drag & Drop experience
-   Create clinerules folder creating new rule if it's needed
-   Enable pricing calculation for gemini and vertex providers
-   Refactor message handling to not show the MCP View of the server modal
-   Migrate the addRemoteServer to protobus (Thanks @DaveFres!)
-   Update task header to be expanded by default
-   Update Gemini cache TTL time to 15 minutes
-   Fix race condition in terminal command usage
-   Fix to correctly handle `import.meta.url`, avoiding leading slash in pathname for Windows (Thanks @DaveFres!)
-   Fix @withRetry() decoration syntax error when running extension locally (Thanks @DaveFres!)
-   Fix for git commit mentions in repos with no git commits
-   Fix cost calculation (Thanks @BarreiroT!)
</changelog>


<announcement-component>
const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
	const minorVersion = version.split(".").slice(0, 2).join(".") // 2.0.0 -> 2.0
	return (
		<div style={containerStyle}>
			<VSCodeButton appearance="icon" onClick={hideAnnouncement} style={closeIconStyle}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h3 style={h3TitleStyle}>
				🎉{"  "}New in v{minorVersion}
			</h3>
			<ul style={ulStyle}>
				<li>
					<b>Gemini prompt caching:</b> Gemini and Vertex providers now support prompt caching and price tracking for
					Gemini models.
				</li>
				<li>
					<b>Copy Buttons:</b> Buttons were added to Markdown and Code blocks that allow you to copy their contents
					easily.
				</li>
				<li>
					<b>/newrule command:</b> New slash command to have cline write your .clinerules for you based on your
					workflow.
				</li>
				<li>
					<b>Drag and drop improvements:</b> Don't forget to hold shift while dragging files!
				</li>
				<li>Added more checkpoints across the task, allowing you to restore from more than just file changes.</li>
				<li>Added support for rendering LaTeX in message responses. (Try asking Cline to show the quadratic formula)</li>
			</ul>
			<Accordion isCompact className="pl-0">
				<AccordionItem
					key="1"
					aria-label="Previous Updates"
					title="Previous Updates:"
					classNames={{
						trigger: "bg-transparent border-0 pl-0 pb-0 w-fit",
						title: "font-bold text-(--vscode-foreground)",
						indicator:
							"text-(--vscode-foreground) mb-0.5 -rotate-180 data-[open=true]:-rotate-90 rtl:rotate-0 rtl:data-[open=true]:-rotate-90",
					}}>
					<ul style={ulStyle}>
						<li>
							<b>Global Cline Rules:</b> store multiple rules files in Documents/Cline/Rules to share between
							projects.
						</li>
						<li>
							<b>Cline Rules Popup:</b> New button in the chat area to view workspace and global cline rules files
							to plug and play specific rules for the task
						</li>
						<li>
							<b>Slash Commands:</b> Type <code>/</code> in chat to see the list of quick actions, like starting a
							new task (more coming soon!)
						</li>
						<li>
							<b>Edit Messages:</b> You can now edit a message you sent previously by clicking on it. Optionally
							restore your project when the message was sent!
						</li>
					</ul>
				</AccordionItem>
			</Accordion>

			{/*
			// Leave this here for an example of how to structure the announcement
			<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				 <li>
					OpenRouter now supports prompt caching! They also have much higher rate limits than other providers,
					so I recommend trying them out.
					<br />
					{!apiConfiguration?.openRouterApiKey && (
						<VSCodeButtonLink
							href={getOpenRouterAuthUrl(vscodeUriScheme)}
							style={{
								transform: "scale(0.85)",
								transformOrigin: "left center",
								margin: "4px -30px 2px 0",
							}}>
							Get OpenRouter API Key
						</VSCodeButtonLink>
					)}
					{apiConfiguration?.openRouterApiKey && apiConfiguration?.apiProvider !== "openrouter" && (
						<VSCodeButton
							onClick={() => {
								vscode.postMessage({
									type: "apiConfiguration",
									apiConfiguration: { ...apiConfiguration, apiProvider: "openrouter" },
								})
							}}
							style={{
								transform: "scale(0.85)",
								transformOrigin: "left center",
								margin: "4px -30px 2px 0",
							}}>
							Switch to OpenRouter
						</VSCodeButton>
					)}
				</li>
				<li>
					<b>Edit Cline's changes before accepting!</b> When he creates or edits a file, you can modify his
					changes directly in the right side of the diff view (+ hover over the 'Revert Block' arrow button in
					the center to undo "<code>{"// rest of code here"}</code>" shenanigans)
				</li>
				<li>
					New <code>search_files</code> tool that lets Cline perform regex searches in your project, letting
					him refactor code, address TODOs and FIXMEs, remove dead code, and more!
				</li>
				<li>
					When Cline runs commands, you can now type directly in the terminal (+ support for Python
					environments)
				</li>
			</ul>*/}
			<div style={hrStyle} />
			<p style={linkContainerStyle}>
				Join us on{" "}
				<VSCodeLink style={linkStyle} href="https://x.com/cline">
					X,
				</VSCodeLink>{" "}
				<VSCodeLink style={linkStyle} href="https://discord.gg/cline">
					discord,
				</VSCodeLink>{" "}
				or{" "}
				<VSCodeLink style={linkStyle} href="https://www.reddit.com/r/cline/">
					r/cline
				</VSCodeLink>
				for more updates!
			</p>
		</div>
	)
}
</announcement-component>

- 3.13

<changeset>
Minor Changes
2964388: Added copy button to MermaidBlock component
75143a7: Add the ability to fetch from global cline rules files
Patch Changes
a0252e7: convert inline style to tailwind css of file SettingsView.tsx
ab59bd9: Add stream options back to xai provider
7276f50: Icons to indicate an action is occuring outside of the users workspace
0b19ba6: update to NEW model
</changeset>

<changelog>
## [3.13.0]

-   Add Cline rules popover under the chat field, allowing you to easily add, enable & disable workspace level or global rule files
-   Add new slash command menu letting you type “/“ to do quick actions like creating new tasks
-   Add ability to edit past messages, with options to restore your workspace back to that point
-   Allow sending a message when selecting an option provided by the question or plan tool
-   Add command to jump to Cline's chat input
-   Add support for OpenAI o3 & 4o-mini (Thanks @PeterDaveHello and @arafatkatze!)
-   Add baseURL option for Google Gemini provider (Thanks @owengo and @olivierhub!)
-   Add support for Azure's DeepSeek model. (Thanks @yt3trees!)
-   Add ability for models that support it to receive image responses from MCP servers (Thanks @rikaaa0928!)
-   Improve search and replace diff editing by making it more flexible with models that fail to follow structured output instructions. (Thanks @chi-cat!)
-   Add detection of Ctrl+C termination in terminal, improving output reading issues
-   Fix issue where some commands with large output would cause UI to freeze
-   Fix token usage tracking issues with vertex provider (Thanks @mzsima!)
-   Fix issue with xAI reasoning content not being parsed (Thanks @mrubens!)
</changelog>

<announcement-component>
const Announcement = ({ version, hideAnnouncement }: AnnouncementProps) => {
	const minorVersion = version.split(".").slice(0, 2).join(".") // 2.0.0 -> 2.0
	return (
		<div style={containerStyle}>
			<VSCodeButton appearance="icon" onClick={hideAnnouncement} style={closeIconStyle}>
				<span className="codicon codicon-close"></span>
			</VSCodeButton>
			<h3 style={h3TitleStyle}>
				🎉{"  "}New in v{minorVersion}
			</h3>
			<ul style={ulStyle}>
				<li>
					<b>Global Cline Rules:</b> store multiple rules files in Documents/Cline/Rules to share between projects.
				</li>
				<li>
					<b>Cline Rules Popup:</b> New button in the chat area to view workspace and global cline rules files to plug
					and play specific rules for the task
				</li>
				<li>
					<b>Slash Commands:</b> Type <code>/</code> in chat to see the list of quick actions, like starting a new task
					(more coming soon!)
				</li>
				<li>
					<b>Edit Messages:</b> You can now edit a message you sent previously by clicking on it. Optionally restore
					your project when the message was sent!
				</li>
			</ul>
			<h4 style={{ margin: "5px 0 5px" }}>Previous Updates:</h4>
			<ul style={ulStyle}>
				<li>
					<b>Model Favorites:</b> You can now mark your favorite models when using Cline & OpenRouter providers for
					quick access!
				</li>
				<li>
					<b>Faster Diff Editing:</b> Improved animation performance for large files, plus a new indicator in chat
					showing the number of edits Cline makes.
				</li>
				<li>
					<b>New Auto-Approve Options:</b> Turn off Cline's ability to read and edit files outside your workspace.
				</li>
			</ul>
			{/*
			// Leave this here for an example of how to structure the announcement
			<ul style={{ margin: "0 0 8px", paddingLeft: "12px" }}>
				 <li>
					OpenRouter now supports prompt caching! They also have much higher rate limits than other providers,
					so I recommend trying them out.
					<br />
					{!apiConfiguration?.openRouterApiKey && (
						<VSCodeButtonLink
							href={getOpenRouterAuthUrl(vscodeUriScheme)}
							style={{
								transform: "scale(0.85)",
								transformOrigin: "left center",
								margin: "4px -30px 2px 0",
							}}>
							Get OpenRouter API Key
						</VSCodeButtonLink>
					)}
					{apiConfiguration?.openRouterApiKey && apiConfiguration?.apiProvider !== "openrouter" && (
						<VSCodeButton
							onClick={() => {
								vscode.postMessage({
									type: "apiConfiguration",
									apiConfiguration: { ...apiConfiguration, apiProvider: "openrouter" },
								})
							}}
							style={{
								transform: "scale(0.85)",
								transformOrigin: "left center",
								margin: "4px -30px 2px 0",
							}}>
							Switch to OpenRouter
						</VSCodeButton>
					)}
				</li>
				<li>
					<b>Edit Cline's changes before accepting!</b> When he creates or edits a file, you can modify his
					changes directly in the right side of the diff view (+ hover over the 'Revert Block' arrow button in
					the center to undo "<code>{"// rest of code here"}</code>" shenanigans)
				</li>
				<li>
					New <code>search_files</code> tool that lets Cline perform regex searches in your project, letting
					him refactor code, address TODOs and FIXMEs, remove dead code, and more!
				</li>
				<li>
					When Cline runs commands, you can now type directly in the terminal (+ support for Python
					environments)
				</li>
			</ul>*/}
			<div style={hrStyle} />
			<p style={linkContainerStyle}>
				Join us on{" "}
				<VSCodeLink style={linkStyle} href="https://x.com/cline">
					X,
				</VSCodeLink>{" "}
				<VSCodeLink style={linkStyle} href="https://discord.gg/cline">
					discord,
				</VSCodeLink>{" "}
				or{" "}
				<VSCodeLink style={linkStyle} href="https://www.reddit.com/r/cline/">
					r/cline
				</VSCodeLink>
				for more updates!
			</p>
		</div>
	)
}
</announcement-component>


We have a changeset PR that automatically generated as new unreleased PRs are merged into main, the PR is always called "Changeset version bump" and the author is github-actions. 

The Changeset PR description looks something like this:

<changeset-pr-description>
This PR was opened by the [Changesets release](https://github.com/changesets/action) GitHub action. When you're ready to do a release, you can merge this and publish to npm yourself or [setup this action to publish automatically](https://github.com/changesets/action#with-publishing). If you're not ready to do a release yet, that's fine, whenever you add more changesets to main, this PR will be updated.


# Releases
## claude-dev@3.16.0

### Minor Changes

-   c6e8b04: Recent task list is now collapsible, allowing users to hide their recent tasks (e.g. when sharing their screen).
-   aabe4ae: Add detection for new users to display special components
-   6c18d51: adds global endpoint for vertex ai users
-   080ed7c: Add Tailwind CSS IntelliSense to the the recommended extensions list
-   5147e28: new workflow feature

### Patch Changes

-   c0b3c69: fix eternal loading states when the last message is a checkpoint
-   570ece3: selectImages protos migration
-   8d8452e: askResponse protobus migration
-   cd1ff2a: Finishing the migration of Vscode Advanced settings to Settings Webview
</changeset-pr-description>

The changeset pr is ALWAYS on the following branch: `changeset-release/main`.

I have the `gh` command line tool set up and authenticated, so you have everything you need.

The first step is to get the full diff from the changeset PR to look at the changes that were automatically made to the `CHANGELOG.md` file. By default it will automatically add a new section to the changelog.md file with the new version. The problem with the automatically generated section is that it just takes the text that the developers threw into their changeset files for each corresponding PR, and they can be pretty vague and bad. Additionally there's some stuff that is totally irrelevant for the end user, like minor refactoring changes. So I manually typically go in and update this section to be a proper changelog that will show up in our patchnotes. You can look at how the rest of the file is done because those are all good examples of us updating this to use good language for the end user. We usually put new features up top (and the most exciting flagship features at the very top), and then bug fixes/improvements at the bottom. Having some basic organization to the ordering of the bullet points by content is nice. But use common sense. 

To handle this process effectively, do the following:

For each of the automatically generated bullet points in the Changelog.md, you should
1. Take the commit hash at the start of the bullet point, and use the `gh` command line tool find the PR that it was associated with. 
2. Use the `gh` command to get the PR title/description/discussion to understand the context surrounding the PR.
3. Use the `gh` command line tool to get the full PR diff to fully understand the changes made in the code.
4. Synthesize that knowledge to determine (a) whether or not this change is relevant to end users and (b) what the text & ordering of the line should be.  
5. Update the `CHANGELOG.md` accordingly 

Do this for every single item in the list from the autogenerated bullet points. We want to be diligent and have a full understanding of every feature so we can make the best changelog ever!

Here are some principles for good changelogs from keepchangelog.com, a handy guide:

<keepachangelog-pinciples-for-good-changelogs>
### Guiding Principles
- Changelogs are for humans, not machines.
- There should be an entry for every single version.
- The same types of changes should be grouped.
- The latest version comes first.

### Bullet points in the changelog should follow these principles:
- Types of changes
- Added for new features.
- Changed for changes in existing functionality.
- Deprecated for soon-to-be removed features.
- Removed for now removed features.
- Fixed for any bug fixes.
- Security in case of vulnerabilities.
</keepachangelog-pinciples-for-good-changelogs>

Lastly, when developers make a PR, they typically make a changeset. And they have 3 options when making the changeset:

1. Patch
2. Minor
3. Major

Sometimes they label something as minor when really it should just be a patch. Or vice versa. Because of this, the automatic version bump may be incorrect. So when starting out this workflow, you should use the <ask_followup_question> tool to confirm with me whether or not this should be a patch bump (show the old version number and what the proposed new version number would be) or a minor bump. Part of the release process is making sure the version in package.json that is automatically changed actually corresponds with what we decided the bump should actually be based on the features. ALL these modifications happen in the `changeset-release/main` branch btw. 

<important_note>
Before doing any of this, make sure you check out the `changeset-release/main` and pull the most recent up to date changes. Then perform all this work in that branch. 

New announcement banners should ONLY be made for minor version bumps or higher. That's another reason why double checking if the changelog warrants the bump is important.

Also, SUPER important: For any external contributors that aren't part of the cline github organization, we always want to add a (Thanks @username!) at the end of the changelog to attribute them properly. We're an open source project and it's ethical to do this.
</important_note>

Once the changelog looks good, and the version number looks good, we gotta double check that the version number in the changelog has the brackets around it. And as a final step, double check the package.json version number matches the latest number in the changelog. And as the ultimate final step we run `npm run install:all` to make sure the package version number permiates through the lock file. 


<detailed_sequence_of_steps>
# Cline Release Process - Detailed Sequence of Steps

## Before Starting
1. First, examine the changeset PR without checking it out:
   ```bash
   gh pr view changeset-release/main
   ```

2. View the PR diff to see the auto-generated CHANGELOG.md changes:
   ```bash
   gh pr diff changeset-release/main > changeset-diff.txt
   cat changeset-diff.txt | grep -A 50 "CHANGELOG.md"
   ```

## Initial Setup
3. Once you're ready to start, checkout and update the changeset release branch:
   ```bash
   git checkout changeset-release/main
   git pull origin changeset-release/main
   ```

## Analyzing Each Change
4. For each commit hash in the auto-generated changelog entries:

   a. Find the PR number associated with a commit hash:
      ```bash
      gh pr list --search "<commit-hash>" --state merged
      ```
   
   b. Get PR details for better context:
      ```bash
      gh pr view <PR-number>
      ```
   
   c. Check if the contributor is external to determine if attribution is needed:
      ```bash
      # Extract username from PR
      USERNAME=$(gh pr view <PR-number> --json author --jq .author.login)
      
      # Check if user is a member of the Cline organization
	  # this command is a bit finnicky, but it 100% works. 
	  # if you see a `Error executing command: The command ran successfully, but we couldn't capture its output. Please proceed accordingly.` error, just retry it until you actually get the output
	  # don't make any assumptions, just retry the command to actually get the output and determine if they're external or not.
	  # no output means they are an external contributor, otherwise if there is output they are an internal contributor (part of our github org)
      gh api "orgs/cline/members" --jq "map(.login)" | grep -i "pashpashpash"
      ```
   
   d. View the full PR diff to understand code changes:
      ```bash
      gh pr diff <PR-number> > pr-diff-<PR-number>.txt
      cat pr-diff-<PR-number>.txt
      ```

## Updating the Changelog
5. Based on PR analysis, update the CHANGELOG.md with user-friendly descriptions:
   - Use the `<replace_in_file>` tool to edit the CHANGELOG.md file
   - Group by feature type (Added, Changed, Fixed)
   - Put most exciting features at the top
   - Move bug fixes and small improvements to the bottom
   - Use clear, end-user focused language
   - For external contributors, add attribution at the end of the relevant entry: `(Thanks @username!)`

## Version Number Verification
6. Confirm the version bump is appropriate:
   - Check package.json to verify the auto-generated version number:
     ```bash
     cat package.json | grep "\"version\""
     ```
   - If the feature set doesn't warrant a minor bump, use the `<replace_in_file>` tool to modify package.json

7. Ensure the version in CHANGELOG.md has brackets around it:
   ```
   ## [3.16.0]
   ```

## Creating the Announcement (for minor/major versions only)
8. If this is a minor version bump, create/update the announcement component:
   - Use the `<replace_in_file>` tool to edit the src/views/components/announcement.tsx file
   - Update the highlights based on key features
   - Move previous version highlights to the "Previous Updates" section
   - Use the previous announcement components as reference for structure

## Finalizing the Release
9. Update dependencies with the new version number:
   ```bash
   npm run install:all
   ```

10. Commit your changes:
    ```bash
    git add CHANGELOG.md package.json package-lock.json src/views/components/announcement.tsx
    git commit -m "Update CHANGELOG.md and announcement for version 3.16.0"
    ```

11. Push your changes to the changeset branch:
    ```bash
    git push origin changeset-release/main
    ```

12. Check that your changes pushed successfully:
    ```bash
    git status
    ```
</detailed_sequence_of_steps>