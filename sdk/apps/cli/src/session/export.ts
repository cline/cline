import {
	type ContentBlock,
	type MessageWithMetadata,
	normalizeUserInput,
	type ToolResultContent,
	type ToolUseContent,
} from "@cline/shared";

export interface ConversationHistory {
	version: number;
	updated_at: string;
	messages: MessageWithMetadata[];
	systemPrompt?: string;
	system_prompt?: string;
	sessionId?: string;
	agent?: string;
	taskType?: string;
}

// Helper to check if content is string or array
export function isStringContent(
	content: string | ContentBlock[],
): content is string {
	return typeof content === "string";
}

// Generate a self-contained HTML file that renders the conversation
export function generateConversationHTML(
	data: ConversationHistory,
	fileName: string,
): string {
	// Build tool results map
	const toolResultsMap = new Map<string, ToolResultContent>();
	data.messages.forEach((msg) => {
		if (!isStringContent(msg.content)) {
			msg.content.forEach((block) => {
				if (block.type === "tool_result") {
					toolResultsMap.set(block.tool_use_id, block);
				}
			});
		}
	});

	// Filter messages (same logic as viewer)
	const filteredMessages = data.messages.filter((msg) => {
		if (msg.role === "assistant") return true;
		if (isStringContent(msg.content)) {
			return msg.content.trim().length > 0;
		}
		return msg.content.some(
			(block: ContentBlock) =>
				block.type === "text" && block.text.trim().length > 0,
		);
	});

	// Calculate stats
	let totalCost = 0;
	let totalInputTokens = 0;
	let totalOutputTokens = 0;
	data.messages.forEach((msg) => {
		if (msg.metrics) {
			totalCost += msg.metrics.cost ?? 0;
			totalInputTokens += msg.metrics.inputTokens ?? 0;
			totalOutputTokens += msg.metrics.outputTokens ?? 0;
		}
	});

	// Generate HTML for messages
	const messagesHTML = filteredMessages
		.map((msg, index) => {
			const isUser = msg.role === "user";
			const prevMessage = index > 0 ? filteredMessages[index - 1] : null;
			const hideHeader =
				msg.role === "assistant" && prevMessage?.role === "assistant";

			return generateMessageHTML(msg, isUser, hideHeader, toolResultsMap);
		})
		.join("\n");

	const updatedAt = data.updated_at
		? new Date(data.updated_at).toLocaleString()
		: "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName)} - Conversation Export</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #09090b;
      color: #fafafa;
      line-height: 1.6;
    }

    html,
    body,
    .content pre,
    .tool-content,
    .line-content,
    .dots-container {
      scrollbar-width: none;
      -ms-overflow-style: none;
    }

    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    .content pre::-webkit-scrollbar,
    .tool-content::-webkit-scrollbar,
    .line-content::-webkit-scrollbar,
    .dots-container::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    
    .header {
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(9, 9, 11, 0.95);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid #27272a;
      padding: 1rem 1.5rem;
    }
    
    .header-content {
      max-width: 56rem;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
    }
    
    .stats {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      flex-wrap: wrap;
    }
    
    .stat {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: #a1a1aa;
    }
    
    .stat svg {
      width: 1rem;
      height: 1rem;
    }
    
    .messages {
      max-width: 56rem;
      margin: 0 auto;
    }
    
    .message {
      padding: 1.5rem;
      border-bottom: 1px solid #18181b;
    }
    
    .message.user {
      background: rgba(39, 39, 42, 0.3);
    }
    
    .message-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    
    .avatar {
      width: 2rem;
      height: 2rem;
      border-radius: 9999px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.875rem;
      font-weight: 500;
    }
    
    .avatar.user {
      background: #3b82f6;
      color: white;
    }
    
    .avatar.assistant {
      background: #27272a;
      color: #a1a1aa;
    }
    
    .role {
      font-weight: 500;
      font-size: 0.875rem;
    }
    
    .model {
      font-size: 0.75rem;
      color: #71717a;
      font-family: ui-monospace, monospace;
    }
    
    .content {
      padding-left: 2.75rem;
    }
    
    .content p {
      margin-bottom: 0.5rem;
    }
    
    .content pre {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 0.5rem;
      padding: 1rem;
      overflow-x: auto;
      font-family: ui-monospace, monospace;
      font-size: 0.875rem;
      margin: 0.75rem 0;
    }
    
    .content code {
      font-family: ui-monospace, monospace;
      background: #27272a;
      padding: 0.125rem 0.25rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
    }
    
    .content pre code {
      background: transparent;
      padding: 0;
    }
    
    .tool-block {
      margin: 0.75rem 0;
      border: 1px solid #27272a;
      border-radius: 0.5rem;
      overflow: hidden;
    }
    
    .tool-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: #18181b;
      font-family: ui-monospace, monospace;
      font-size: 0.875rem;
    }
    
    .tool-header svg {
      width: 1rem;
      height: 1rem;
      color: #71717a;
    }
    
    .tool-content {
      padding: 1rem;
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
      background: #09090b;
      white-space: pre-wrap;
      word-break: break-all;
      overflow: auto;
    }
    
    .diff-block {
      margin: 0.75rem 0;
      border: 1px solid #27272a;
      border-radius: 0.5rem;
      overflow: hidden;
      background: #09090b;
    }
    
    .diff-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.625rem 1rem;
      background: #18181b;
      border-bottom: 1px solid #27272a;
      font-family: ui-monospace, monospace;
      font-size: 0.875rem;
    }
    
    .diff-header svg {
      width: 1rem;
      height: 1rem;
      color: #71717a;
    }
    
    .diff-stats {
      margin-left: auto;
      display: flex;
      gap: 0.5rem;
      font-size: 0.75rem;
    }
    
    .diff-stats .added {
      color: #4ade80;
    }
    
    .diff-stats .removed {
      color: #f87171;
    }
    
    .diff-content {
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
    }
    
    .diff-line {
      display: flex;
      border-bottom: 1px solid #18181b;
    }
    
    .diff-line:last-child {
      border-bottom: none;
    }
    
    .diff-line.added {
      background: rgba(74, 222, 128, 0.1);
    }
    
    .diff-line.removed {
      background: rgba(248, 113, 113, 0.1);
    }
    
    .line-num {
      width: 3rem;
      padding: 0.125rem 0.5rem;
      text-align: right;
      color: #52525b;
      border-right: 1px solid #27272a;
      user-select: none;
      flex-shrink: 0;
    }
    
    .line-indicator {
      width: 1.5rem;
      padding: 0.125rem 0.25rem;
      text-align: center;
      user-select: none;
      flex-shrink: 0;
    }
    
    .line-indicator.added {
      color: #4ade80;
      font-weight: bold;
    }
    
    .line-indicator.removed {
      color: #f87171;
      font-weight: bold;
    }
    
    .line-content {
      padding: 0.125rem 0.75rem;
      white-space: pre;
      overflow-x: auto;
      flex: 1;
    }
    
    .line-content.added {
      color: #86efac;
    }
    
    .line-content.removed {
      color: #fca5a5;
    }
    
    .badge {
      font-size: 0.625rem;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      background: #27272a;
      color: #71717a;
    }
    
    .badge.new-file {
      background: rgba(74, 222, 128, 0.2);
      color: #4ade80;
    }
    
    .error {
      color: #f87171;
    }
    
    .success {
      color: #4ade80;
    }
    
    .file-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin: 0.5rem 0;
    }
    
    .file-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.375rem 0.75rem;
      background: #18181b;
      border-radius: 0.375rem;
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
      color: #a1a1aa;
    }
    
    .command-block {
      margin: 0.5rem 0;
      padding: 0.75rem 1rem;
      background: #18181b;
      border-radius: 0.5rem;
      font-family: ui-monospace, monospace;
      font-size: 0.75rem;
    }
    
    .command-label {
      font-size: 0.625rem;
      color: #71717a;
      margin-bottom: 0.25rem;
    }
    
    .dots-nav {
      position: fixed;
      right: 1rem;
      top: 50%;
      transform: translateY(-50%);
      z-index: 20;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }
    
    .dots-nav-btn {
      padding: 0.375rem;
      border-radius: 0.5rem;
      background: #27272a;
      border: 1px solid #3f3f46;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .dots-nav-btn:hover {
      background: #3f3f46;
    }
    
    .dots-nav-btn svg {
      width: 0.75rem;
      height: 0.75rem;
      color: #a1a1aa;
    }
    
    .dots-container {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.5rem;
      border-radius: 0.5rem;
      background: #27272a;
      border: 1px solid #3f3f46;
      max-height: 60vh;
      overflow-y: auto;
    }
    
    .dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 9999px;
      cursor: pointer;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    
    .dot.user {
      background: rgba(59, 130, 246, 0.4);
    }
    
    .dot.user:hover {
      background: rgba(59, 130, 246, 0.6);
    }
    
    .dot.assistant {
      background: rgba(161, 161, 170, 0.4);
    }
    
    .dot.assistant:hover {
      background: rgba(161, 161, 170, 0.6);
    }
    
    .dot.active {
      background: #3b82f6;
      transform: scale(1.25);
    }
    
    @media (max-width: 1024px) {
      .dots-nav {
        display: none;
      }
    }
    
    @media (max-width: 768px) {
      .header-content {
        flex-direction: column;
        align-items: flex-start;
      }
      
      .stats {
        gap: 1rem;
      }
      
      .content {
        padding-left: 0;
      }
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-content">
      <div class="stats">
        <div class="stat">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
          <span>${filteredMessages.length} messages</span>
        </div>
        ${
					totalCost > 0
						? `
        <div class="stat">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
          <span>$${totalCost.toFixed(4)}</span>
        </div>
        `
						: ""
				}
        ${
					totalInputTokens > 0 || totalOutputTokens > 0
						? `
        <div class="stat">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/></svg>
          <span>${(totalInputTokens + totalOutputTokens).toLocaleString()} tokens</span>
        </div>
        `
						: ""
				}
        ${
					updatedAt
						? `
        <div class="stat">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>${updatedAt}</span>
        </div>
        `
						: ""
				}
      </div>
    </div>
  </header>
  
  <div class="messages">
    ${messagesHTML}
  </div>
  
  <!-- Dots Navigation Bar -->
  <nav class="dots-nav">
    <button class="dots-nav-btn" onclick="scrollToMessage(0)" title="Scroll to top">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
    </button>
    <div class="dots-container">
      ${filteredMessages
				.map(
					(msg, idx) => `
        <div class="dot ${msg.role}" data-index="${idx}" onclick="scrollToMessage(${idx})" title="Message ${idx + 1}: ${msg.role}"></div>
      `,
				)
				.join("")}
    </div>
    <button class="dots-nav-btn" onclick="scrollToMessage(${filteredMessages.length - 1})" title="Scroll to bottom">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </button>
  </nav>
  
  <script>
    let currentIndex = 0;
    const messages = document.querySelectorAll('.message');
    const dots = document.querySelectorAll('.dot');
    
    function scrollToMessage(index) {
      if (index >= 0 && index < messages.length) {
        messages[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
        updateActiveDot(index);
      }
    }
    
    function updateActiveDot(index) {
      dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
      });
      currentIndex = index;
    }
    
    // Track scroll position to update active dot
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index = Array.from(messages).indexOf(entry.target);
          if (index !== -1) {
            updateActiveDot(index);
          }
        }
      });
    }, { threshold: 0.5, rootMargin: '-80px 0px -50% 0px' });
    
    messages.forEach(msg => observer.observe(msg));
    
    // Initialize first dot as active
    if (dots.length > 0) {
      dots[0].classList.add('active');
    }
  </script>
