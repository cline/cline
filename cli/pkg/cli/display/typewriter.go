package display

import (
	"fmt"
	"os"
	"time"
)

// TypewriterConfig holds configuration for the typewriter effect
type TypewriterConfig struct {
	BaseDelay    time.Duration // Base delay between characters
	FastDelay    time.Duration // Faster delay for common characters
	SlowDelay    time.Duration // Slower delay for punctuation
	PauseDelay   time.Duration // Pause after sentences
	Enabled      bool          // Whether typewriter effect is enabled
	RandomFactor float64       // Randomness factor (0.0 to 1.0)
}

// DefaultTypewriterConfig returns the default typewriter configuration
func DefaultTypewriterConfig() *TypewriterConfig {
	return &TypewriterConfig{
		BaseDelay:    15 * time.Millisecond,
		FastDelay:    8 * time.Millisecond,
		SlowDelay:    25 * time.Millisecond,
		PauseDelay:   150 * time.Millisecond,
		Enabled:      false,
		RandomFactor: 0.3,
	}
}

// TypewriterPrinter handles typewriter-style output
type TypewriterPrinter struct {
	config *TypewriterConfig
}

// NewTypewriterPrinter creates a new typewriter printer
func NewTypewriterPrinter(config *TypewriterConfig) *TypewriterPrinter {
	if config == nil {
		config = DefaultTypewriterConfig()
	}
	return &TypewriterPrinter{
		config: config,
	}
}

// Print prints text with typewriter effect
func (tp *TypewriterPrinter) Print(text string) {
	if !tp.config.Enabled {
		fmt.Print(text)
		return
	}

	tp.typewriterPrint(text)
}

// Printf prints formatted text with typewriter effect
func (tp *TypewriterPrinter) Printf(format string, args ...interface{}) {
	text := fmt.Sprintf(format, args...)
	tp.Print(text)
}

// Println prints text with typewriter effect and adds a newline
func (tp *TypewriterPrinter) Println(text string) {
	tp.Print(text + "\n")
}

// PrintfLn prints formatted text with typewriter effect and adds a newline
func (tp *TypewriterPrinter) PrintfLn(format string, args ...interface{}) {
	text := fmt.Sprintf(format, args...)
	tp.Println(text)
}

// PrintInstant prints text immediately without typewriter effect
func (tp *TypewriterPrinter) PrintInstant(text string) {
	fmt.Print(text)
}

// PrintfInstant prints formatted text immediately without typewriter effect
func (tp *TypewriterPrinter) PrintfInstant(format string, args ...interface{}) {
	fmt.Printf(format, args...)
}

// typewriterPrint displays text with a typewriter animation effect
func (tp *TypewriterPrinter) typewriterPrint(text string) {
	// Convert string to runes to handle Unicode properly
	runes := []rune(text)

	for i, r := range runes {
		// Print the character
		fmt.Print(string(r))
		os.Stdout.Sync() // Force immediate output

		// Don't add delay after the last character
		if i == len(runes)-1 {
			break
		}

		// Determine delay based on character type
		delay := tp.getDelayForCharacter(r, i)

		// Sleep for the calculated delay
		time.Sleep(delay)
	}
}

// getDelayForCharacter returns the appropriate delay for a character
func (tp *TypewriterPrinter) getDelayForCharacter(r rune, position int) time.Duration {
	var baseDelay time.Duration

	switch {
	case r == '.' || r == '!' || r == '?':
		// Longer pause after sentence endings
		baseDelay = tp.config.PauseDelay
	case r == ',' || r == ';' || r == ':':
		// Medium pause after punctuation
		baseDelay = tp.config.SlowDelay
	case r == ' ':
		// Slightly faster for spaces
		baseDelay = tp.config.FastDelay
	case r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z':
		// Fast for common letters
		baseDelay = tp.config.FastDelay
	case r == '\n':
		// No delay for newlines
		return 0
	default:
		// Base delay for other characters
		baseDelay = tp.config.BaseDelay
	}

	// Add randomness to make it feel more natural
	if tp.config.RandomFactor > 0 {
		// Simple pseudo-random based on position to ensure consistency
		randomFactor := 0.7 + (tp.config.RandomFactor * float64(position%7) / 6.0)
		baseDelay = time.Duration(float64(baseDelay) * randomFactor)
	}

	return baseDelay
}

// SetEnabled enables or disables the typewriter effect
func (tp *TypewriterPrinter) SetEnabled(enabled bool) {
	tp.config.Enabled = enabled
}

// IsEnabled returns whether the typewriter effect is enabled
func (tp *TypewriterPrinter) IsEnabled() bool {
	return tp.config.Enabled
}

// SetSpeed adjusts the typewriter speed (multiplier: 0.1 = very slow, 1.0 = normal, 2.0 = fast)
func (tp *TypewriterPrinter) SetSpeed(multiplier float64) {
	if multiplier <= 0 {
		multiplier = 1.0
	}

	tp.config.BaseDelay = time.Duration(float64(15*time.Millisecond) / multiplier)
	tp.config.FastDelay = time.Duration(float64(8*time.Millisecond) / multiplier)
	tp.config.SlowDelay = time.Duration(float64(25*time.Millisecond) / multiplier)
	tp.config.PauseDelay = time.Duration(float64(150*time.Millisecond) / multiplier)
}

func (tp *TypewriterPrinter) PrintMessageLine(prefix, text string) {
	tp.PrintfInstant("%s: ", prefix)
	tp.Println(text)
}

// Global typewriter printer instance
var globalTypewriter = NewTypewriterPrinter(DefaultTypewriterConfig())

// Global convenience functions that use the global typewriter instance

// TypewriterPrint prints text with typewriter effect using the global instance
func TypewriterPrint(text string) {
	globalTypewriter.Print(text)
}

// TypewriterPrintf prints formatted text with typewriter effect using the global instance
func TypewriterPrintf(format string, args ...interface{}) {
	globalTypewriter.Printf(format, args...)
}

// TypewriterPrintln prints text with typewriter effect and newline using the global instance
func TypewriterPrintln(text string) {
	globalTypewriter.Println(text)
}

// TypewriterPrintfLn prints formatted text with typewriter effect and newline using the global instance
func TypewriterPrintfLn(format string, args ...interface{}) {
	globalTypewriter.PrintfLn(format, args...)
}

func TypewriterPrintMessageLine(prefix, text string) {
	globalTypewriter.PrintMessageLine(prefix, text)
}

// SetGlobalTypewriterEnabled enables or disables the global typewriter effect
func SetGlobalTypewriterEnabled(enabled bool) {
	globalTypewriter.SetEnabled(enabled)
}

// SetGlobalTypewriterSpeed sets the speed of the global typewriter effect
func SetGlobalTypewriterSpeed(multiplier float64) {
	globalTypewriter.SetSpeed(multiplier)
}

// GetGlobalTypewriter returns the global typewriter instance
func GetGlobalTypewriter() *TypewriterPrinter {
	return globalTypewriter
}
