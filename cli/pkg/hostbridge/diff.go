package hostbridge

import (
	"context"
	"fmt"
	"io/ioutil"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	proto "github.com/cline/grpc-go/host"
)

// diffSession represents an in-memory diff editing session
type diffSession struct {
	originalPath    string   // File path from OpenDiff request
	originalContent []byte   // Original file content (for comparison)
	currentContent  []byte   // Current modified content
	lines           []string // Current content split into lines
	encoding        string   // File encoding (default: utf8)
}

// DiffService implements the proto.DiffServiceServer interface
type DiffService struct {
	proto.UnimplementedDiffServiceServer
	verbose  bool
	sessions *sync.Map // thread-safe: diffId -> *diffSession
	counter  *int64    // atomic counter for unique IDs
}

// NewDiffService creates a new DiffService
func NewDiffService(verbose bool) *DiffService {
	counter := int64(0)
	return &DiffService{
		verbose:  verbose,
		sessions: &sync.Map{},
		counter:  &counter,
	}
}

// generateDiffID creates a unique diff ID
func (s *DiffService) generateDiffID() string {
	id := atomic.AddInt64(s.counter, 1)
	return fmt.Sprintf("diff_%d_%d", os.Getpid(), id)
}

// splitLines splits content into lines, preserving line ending information
func splitLines(content string) []string {
	if content == "" {
		return []string{}
	}

	lines := []string{}
	current := ""

	for _, char := range content {
		if char == '\n' {
			lines = append(lines, current)
			current = ""
		} else if char != '\r' { // Skip \r characters, handle \r\n as \n
			current += string(char)
		}
	}

	// Add the last line if it doesn't end with newline
	if current != "" {
		lines = append(lines, current)
	}

	return lines
}

// joinLines joins lines back into content with newlines
func joinLines(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, "\n")
}

// OpenDiff opens a diff view for the specified file
func (s *DiffService) OpenDiff(ctx context.Context, req *proto.OpenDiffRequest) (*proto.OpenDiffResponse, error) {
	if s.verbose {
		log.Printf("OpenDiff called for path: %s", req.GetPath())
	}

	diffID := s.generateDiffID()

	var originalContent []byte

	// Check if file exists and read original content
	if req.GetPath() != "" {
		if _, err := os.Stat(req.GetPath()); err == nil {
			// File exists, read its content
			var readErr error
			originalContent, readErr = ioutil.ReadFile(req.GetPath())
			if readErr != nil {
				return nil, fmt.Errorf("failed to read original file: %w", readErr)
			}
		} else {
			// File doesn't exist, use empty content
			originalContent = []byte{}
		}
	}

	// Use provided content as the initial current content
	currentContent := []byte(req.GetContent())

	// Create the diff session
	session := &diffSession{
		originalPath:    req.GetPath(),
		originalContent: originalContent,
		currentContent:  currentContent,
		lines:           splitLines(req.GetContent()),
		encoding:        "utf8", // Default encoding
	}

	// Store the session
	s.sessions.Store(diffID, session)

	if s.verbose {
		log.Printf("Created diff session: %s (original: %d bytes, current: %d bytes)",
			diffID, len(originalContent), len(currentContent))
	}

	return &proto.OpenDiffResponse{
		DiffId: &diffID,
	}, nil
}

// GetDocumentText returns the current content of the diff document
func (s *DiffService) GetDocumentText(ctx context.Context, req *proto.GetDocumentTextRequest) (*proto.GetDocumentTextResponse, error) {
	if s.verbose {
		log.Printf("GetDocumentText called for diff ID: %s", req.GetDiffId())
	}

	sessionInterface, exists := s.sessions.Load(req.GetDiffId())
	if !exists {
		return nil, fmt.Errorf("diff session not found: %s", req.GetDiffId())
	}

	session := sessionInterface.(*diffSession)
	content := string(session.currentContent)

	return &proto.GetDocumentTextResponse{
		Content: &content,
	}, nil
}

// ReplaceText replaces text in the diff document using line-based operations
func (s *DiffService) ReplaceText(ctx context.Context, req *proto.ReplaceTextRequest) (*proto.ReplaceTextResponse, error) {
	if s.verbose {
		log.Printf("ReplaceText called for diff ID: %s, lines %d-%d",
			req.GetDiffId(), req.GetStartLine(), req.GetEndLine())
	}

	sessionInterface, exists := s.sessions.Load(req.GetDiffId())
	if !exists {
		return nil, fmt.Errorf("diff session not found: %s", req.GetDiffId())
	}

	session := sessionInterface.(*diffSession)

	startLine := int(req.GetStartLine())
	endLine := int(req.GetEndLine())
	newContent := req.GetContent()

	// Validate line ranges
	if startLine < 0 {
		startLine = 0
	}
	if endLine < startLine {
		endLine = startLine
	}

	// Split new content into lines
	newLines := splitLines(newContent)

	// Ensure we have enough lines in the current content
	for len(session.lines) < endLine {
		session.lines = append(session.lines, "")
	}

	// Replace the specified line range
	if endLine > len(session.lines) {
		// Extending beyond current content - append new lines
		session.lines = append(session.lines[:startLine], newLines...)
	} else {
		// Replace within existing content
		result := make([]string, 0, len(session.lines)-endLine+startLine+len(newLines))
		result = append(result, session.lines[:startLine]...)
		result = append(result, newLines...)
		result = append(result, session.lines[endLine:]...)
		session.lines = result
	}

	// Update current content
	session.currentContent = []byte(joinLines(session.lines))

	// Store the updated session
	s.sessions.Store(req.GetDiffId(), session)

	if s.verbose {
		log.Printf("Updated diff session %s: %d lines, %d bytes",
			req.GetDiffId(), len(session.lines), len(session.currentContent))
	}

	return &proto.ReplaceTextResponse{}, nil
}

