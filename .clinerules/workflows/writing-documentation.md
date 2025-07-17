# General writing guide

# How I want you to write 

I'm gonna write something technical.

It's often less about the nitty-gritty details of the tech stuff and more about learning something new or getting a solution handed to me on a silver platter.

Look, when I read, I want something out of it. So when I write, I gotta remember that my readers want something too. This whole piece? It's about cluing in anyone who writes for me, or wants me to write for them, on how I see this whole writing product thing.

I'm gonna lay out a checklist of stuff I'd like to have. It'll make the whole writing gig a bit smoother, you know?

## Crafting Compelling Titles

I often come across titles like "How to do X with Y,Z technology." These don't excite me because X or Y are usually unfamiliar unless they're already well-known. Its rarely the dream to use X unless X is the dream. 

My dream isn’t to use instructor, its to do something valueble with the data it extracts

An effective title should:

- Evoke an emotional response
- Highlight someone's goal
- Offer a dream or aspiration
- Challenge or comment on a belief
- Address someone's problems

I believe it's more impactful to write about specific problems. If this approach works, you can replicate it across various scenarios rather than staying too general.

- Time management for everyone can be a 15$ ebook
- Time management for executives is a 2000$ workshop

Aim for titles that answer questions you think everyone is asking, or address thoughts people have but can't quite articulate.

Instead of "How I do something" or "How to do something," frame it from the reader's perspective with "How you can do something." This makes the title more engaging. Just make sure the difference is advisory if the content is subjective. “How I made a million dollars” might be more reasonable than “How to make a million dollars” since you are the subject and the goal might be to share your story in hopes of helping others.

This approach ultimately trains the reader to have a stronger emotional connection to your content.

- "How I do X"
- "How You Can do X"

Between these two titles, it's obvious which one resonates more emotionally.

You can take it further by adding specific conditions. For instance, you could target a particular audience or set a timeframe:

- How to set up Braintrust
- How to set up Braintrust in 5 minutes

## NO adjectiives

I want you to almost always avoid adjectives and try to use evidence instead. Instead of saying "production ready," you can write something like "scaling this to 100 servers or 1 million documents per second." Numbers like that will tell you exactly what the specificity of your product is. If you have to use adjectives rather than evidence, you are probably making something up. 

There's no reason to say something like "blazingly fast" unless those things are already known phrases.

Instead, say "200 times faster" or "30% faster." A 30% improvement in recommendation system speed is insane.

There's a 200 times performance improvement because we went from one programming language to another. It's just something that's a little bit more expected and understandable.

Another test that I really like using recently is tracking whether or not the statements you make can be:

- Visualized
- Proven false
- Said only by you

If you can nail all three, the claim you make will be more likely to resonate with an audience because only you can say it.

Earlier this year, I had an example where I embedded all of Wikipedia in 17 minutes with 20 bucks, and it got half a million views. All we posted was a video of me kicking off the job, and then you can see all the log lines go through. You see the number of containers go from 1 out of 50 to 50 out of 50.

It was easy to visualize and could have been proven false by being unreproducible. Lastly, Modal is the only company that could do that in such an effortless way, which made it unique.

## Keep It Digestible 
    - Aim for 5-minute reads
    - Write at a Grade 10 reading level
    - Break up long paragraphs
    - Use headers and bullet points

## Make It Scannable
    - Bold key points
    - Use subheadings every 3-4 paragraphs
    - Include plenty of white space
    - Add relevant examples

This structure works whether you're writing a tweet thread or a full blog post. The key is making complex ideas accessible.

# Guide to Writing Cline Documentation

## Some general principles for explaining features

If you're talking about a feature, it's helpful to start with a human-readable explanations that cover what the feature is in simple terms. Skip jargon and explain it like you're talking to someone who's never seen it before. This sets the foundation for everything that follows.

Combine location and usage into one flowing section. Tell users exactly where to find the feature and how to use it, but weave the instructions into natural prose with a good balance of bullet points, numbered lists, code examples (if applicable), mintlify components, and headers/subheaders. Users shouldn't have to jump between separate "where is it" and "how do I use it" sections.

Show the feature in action with real examples like actual files, workflows, or code. Users need to see concrete implementations, not just abstract descriptions. This is where understanding turns into practical knowledge.

When talking about a feature, include an inspiration section that sparks imagination. This section pushes people from understanding to action by showing them what becomes possible when they use this feature creatively. It's what separates good documentation from great documentation.

## Writing Principles That Actually Work

