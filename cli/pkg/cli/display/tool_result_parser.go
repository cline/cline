package display

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/cline/cli/pkg/cli/types"
)

// ToolResultParser handles parsing and formatting tool results for display
type ToolResultParser struct {
	maxPreviewLines int
	maxPreviewChars int
	mdRenderer      *MarkdownRenderer
}

// NewToolResultParser creates a new tool result parser
func NewToolResultParser(mdRenderer *MarkdownRenderer) *ToolResultParser {
	return &ToolResultParser{
		maxPreviewLines: 15,
		maxPreviewChars: 500,
		mdRenderer:      mdRenderer,
	}
}

// ParseReadFile formats readFile tool results with smart preview
func (p *ToolResultParser) ParseReadFile(content, path string) string {
	lines := strings.Split(content, "\n")
	totalLines := len(lines)

	// Get file extension for syntax highlighting
	ext := filepath.Ext(path)
	lang := p.detectLanguage(ext)

	var preview strings.Builder

	// Show header with line count
	preview.WriteString(fmt.Sprintf("*%d lines*\n\n", totalLines))

	// Show preview of content
	previewLines := p.maxPreviewLines
	if totalLines < previewLines {
		previewLines = totalLines
	}

	preview.WriteString(fmt.Sprintf("```%s\n", lang))
	for i := 0; i < previewLines; i++ {
		preview.WriteString(lines[i])
		preview.WriteString("\n")
	}

	if totalLines > previewLines {
		preview.WriteString("...\n")
	}
	preview.WriteString("```\n")

	if totalLines > previewLines {
		preview.WriteString(fmt.Sprintf("\n*[Content truncated - showing %d of %d lines]*", previewLines, totalLines))
	}

	return preview.String()
}

// ParseListFiles formats listFiles tool results with directory tree
func (p *ToolResultParser) ParseListFiles(content, path string) string {
	if content == "" || content == "No files found." {
		return "*No files found*"
	}

	lines := strings.Split(strings.TrimSpace(content), "\n")
	
	// Check for truncation message
	var truncationMsg string
	lastLine := lines[len(lines)-1]
	if strings.Contains(lastLine, "File list truncated") {
		truncationMsg = lastLine
		lines = lines[:len(lines)-1]
	}

	totalFiles := len(lines)
	
	var result strings.Builder
	result.WriteString(fmt.Sprintf("*%d %s*\n\n", totalFiles, p.pluralize(totalFiles, "file", "files")))

	// Show up to 20 files in tree format
	maxShow := 20
	if totalFiles < maxShow {
		maxShow = totalFiles
	}

	result.WriteString("```\n")
	for i := 0; i < maxShow; i++ {
		line := lines[i]
		// Add tree characters for better visualization
		if strings.HasPrefix(line, "🔒 ") {
			result.WriteString("├── 🔒 ")
			result.WriteString(strings.TrimPrefix(line, "🔒 "))
		} else {
			result.WriteString("├── ")
			result.WriteString(line)
		}
		result.WriteString("\n")
	}

	if totalFiles > maxShow {
		result.WriteString("└── ...\n")
	}
	result.WriteString("```\n")

	if totalFiles > maxShow {
		result.WriteString(fmt.Sprintf("\n*[Showing %d of %d files]*", maxShow, totalFiles))
	}

	if truncationMsg != "" {
		result.WriteString(fmt.Sprintf("\n\n*%s*", truncationMsg))
	}

	return result.String()
}

// ParseSearchFiles formats searchFiles tool results with context
func (p *ToolResultParser) ParseSearchFiles(content string) string {
	if content == "" || content == "Found 0 results." {
		return "*No results found*"
	}

	lines := strings.Split(content, "\n")
	if len(lines) == 0 {
		return "*No results found*"
	}

	// Extract result count from first line
	firstLine := lines[0]
	
	var result strings.Builder
	result.WriteString(fmt.Sprintf("*%s*\n\n", firstLine))

	// Parse and group results by file
	var currentFile string
	var fileResults []string
	filesShown := 0
	maxFiles := 5
	matchesShown := 0
	maxMatches := 15

	for i := 1; i < len(lines) && filesShown < maxFiles && matchesShown < maxMatches; i++ {
		line := lines[i]
		
		if line == "" {
			continue
		}

		// Check if this is a file path (doesn't start with whitespace or line number)
		if !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") && strings.Contains(line, ":") {
			// Save previous file results
			if currentFile != "" && len(fileResults) > 0 {
				result.WriteString(p.formatFileMatches(currentFile, fileResults))
				filesShown++
			}
			
			currentFile = line
			fileResults = []string{}
		} else if currentFile != "" {
			// This is a match line
			fileResults = append(fileResults, strings.TrimSpace(line))
			matchesShown++
		}
	}

	// Add last file's results
	if currentFile != "" && len(fileResults) > 0 && filesShown < maxFiles {
		result.WriteString(p.formatFileMatches(currentFile, fileResults))
		filesShown++
	}

	// Add truncation notice
	totalMatches := strings.Count(content, "\n") - 1 // Rough estimate
	if matchesShown < totalMatches {
		result.WriteString(fmt.Sprintf("\n*[Showing %d results - see full output for all matches]*", matchesShown))
	}

	return result.String()
}

