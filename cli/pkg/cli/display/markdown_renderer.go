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

func (mr *MarkdownRenderer) Render(markdown string) (string, error) {
	rendered, err := mr.renderer.Render(markdown)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(rendered, "\n"), nil
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