### Write for Action, Not Just Understanding

Documentation should motivate users to try things. Instead of just explaining how something works, focus on what users can accomplish with it. The inspiration section is crucial - it's what transforms passive readers into active users.

### Create a Natural Story Flow

It should feel like a conversation that naturally progresses from "what is this?" to "how do I use it?" to "here's a real example" to "imagine what you could do with this." 

### Show Real Examples, Not Toy Demos

Provide actual workflow files, real code snippets, and concrete implementations that users can copy and adapt. Abstract examples don't help anyone - users want to see exactly what they'll be working with.

### Keep It Scannable But Not Fragmented

Write in prose that flows naturally when read completely, but structure it so users can quickly find specific information when they're troubleshooting. Avoid dense walls of text, but also avoid over-formatting with excessive bullet points and bold headers. There should be a nice visual heirarchy of balance between all elements, so you can quickly scan the page and find what you're looking for.

## Language and Tone Guidelines

Write clearly without dumbing things down. Use simple language when possible, but don't avoid technical terms that users need to know. Explain concepts in terms of what users can achieve rather than how the software works internally.

Make your writing conversational and encouraging. Phrases like "you can also try" or "when that works" feel more natural than rigid instructional language. Help users feel confident about trying new things.

Keep content concise and purposeful. Every sentence should either help users understand something or help them do something. If it doesn't serve one of those purposes, cut it.

Build in context and reasoning. Users want to understand why they're doing something, not just what to do. This builds confidence and helps them troubleshoot when things don't work exactly as expected.

## Practical Implementation

Structure each feature page consistently with the four-section approach, but let the content flow naturally within that structure. Use visual assets like videos and screenshots to complement the written content - they often communicate more effectively than paragraphs of description.

Link generously to related resources, examples, and deeper documentation. Users should never feel stuck or wonder where to go next. Maintain a repository of real examples that users can reference and adapt to their own needs.

The goal is documentation that feels more like helpful guidance from an experienced colleague than a technical manual. Users should finish reading feeling excited about what they can accomplish, not just informed about what the feature does.

## Balance Structure with Flexibility

While they discuss having consistent documentation structure, there's also mention of making content feel less rigid and more natural. The writing should follow guidelines while still feeling conversational and engaging. 

## Bad examples

I personally hate this pattern of bullet point **Bold Text** colon and then more text:
<bad_example_of_writing>
#### macOS

1. **Switch to bash**: Go to Cline Settings → Terminal → Default Terminal Profile → Select "bash"
2. **Disable Oh-My-Zsh temporarily**: If using zsh, try `mv ~/.zshrc ~/.zshrc.backup` and restart VSCode
3. **Set environment**: Add to your shell config: `export TERM=xterm-256color`

#### Windows

1. **Use PowerShell 7**: Install from Microsoft Store, then select it in Cline settings
2. **Disable Windows ConPTY**: VSCode Settings → Terminal › Integrated: Windows Enable Conpty → Uncheck
3. **Try Command Prompt**: Sometimes simpler is better - switch to cmd.exe

#### Linux

1. **Use bash**: Most reliable option - select in Cline settings
2. **Check permissions**: Ensure VSCode has terminal access permissions
3. **Disable custom prompts**: Comment out prompt customizations in `.bashrc`

</bad_example_of_writing>

We should instead strive to write beautiful docs that read well. We can use bullet points and numbered lists but it should read naturally and be delightful to look at hierachally when scanning through the doc. There should be a good balance between blocks of text, code snippets, paragraphs, numbered lists, and bullet points. When scanning the documentation visually, you should feel like you're adminiring a tasteful art piece.

<good_example_of_writing>
#### macOS

The most common fix is switching to bash. Navigate to Cline Settings → Terminal → Default Terminal Profile and select "bash" from the dropdown.

If you're still having issues, Oh-My-Zsh might be interfering with terminal integration. Try temporarily disabling it:
- Run `mv ~/.zshrc ~/.zshrc.backup` 
- Restart VSCode

You can also add `export TERM=xterm-256color` to your shell configuration file to improve compatibility.

#### Windows

PowerShell 7 provides the most reliable experience. Install it from the Microsoft Store, then select it in your Cline settings.

Still seeing problems? Try these solutions:
- Disable Windows ConPTY: VSCode Settings → Terminal › Integrated: Windows Enable Conpty → uncheck
- Switch to Command Prompt (cmd.exe) - sometimes simpler shells work better

#### Linux

