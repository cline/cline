package display

import (
	"os"
	"strconv"
	"strings"

	"fmt"

	"github.com/charmbracelet/glamour"
	"golang.org/x/term"
)

type MarkdownRenderer struct {
	renderer *glamour.TermRenderer
	width    int
}

// i went back and forth on whether or not to enable word wrap
// setting line width to 0 enables the terminal to handle wrapping
// setting it to a terminal width enables glamour's word wrap
// the thing is, glamour's nice indentation looks really good, and
// won't work without glamour's word wrap - if you use the terminal's
// word wrap, the indentation looks weird so you have to turn it off
// and everything will be right next to the left margin
// but if you DO use glamours word wrap, it also means if you resize the terminal,
// it will scuff everything. but given that this is the case for the input anyway, 
// i figure we just make things as beautiful as possible 
// and if you resize the terminal, you'll learn real quick.
// anyway, you can set this to true or false to experiment
const USETERMINALWORDWRAP = true


// seems like a reliable way to check for terminals
// for now i'm keeping everything as auto
// eventually we can define a custom glamour style for ghostty / iterm
// https://github.com/charmbracelet/glamour/blob/master/styles/README.md)
func detectTerminalTheme() string {
	switch os.Getenv("TERM_PROGRAM") {
	case "iTerm.app", "Ghostty":
		return "dark"
	}
	if os.Getenv("GHOSTTY_VERSION") != "" {
		return "dark"
	}
	return "dark"
}

func glamourStyleJSON(terminalWrap bool) string {
	const tmpl = `{
		"document": {
			"block_prefix": "\n",
			"block_suffix": "\n",
			"color": "252",
			"margin": %s
		},
		"code_block": {
			"margin": 0
		}
	}`
	if terminalWrap {
		return fmt.Sprintf(tmpl, "0")
	}
	return fmt.Sprintf(tmpl, "2")
}




func NewMarkdownRenderer() (*MarkdownRenderer, error) {
	var wordWrap int
	if USETERMINALWORDWRAP {
		// terminal handles wrapping -> disable glamour wrap
		wordWrap = 0
	} else {
		// glamour handles wrapping -> set to current width
		wordWrap = terminalWidthOr(0)
	}

	r, err := glamour.NewTermRenderer(
		glamour.WithStandardStyle(detectTerminalTheme()),              	 					 // Load full auto style first
		glamour.WithStylesFromJSONBytes([]byte(glamourStyleJSON(USETERMINALWORDWRAP))),  	 // Then override just margins
		glamour.WithWordWrap(wordWrap),                        
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

// terminalWidthOr returns the terminal width or the provided fallback.
// It first tries term.GetSize, then falls back to $COLUMNS if set.
func terminalWidthOr(fallback int) int {
	if w, _, err := term.GetSize(int(os.Stdout.Fd())); err == nil && w > 0 {
		return w
	}
	if cols := os.Getenv("COLUMNS"); cols != "" {
		if n, err := strconv.Atoi(cols); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

// NewMarkdownRendererWithWidth creates a markdown renderer with a specific width.
// Useful for tables and other content that should fit within terminal bounds.
func NewMarkdownRendererWithWidth(width int) (*MarkdownRenderer, error) {
	r, err := glamour.NewTermRenderer(
		glamour.WithStandardStyle(detectTerminalTheme()),
		glamour.WithStylesFromJSONBytes([]byte(glamourStyleJSON(false))),
		glamour.WithWordWrap(width),
		glamour.WithPreservedNewLines(),
	)
	if err != nil {
		return nil, err
	}
	return &MarkdownRenderer{renderer: r, width: width}, nil
}


// NewMarkdownRendererForTerminal creates a markdown renderer using the actual terminal width.
// Falls back to 120 if terminal width cannot be determined.
func NewMarkdownRendererForTerminal() (*MarkdownRenderer, error) {
	width := terminalWidthOr(120)
	return NewMarkdownRendererWithWidth(width)
}

func (mr *MarkdownRenderer) Render(markdown string) (string, error) {
	rendered, err := mr.renderer.Render(markdown)
	if err != nil {
		return "", err
	}
	return strings.TrimLeft(strings.TrimRight(rendered, "\n"), "\n"), nil
}