// formatFileMatches formats matches for a single file
func (p *ToolResultParser) formatFileMatches(file string, matches []string) string {
	var result strings.Builder
	
	// Parse file path and extension for syntax highlighting
	ext := filepath.Ext(file)
	lang := p.detectLanguage(ext)
	
	result.WriteString(fmt.Sprintf("**%s** (%d %s)\n", file, len(matches), p.pluralize(len(matches), "match", "matches")))
	result.WriteString(fmt.Sprintf("```%s\n", lang))
	
	maxMatches := 5
	for i, match := range matches {
		if i >= maxMatches {
			result.WriteString("...\n")
			break
		}
		result.WriteString(match)
		result.WriteString("\n")
	}
	
	result.WriteString("```\n\n")
	
	return result.String()
}

// ParseCodeDefinitions formats listCodeDefinitionNames tool results
func (p *ToolResultParser) ParseCodeDefinitions(content string) string {
	if content == "" || content == "No source code definitions found." {
		return "*No code definitions found*"
	}

	// Return the full content as-is
	return content
}

// ParseWebFetch formats webFetch tool results with content preview
func (p *ToolResultParser) ParseWebFetch(content, url string) string {
	return ""
}

// ParseWebSearch formats webSearch tool results
func (p *ToolResultParser) ParseWebSearch(content, query string) string {
	return ""
}

// detectLanguage returns syntax highlighting language based on file extension
func (p *ToolResultParser) detectLanguage(ext string) string {
	langMap := map[string]string{
		".ts":   "typescript",
		".tsx":  "tsx",
		".js":   "javascript",
		".jsx":  "jsx",
		".go":   "go",
		".py":   "python",
		".rb":   "ruby",
		".java": "java",
		".c":    "c",
		".cpp":  "cpp",
		".cs":   "csharp",
		".php":  "php",
		".sh":   "bash",
		".bash": "bash",
		".zsh":  "bash",
		".json": "json",
		".yaml": "yaml",
		".yml":  "yaml",
		".xml":  "xml",
		".html": "html",
		".css":  "css",
		".scss": "scss",
		".md":   "markdown",
		".sql":  "sql",
		".rs":   "rust",
	}

	if lang, ok := langMap[ext]; ok {
		return lang
	}
	return ""
}

// pluralize returns the correct plural form
func (p *ToolResultParser) pluralize(count int, singular, plural string) string {
	if count == 1 {
		return singular
	}
	return plural
}

// formatWordCount formats word count with appropriate unit
func (p *ToolResultParser) formatWordCount(count int) string {
	if count < 1000 {
		return fmt.Sprintf("%d words", count)
	}
	return fmt.Sprintf("%.1fk words", float64(count)/1000.0)
}

// ParseToolResult is the main entry point for parsing tool results
func (p *ToolResultParser) ParseToolResult(tool *types.ToolMessage) string {
	switch tool.Tool {
	case "readFile":
		return p.ParseReadFile(tool.Content, tool.Path)
	case "listFilesTopLevel", "listFilesRecursive":
		return p.ParseListFiles(tool.Content, tool.Path)
	case "searchFiles":
		return p.ParseSearchFiles(tool.Content)
	case "listCodeDefinitionNames":
		return p.ParseCodeDefinitions(tool.Content)
	case "webFetch":
		return p.ParseWebFetch(tool.Content, tool.Path)
	case "webSearch":
		return p.ParseWebSearch(tool.Content, tool.Path)
	default:
		return tool.Content
	}
}