Bash is your most dependable option. Select it in Cline settings if you haven't already.

Check these common issues:
- Ensure VSCode has terminal access permissions
- Temporarily comment out custom prompt configurations in your `.bashrc`
</good_example_of_writing>

This is much more natural to read. Writing this way creates a conversational flow, and bullet points are used idiomatically.

# Using Mintlify Components Idiomatically

Mintlify's custom components can transform basic documentation into engaging, scannable content that users actually want to read. Here's how to use them effectively.

## Visual Content with Frames

Videos and images should be wrapped in `<Frame>` components rather than using raw HTML or markdown. This creates consistent styling and proper responsive behavior.

For videos, embed them directly rather than linking externally. Users are much more likely to watch a 30-second demonstration than click through to another platform:

```jsx
<Frame>
	<iframe
		style={{ width: "100%", aspectRatio: "16/9" }}
		src="https://www.youtube.com/embed/your-video-id"
		title="Feature demonstration"
		frameBorder="0"
		allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
		allowFullScreen
	/>
</Frame>
```

Screenshots work similarly - the frame provides visual polish and consistency:

```jsx
<Frame>
	<img src="/path/to/screenshot.png" alt="Descriptive alt text" />
</Frame>
```

## Cards for Navigation and Overview

Cards excel at creating scannable overviews that link to detailed documentation. They're perfect for feature listings, getting started guides, or any section where users need to choose their path.

Use the two-column layout for related features:

```jsx
<Columns cols={2}>
  <Card title="Feature Name" icon="relevant-icon" href="/link/to/docs">
    Brief description that explains what this feature does and why someone would use it.
  </Card>
  
  <Card title="Related Feature" icon="another-icon" href="/another/link">
    Another concise explanation that helps users understand the value proposition.
  </Card>
</Columns>
```

The key is writing card descriptions that are informative enough to help users decide whether to click through, but concise enough to scan quickly. Each card should answer "what does this do?" and "why would I need this?"

## Tips and Notes for Context

Use `<Tip>` components for helpful information that enhances the main content without cluttering it:

```jsx
<Tip>
	Pro tip: You can combine multiple @ mentions in a single message to give Cline 
	comprehensive context about your issue.
</Tip>
```

`<Note>` components work well for important caveats or technical limitations:

```jsx
<Note>
	Due to VS Code limitations, some features require specific settings to work properly.
</Note>
```

`<Info>` is also cool:

<Info>
	**Quick Fix**: If you're experiencing terminal issues, try switching to a simpler shell like `bash` in the Cline settings.
	This resolves 90% of terminal integration problems.
</Info>

**Never** fall into that awful **Bold Text** - description pattern that we specifically identified as bad writing. The content should flow naturally as connected thoughts rather than feeling like a templated AI response with forced formatting.


## When to Use Bullet Points and Numbered Lists Strategically

Bullet points serve functional purposes - use them for:

**Sequential actions or troubleshooting steps** where users need to follow a specific order:
1. Install the extension
2. Restart VSCode  
3. Check the settings panel

**Lists of related options** where users need to choose one approach:
- Try PowerShell 7 for the most reliable experience
- Switch to Command Prompt if you're still having issues
- Use WSL Bash for Linux compatibility

**Quick reference items** that users might need to scan quickly when problem-solving.

**Improving Visual Hierarchy** when there's a wall of text - that's a good time to introduce bullet points or numbered lists.

Each bulleted item or numbered list should be a discrete action or piece of information that benefits from being visually separated. This is a key weapon you can employ when going for that artwork experience I mentioned earlier. 

<good_example_of_bullet_points>
## Finding and Configuring Terminal Settings

You can access Cline's terminal settings by clicking the settings icon in the Cline sidebar, then navigating to the Terminal section. These settings control how Cline interacts with your system's terminal.

- The **Default Terminal Profile** setting determines which shell Cline uses for executing commands. If you're experiencing issues, this is usually the first thing to change. I personally keep this set to `bash` on all my systems because it's the most reliable option, even though I use `zsh` for my regular terminal work.

- **Shell Integration Timeout** controls how long Cline waits for the terminal to become ready. The default is 4 seconds, but if you have a heavy shell configuration (lots of plugins, slow startup scripts), you might need to increase this to 10 or even 15 seconds. I've found that WSL environments and SSH connections often need longer timeouts.

- The **Enable Aggressive Terminal Reuse** setting determines whether Cline tries to reuse existing terminals even when they're not in the correct directory. When this causes problems (commands running in the wrong directory, virtual environment issues), disabling it creates more terminal instances but ensures each command runs in a clean state.

