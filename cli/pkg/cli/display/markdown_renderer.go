package display

import (
	"os"
	"strings"

	"github.com/charmbracelet/glamour"
	"golang.org/x/term"
)

type MarkdownRenderer struct {
	renderer *glamour.TermRenderer
	width    int
}

func NewMarkdownRenderer() (*MarkdownRenderer, error) {
	width := getTerminalWidth()

	r, err := glamour.NewTermRenderer(
		glamour.WithStandardStyle("tokyo-night"),
		glamour.WithWordWrap(width),
		glamour.WithPreservedNewLines(),
	)
	if err != nil {
		return nil, err
	}

	return &MarkdownRenderer{
		renderer: r,
		width:    width,
	}, nil
}

func (mr *MarkdownRenderer) Render(markdown string) (string, error) {
	rendered, err := mr.renderer.Render(markdown)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(rendered, "\n"), nil
}

func (mr *MarkdownRenderer) CountLines(text string) int {
	if text == "" {
		return 0
	}
	
	// Split by newlines to get logical lines
	lines := strings.Split(text, "\n")
	visualLines := 0
	
	// Count visual lines accounting for terminal width wrapping
	for _, line := range lines {
		// Strip ANSI codes to get actual visual width
		visualWidth := stripAnsiLen(line)
		
		if visualWidth == 0 {
			// Empty line still takes up one visual line
			visualLines++
		} else {
			// Calculate how many visual lines this logical line will take
			// when wrapped at terminal width
			visualLines += (visualWidth + mr.width - 1) / mr.width
		}
	}
	
	return visualLines
}

// stripAnsiLen returns the visual length of a string after stripping ANSI escape codes
func stripAnsiLen(s string) int {
	length := 0
	inEscape := false
	
	for i := 0; i < len(s); i++ {
		if s[i] == '\033' && i+1 < len(s) && s[i+1] == '[' {
			inEscape = true
			i++ // Skip the '['
			continue
		}
		
		if inEscape {
			// Skip until we find the end of escape sequence (a letter)
			if (s[i] >= 'A' && s[i] <= 'Z') || (s[i] >= 'a' && s[i] <= 'z') {
				inEscape = false
			}
			continue
		}
		
		length++
	}
	
	return length
}

func getTerminalWidth() int {
	width, _, err := term.GetSize(int(os.Stdout.Fd()))
	if err != nil || width == 0 {
		return 120
	}
	if width > 150 {
		return 150
	}
	return width
}