// ScrollDiff scrolls the diff view to a specific line (no-op for CLI)
func (s *DiffService) ScrollDiff(ctx context.Context, req *proto.ScrollDiffRequest) (*proto.ScrollDiffResponse, error) {
	if s.verbose {
		log.Printf("ScrollDiff called for diff ID: %s, line: %d", req.GetDiffId(), req.GetLine())
	}

	// Verify session exists
	if _, exists := s.sessions.Load(req.GetDiffId()); !exists {
		return nil, fmt.Errorf("diff session not found: %s", req.GetDiffId())
	}

	// In a CLI implementation, scrolling is a no-op
	// In a GUI implementation, this would scroll the view to the specified line
	return &proto.ScrollDiffResponse{}, nil
}

// TruncateDocument truncates the diff document at the specified line
func (s *DiffService) TruncateDocument(ctx context.Context, req *proto.TruncateDocumentRequest) (*proto.TruncateDocumentResponse, error) {
	if s.verbose {
		log.Printf("TruncateDocument called for diff ID: %s, end line: %d", req.GetDiffId(), req.GetEndLine())
	}

	sessionInterface, exists := s.sessions.Load(req.GetDiffId())
	if !exists {
		return nil, fmt.Errorf("diff session not found: %s", req.GetDiffId())
	}

	session := sessionInterface.(*diffSession)
	endLine := int(req.GetEndLine())

	// Truncate lines at the specified position
	if endLine >= 0 && endLine < len(session.lines) {
		session.lines = session.lines[:endLine]
		session.currentContent = []byte(joinLines(session.lines))

		// Store the updated session
		s.sessions.Store(req.GetDiffId(), session)

		if s.verbose {
			log.Printf("Truncated diff session %s to %d lines", req.GetDiffId(), len(session.lines))
		}
	}

	return &proto.TruncateDocumentResponse{}, nil
}

// SaveDocument saves the diff document to the original file
func (s *DiffService) SaveDocument(ctx context.Context, req *proto.SaveDocumentRequest) (*proto.SaveDocumentResponse, error) {
	if s.verbose {
		log.Printf("SaveDocument called for diff ID: %s", req.GetDiffId())
	}

	sessionInterface, exists := s.sessions.Load(req.GetDiffId())
	if !exists {
		return nil, fmt.Errorf("diff session not found: %s", req.GetDiffId())
	}

	session := sessionInterface.(*diffSession)

	if session.originalPath == "" {
		return nil, fmt.Errorf("no file path specified for diff session: %s", req.GetDiffId())
	}

	// Create parent directories if they don't exist
	dir := filepath.Dir(session.originalPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create directories: %w", err)
	}

	// Write the current content to the original file
	if err := ioutil.WriteFile(session.originalPath, session.currentContent, 0644); err != nil {
		return nil, fmt.Errorf("failed to save file: %w", err)
	}

	if s.verbose {
		log.Printf("Saved diff session %s to file: %s (%d bytes)",
			req.GetDiffId(), session.originalPath, len(session.currentContent))
	}

	return &proto.SaveDocumentResponse{}, nil
}

// CloseAllDiffs closes all diff views and cleans up all sessions
func (s *DiffService) CloseAllDiffs(ctx context.Context, req *proto.CloseAllDiffsRequest) (*proto.CloseAllDiffsResponse, error) {
	if s.verbose {
		log.Printf("CloseAllDiffs called")
	}

	var count int64

	s.sessions.Range(func(key, value any) bool {
		// Optional: attempt to close if the value supports it
		if c, ok := value.(interface{ Close() error }); ok {
			_ = c.Close() // best-effort; ignore error
		}

		s.sessions.Delete(key)
		atomic.AddInt64(&count, 1)
		return true
	})

	if s.verbose {
		log.Printf("Closed %d diff sessions", count)
	}

	return &proto.CloseAllDiffsResponse{}, nil
}

// OpenMultiFileDiff displays a diff view comparing before/after states for multiple files
func (s *DiffService) OpenMultiFileDiff(ctx context.Context, req *proto.OpenMultiFileDiffRequest) (*proto.OpenMultiFileDiffResponse, error) {
	if s.verbose {
		log.Printf("OpenMultiFileDiff called with title: %s, %d files", req.GetTitle(), len(req.GetDiffs()))
	}

	// In a CLI implementation, we could display the diffs to console
	// For now, we'll just log the information
	title := req.GetTitle()
	if title == "" {
		title = "Multi-file diff"
	}

	if s.verbose {
		log.Printf("=== %s ===", title)
		for i, diff := range req.GetDiffs() {
			log.Printf("File %d: %s", i+1, diff.GetFilePath())
			log.Printf("  Left content: %d bytes", len(diff.GetLeftContent()))
			log.Printf("  Right content: %d bytes", len(diff.GetRightContent()))
		}
	}

	// In a more sophisticated CLI implementation, we could:
	// 1. Use a diff library to generate unified diffs
	// 2. Display them with colors
	// 3. Allow navigation between files
	// For now, this is a no-op that just acknowledges the request

	return &proto.OpenMultiFileDiffResponse{}, nil
}