- **Terminal Output Line Limit** sets how many lines of output Cline will read from commands. The default of 500 lines works for most cases, but you might need to adjust it. For verbose build outputs, increase it. For commands with progress bars that spam thousands of lines, decrease it to around 100 to avoid consuming too many tokens.
</good_example_of_bullet_points>

## Write Like a Human, Not an AI

Keep it short and direct. If you can say something in fewer words, do it. Long explanations often confuse more than they help.

Use normal sentence lengths. Mix short and long sentences naturally, like you would when talking to someone. Avoid those meandering compound sentences that go on forever.

Cut the corporate speak. Instead of "utilize," say "use." Instead of "in order to," just say "to." Write like you're explaining something to a colleague, not drafting a press release.

Don't over-explain obvious things. If users are reading documentation, they probably understand basic concepts. Respect their intelligence.

## Never use em dashes or emojis

That's pretty much it. Never use them. Only AI writes with em dashes or emojis.

# Anthropomorphizing Cline

When referring to Cline, always call him a "him" not an "it". 

Bad example:
- When Cline can’t execute commands or read their output, you lose access to one of its most powerful capabilities.

Good Example:

- When Cline can’t execute commands or read their output, you lose access to one of his most powerful capabilities.

# Using "I" when sharing your workflow

Adding a personal touch goes a long way. There are great examples in the docs currently where I use "I" to share how I personally use cline, from dev to dev. It's a great technique.

# Crosslinking relevant documentation pages

Make sure you crosslink when you're done writing the docs. If there are relevant docs, just link to them.

# Brevity is the soul of wit

Don't ramble if you don't need to. Use bullet points and numbered lists. Keep things easy to read.

<bad_example>

When Cline can't execute commands or read their output, you lose access to one of his most powerful capabilities. Terminal integration problems are frustrating, but they're usually fixable with a few simple changes.

## The Most Common Problem: Shell Integration Issues

If you're seeing "Shell integration unavailable" or Cline isn't getting command output, the issue is almost always your shell configuration. Complex shell setups with custom prompts, plugins, and fancy configurations can interfere with VSCode's terminal integration.

**Switch to bash first.** This fixes the problem 90% of the time. Navigate to Cline Settings → Terminal → Default Terminal Profile and select "bash" from the dropdown. Restart VSCode after making this change.

Still having issues? Try increasing the shell integration timeout. Go to Cline Settings → Terminal → Shell Integration Timeout and change it from 4 seconds to 10 seconds. Heavy shell configurations need more time to initialize properly.

If commands are running in the wrong directories or you're seeing weird behavior, disable aggressive terminal reuse. In Cline Settings → Terminal, uncheck "Enable aggressive terminal reuse." This creates more terminal instances but ensures each command runs in a clean environment.


</bad_exaxmple>

The first part is total filler, useless to any serious developer. You can tell it's written by a non technical person that doesn't value clean, straightforward information. 

<good_example>
## Shell Integration Issues

If you're seeing "Shell integration unavailable" or Cline can't read command output, your shell configuration is interfering with VSCode's terminal integration.

**Switch to bash first.** Go to Cline Settings → Terminal → Default Terminal Profile and select "bash." This fixes 90% of problems.

Still broken? Try these:
- Increase shell integration timeout to 10 seconds in Cline Settings → Terminal
- Disable "aggressive terminal reuse" if commands run in wrong directories
- Restart VSCode after making changes
</good_example>

The good version cuts straight to the problem and solution. No hand-holding, no emotional language about frustration, just the facts: what's wrong, how to fix it, what to try next. Respects that developers want information, not sympathy.RetryClaude can make mistakes. Please double-check responses.

ALWAYS consider your audience. And your audience is devs who don't want their time wasted. Give them the info. I cannot stress this enough. Use bullet points and numbered lists. Prose is good, but every word should actually mean something to the dev reading it.

# Lastly, before you start writing docs

1. Internalize these guidelines. I mean it. 

2. Read `docs/docs.json` and get an understanding of the structure of the docs. This will come in handly at the end when you're doing a final pass so you can cross link to docs where relevant.

3. Read some good examples that I personally wrote and am proud of:

- docs/features/slash-commands/workflows.mdx
- docs/features/slash-commands/new-task.mdx
- docs/features/at-mentions/overview.mdx
- docs/features/drag-and-drop.mdx

4. If the user specifies any other instructions make sure you follow them.