</body>
</html>`;
}

function generateMessageHTML(
	message: MessageWithMetadata,
	isUser: boolean,
	hideHeader: boolean,
	toolResultsMap: Map<string, ToolResultContent>,
): string {
	const content = renderContentHTML(message.content, isUser, toolResultsMap);

	if (hideHeader) {
		return `
    <div class="message ${isUser ? "user" : "assistant"}">
      <div class="content" style="padding-left: 2.75rem;">
        ${content}
      </div>
    </div>`;
	}

	return `
    <div class="message ${isUser ? "user" : "assistant"}">
      <div class="message-header">
        <div class="avatar ${isUser ? "user" : "assistant"}">
          ${isUser ? "U" : "A"}
        </div>
        <span class="role">${isUser ? "User" : "Assistant"}</span>
        ${message.modelInfo?.id ? `<span class="model">${escapeHtml(message.modelInfo.id)}</span>` : ""}
      </div>
      <div class="content">
        ${content}
      </div>
    </div>`;
}

function renderContentHTML(
	content: string | ContentBlock[],
	isUser: boolean,
	toolResultsMap: Map<string, ToolResultContent>,
): string {
	if (typeof content === "string") {
		const text = isUser ? normalizeUserInput(content) : content;
		return renderTextHTML(text);
	}

	return content
		.map((block) => {
			switch (block.type) {
				case "text": {
					const text = isUser ? normalizeUserInput(block.text) : block.text;
					return renderTextHTML(text);
				}
				case "tool_use":
					return renderToolUseHTML(block, toolResultsMap.get(block.id));
				case "tool_result":
					return ""; // Tool results are rendered with their corresponding tool_use
				default:
					return "";
			}
		})
		.join("\n");
}

function renderTextHTML(text: string): string {
	// Simple markdown-like rendering
	let html = escapeHtml(text);

	// Code blocks
	html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
		return `<pre><code>${code.trim()}</code></pre>`;
	});

	// Inline code
	html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

	// Bold
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

	// Line breaks
	html = html.replace(/\n/g, "<br>");

	return `<div>${html}</div>`;
}

function renderToolUseHTML(
	block: ToolUseContent,
	result?: ToolResultContent,
): string {
	const toolName = block.name;
	const input = block.input;

	// Check for edit/write tools with diff
	const isEdit = [
		"edit",
		"write",
		"apply_diff",
		"str_replace_editor",
		"replace_in_file",
		"editor",
	].some((t) => toolName.toLowerCase().includes(t));

	const hasOldNew =
		input.old_string !== undefined && input.new_string !== undefined;
	const hasPathDiff = input.path !== undefined && input.new_text !== undefined;

	if (isEdit && (hasOldNew || hasPathDiff)) {
		const oldText = String(input.old_string ?? input.old_text ?? "");
		const newText = String(input.new_string ?? input.new_text ?? "");
		const filePath = String(input.file_path ?? input.path ?? "file");
		const isNewFile = !oldText && !input.insert_line;

		return renderDiffHTML(oldText, newText, filePath, isNewFile, result);
	}

	// Check for run_commands
	if (
		toolName.toLowerCase().includes("run_command") &&
		Array.isArray(input.commands)
	) {
		return renderCommandsHTML(input.commands, result);
	}

	// Check for read_files
	if (
		toolName.toLowerCase().includes("read_file") &&
		Array.isArray(input.file_paths)
	) {
		return renderFileListHTML(input.file_paths, result);
	}

	// Default tool rendering
	return `
    <div class="tool-block">
      <div class="tool-header">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
        <span>${escapeHtml(toolName)}</span>
        ${
					result
						? result?.is_error
							? '<span class="error">Error</span>'
							: '<span class="success">Success</span>'
						: ""
				}
      </div>
      <div class="tool-content">${escapeHtml(JSON.stringify(input, null, 2))}</div>
    </div>`;
}

function renderDiffHTML(
	oldText: string,
	newText: string,
	filePath: string,
	isNewFile: boolean,
	_result?: ToolResultContent,
): string {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");

	// Simple diff: show removed lines then added lines
	let diffHTML = "";
	let addedCount = 0;
	let removedCount = 0;

	if (oldText) {
		oldLines.forEach((line, i) => {
			removedCount++;
			diffHTML += `
        <div class="diff-line removed">
          <div class="line-num">${i + 1}</div>
          <div class="line-indicator removed">-</div>
          <div class="line-content removed">${escapeHtml(line) || " "}</div>
        </div>`;
		});
	}

	newLines.forEach((line, i) => {
		addedCount++;
		diffHTML += `
      <div class="diff-line added">
        <div class="line-num">${i + 1}</div>
        <div class="line-indicator added">+</div>
        <div class="line-content added">${escapeHtml(line) || " "}</div>
      </div>`;
	});

	const ext = filePath.split(".").pop() || "";

	return `
    <div class="diff-block">
      <div class="diff-header">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/></svg>
        <span>${escapeHtml(filePath)}</span>
        ${ext ? `<span class="badge">${ext}</span>` : ""}
        ${isNewFile ? '<span class="badge new-file">New File</span>' : ""}
        <div class="diff-stats">
          ${addedCount > 0 ? `<span class="added">+${addedCount}</span>` : ""}
          ${removedCount > 0 ? `<span class="removed">-${removedCount}</span>` : ""}
        </div>
      </div>
      <div class="diff-content">
        ${diffHTML}
      </div>
    </div>`;
}

function renderCommandsHTML(
	commands: string[],
	_result?: ToolResultContent,
): string {
	return commands
		.map(
			(cmd, i) => `
    <div class="command-block">
      <div class="command-label">Command ${i + 1}</div>
      <code>${escapeHtml(cmd)}</code>
    </div>
  `,
		)
		.join("\n");
}

function renderFileListHTML(
	filePaths: string[],
	_result?: ToolResultContent,
): string {
	return `
    <div class="file-list">
      ${filePaths
				.map(
					(fp) => `
        <div class="file-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
          ${escapeHtml(fp)}
        </div>
      `,
				)
				.join("\n")}
    </div>`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

export function exportSessionAsHTML(html: string, sessionId: string) {
	const browserDocument = (globalThis as { document?: DocumentLike }).document;
	if (
		typeof Blob === "undefined" ||
		typeof URL === "undefined" ||
		!browserDocument
	) {
		throw new Error("exportSessionAsHTML requires a browser environment");
	}
	const blob = new Blob([html], { type: "text/html" });
	const url = URL.createObjectURL(blob);
	const a = browserDocument.createElement("a");
	a.href = url;
	a.download = `${sessionId}.html`;
	browserDocument.body.appendChild(a);
	a.click();
	browserDocument.body.removeChild(a);
	URL.revokeObjectURL(url);
}

type DocumentLike = {
	body: {
		appendChild(node: unknown): void;
		removeChild(node: unknown): void;
	};
	createElement(tag: "a"): {
		href: string;
		download: string;
		click(): void;
	};
};
