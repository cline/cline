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
	r, err := glamour.NewTermRenderer(
		glamour.WithStandardStyle("auto"),
		glamour.WithWordWrap(0), // 0 = no wrapping, let terminal handle it
		glamour.WithPreservedNewLines(),
	)
	if err != nil {
		return nil, err
	}

	return &MarkdownRenderer{
		renderer: r,
		width:    0, // Unlimited width
	}, nil
}

// NewMarkdownRendererWithWidth creates a markdown renderer with a specific width.
// Useful for tables and other content that should fit within terminal bounds.
func NewMarkdownRendererWithWidth(width int) (*MarkdownRenderer, error) {
	r, err := glamour.NewTermRenderer(
		glamour.WithStandardStyle("auto"),
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

// NewMarkdownRendererForTerminal creates a markdown renderer using the actual terminal width.
// Falls back to 120 if terminal width cannot be determined.
func NewMarkdownRendererForTerminal() (*MarkdownRenderer, error) {
	width, _, err := term.GetSize(int(os.Stdout.Fd()))
	if err != nil || width == 0 {
		width = 120 // Fallback width
	}
	return NewMarkdownRendererWithWidth(width)
}

func (mr *MarkdownRenderer) Render(markdown string) (string, error) {
	rendered, err := mr.renderer.Render(markdown)
	if err != nil {
		return "", err
	}
	return strings.TrimLeft(strings.TrimRight(rendered, "\n"), "\n"), nil
}
