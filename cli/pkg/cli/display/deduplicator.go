package display

import (
	"crypto/md5"
	"fmt"
	"sync"
	"time"

	"github.com/cline/cli/pkg/cli/types"
)

// MessageDeduplicator handles message deduplication to prevent duplicate displays
type MessageDeduplicator struct {
	mu            sync.RWMutex
	seenMessages  map[string]time.Time
	maxAge        time.Duration
	cleanupTicker *time.Ticker
}

// NewMessageDeduplicator creates a new message deduplicator
func NewMessageDeduplicator() *MessageDeduplicator {
	d := &MessageDeduplicator{
		seenMessages:  make(map[string]time.Time),
		maxAge:        5 * time.Minute,                 // Keep messages for 5 minutes
		cleanupTicker: time.NewTicker(1 * time.Minute), // Cleanup every minute
	}

	// Start cleanup goroutine
	go d.cleanup()

	return d
}

// IsDuplicate checks if a message is a duplicate
func (d *MessageDeduplicator) IsDuplicate(msg *types.ClineMessage) bool {
	d.mu.Lock()
	defer d.mu.Unlock()

	// Create a hash of the message content
	hash := d.hashMessage(msg)

	// Check if we've seen this message recently
	if lastSeen, exists := d.seenMessages[hash]; exists {
		// If we've seen it within the last few seconds, it's a duplicate
		if time.Since(lastSeen) < 2*time.Second {
			return true
		}
	}

	// Mark this message as seen
	d.seenMessages[hash] = time.Now()
	return false
}

// hashMessage creates a hash of the message for deduplication
func (d *MessageDeduplicator) hashMessage(msg *types.ClineMessage) string {
	// Create a hash based on message content, type, and timestamp
	content := fmt.Sprintf("%s|%s|%s|%d",
		string(msg.Type),
		msg.Say,
		msg.Ask,
		msg.Timestamp)

	// For partial messages, include the text content in the hash
	if msg.Partial {
		content += "|" + msg.Text
	}

	hash := md5.Sum([]byte(content))
	return fmt.Sprintf("%x", hash)
}

// cleanup removes old entries from the seen messages map
func (d *MessageDeduplicator) cleanup() {
	for range d.cleanupTicker.C {
		d.mu.Lock()
		now := time.Now()

		// Remove entries older than maxAge
		for hash, timestamp := range d.seenMessages {
			if now.Sub(timestamp) > d.maxAge {
				delete(d.seenMessages, hash)
			}
		}

		d.mu.Unlock()
	}
}

// Stop stops the cleanup goroutine
func (d *MessageDeduplicator) Stop() {
	if d.cleanupTicker != nil {
		d.cleanupTicker.Stop()
	}
}
