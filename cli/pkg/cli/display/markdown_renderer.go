package display

import (
	"strings"

	"github.com/charmbracelet/glamour"
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

func (mr *MarkdownRenderer) Render(markdown string) (string, error) {
	rendered, err := mr.renderer.Render(markdown)
	if err != nil {
		return "", err
	}
	return strings.TrimLeft(strings.TrimRight(rendered, "\n"), "\n"), nil
}
