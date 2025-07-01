# Guide to Conveying New Features in Documentation

## The Four Essential Documentation Categories

Every feature page should include these four sections to create a complete user journey.

Start with a human-readable explanation that covers what the feature is in simple terms. Skip jargon and explain it like you're talking to someone who's never seen it before. This sets the foundation for everything that follows.

Next, combine location and usage into one flowing section. Tell users exactly where to find the feature and how to use it, but weave the instructions into natural prose rather than rigid step lists. Users shouldn't have to jump between separate "where is it" and "how do I use it" sections.

Show the feature in action with real examples like actual files, workflows, or code. Users need to see concrete implementations, not just abstract descriptions. This is where understanding turns into practical knowledge.

End with inspiration that sparks imagination. This section pushes people from understanding to action by showing them what becomes possible when they use this feature creatively. It's what separates good documentation from great documentation.

## Writing Principles That Actually Work

### Write for Action, Not Just Understanding

Documentation should motivate users to try things. Instead of just explaining how something works, focus on what users can accomplish with it. The inspiration section is crucial - it's what transforms passive readers into active users.

### Create a Natural Story Flow

Your four sections should feel like a conversation that naturally progresses from "what is this?" to "how do I use it?" to "here's a real example" to "imagine what you could do with this." Each section builds on the previous one without feeling mechanical or checklist-like.

### Show Real Examples, Not Toy Demos

Provide actual workflow files, real code snippets, and concrete implementations that users can copy and adapt. Abstract examples don't help anyone - users want to see exactly what they'll be working with.

### Keep It Scannable But Not Fragmented

Write in prose that flows naturally when read completely, but structure it so users can quickly find specific information when they're troubleshooting. Avoid dense walls of text, but also avoid over-formatting with excessive bullet points and bold headers.

## Language and Tone Guidelines

Write clearly without dumbing things down. Use simple language when possible, but don't avoid technical terms that users need to know. Explain concepts in terms of what users can achieve rather than how the software works internally.

Make your writing conversational and encouraging. Phrases like "you can also try" or "when that works" feel more natural than rigid instructional language. Help users feel confident about trying new things.

Keep content concise and purposeful. Every sentence should either help users understand something or help them do something. If it doesn't serve one of those purposes, cut it.

Build in context and reasoning. Users want to understand why they're doing something, not just what to do. This builds confidence and helps them troubleshoot when things don't work exactly as expected.

## Practical Implementation

Structure each feature page consistently with the four-section approach, but let the content flow naturally within that structure. Use visual assets like videos and screenshots to complement the written content - they often communicate more effectively than paragraphs of description.

Link generously to related resources, examples, and deeper documentation. Users should never feel stuck or wonder where to go next. Maintain a repository of real examples that users can reference and adapt to their own needs.

The goal is documentation that feels more like helpful guidance from an experienced colleague than a technical manual. Users should finish reading feeling excited about what they can accomplish, not just informed about what the feature does.

## Focus on User Outcomes

The discussion about inspiring users to use their imagination suggests writing should focus on what users can achieve rather than just describing features. Frame content around user benefits and possibilities.

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

We should instead strive to write beautiful docs that read well. We can use bullet points but it should read like prose.

<good_example_of_writing>
#### macOS

If you're experiencing terminal issues on macOS, switching to bash often resolves compatibility problems. Navigate to Cline Settings → Terminal → Default Terminal Profile and select "bash" from the dropdown. Many users find that Oh-My-Zsh can interfere with Cline's terminal integration, so try temporarily disabling it by running `mv ~/.zshrc ~/.zshrc.backup` and restarting VSCode. You can also improve terminal compatibility by adding `export TERM=xterm-256color` to your shell configuration file.

#### Windows

PowerShell 7 provides the most reliable Windows experience with Cline. Install it from the Microsoft Store, then select it in your Cline settings. If you're still seeing issues, Windows ConPTY can sometimes cause problems - disable it by going to VSCode Settings → Terminal › Integrated: Windows Enable Conpty and unchecking the box. When all else fails, the simple Command Prompt (cmd.exe) often works better than more complex shells.

#### Linux

Bash remains the most dependable option for Linux users. Select it in your Cline settings if you haven't already. Make sure VSCode has the necessary terminal access permissions, as restricted permissions can cause unexpected behavior. If you use custom prompt configurations in your `.bashrc`, try commenting them out temporarily to see if they're causing conflicts.

</good_example_of_writing>

The good example transforms the rigid bullet point structure into flowing prose that's much more natural to read. Writing this way creates a conversational flow rather than a mechanical checklist, where information progresses logically from one solution to the next. Instead of just listing steps, the prose explains why each solution works, like noting that "Oh-My-Zsh can interfere with Cline's terminal integration."
Phrases like "When all else fails" and "Many users find that" make the documentation feel more human and relatable. The actual steps get woven into the narrative rather than broken out as separate numbered items, making the text flow better while still being actionable. Each suggestion includes context about why it helps, which builds user confidence and understanding rather than just giving rote instructions.

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

**Never** fall into that awful **Bold Text** - description pattern that we specifically identified as bad writing. The content should flows naturally as connected thoughts rather than feeling like a templated AI response with forced formatting.

# Lastly, before you start writing docs

First, internalize these guidelines. I mean it. 

Second, read some good examples that I personally wrote and am proud of:

- docs/features/slash-commands/workflows.mdx
- docs/features/slash-commands/new-task.mdx
- docs/features/at-mentions/overview.mdx
- docs/features/drag-and-drop.mdx

Third, if the user specifies any other instructions make sure you follow them.