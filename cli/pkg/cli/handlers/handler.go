package handlers

import (
	"github.com/cline/cli/pkg/cli/display"
	"github.com/cline/cli/pkg/cli/types"
)

// MessageHandler defines the interface for handling different message types
type MessageHandler interface {
	// CanHandle returns true if this handler can process the given message
	CanHandle(msg *types.ClineMessage) bool

	// Handle processes the message and renders it using the display context
	Handle(msg *types.ClineMessage, dc *DisplayContext) error

	// GetPriority returns the priority of this handler (higher = more priority)
	GetPriority() int

	// GetName returns a human-readable name for this handler
	GetName() string
}

// DisplayContext provides context and utilities for message handlers
type DisplayContext struct {
	State          *types.ConversationState
	Renderer       *display.Renderer
	ToolRenderer   *display.ToolRenderer
	HookRenderer   *display.HookRenderer
	SystemRenderer *display.SystemMessageRenderer
	IsLast          bool
	IsPartial       bool
	Verbose         bool
	MessageIndex    int
	IsStreamingMode bool
	IsInteractive   bool
}

// BaseHandler provides common functionality for message handlers
type BaseHandler struct {
	name     string
	priority int
}

// NewBaseHandler creates a new base handler
func NewBaseHandler(name string, priority int) *BaseHandler {
	return &BaseHandler{
		name:     name,
		priority: priority,
	}
}

// GetName returns the handler name
func (h *BaseHandler) GetName() string {
	return h.name
}

// GetPriority returns the handler priority
func (h *BaseHandler) GetPriority() int {
	return h.priority
}

// HandlerRegistry manages a collection of message handlers
type HandlerRegistry struct {
	handlers []MessageHandler
}

// NewHandlerRegistry creates a new handler registry
func NewHandlerRegistry() *HandlerRegistry {
	return &HandlerRegistry{
		handlers: make([]MessageHandler, 0),
	}
}

// Register adds a handler to the registry
func (r *HandlerRegistry) Register(handler MessageHandler) {
	r.handlers = append(r.handlers, handler)

	// Sort handlers by priority (highest first)
	for i := len(r.handlers) - 1; i > 0; i-- {
		if r.handlers[i].GetPriority() > r.handlers[i-1].GetPriority() {
			r.handlers[i], r.handlers[i-1] = r.handlers[i-1], r.handlers[i]
		} else {
			break
		}
	}
}

// Handle finds the appropriate handler and processes the message
func (r *HandlerRegistry) Handle(msg *types.ClineMessage, dc *DisplayContext) error {
	for _, handler := range r.handlers {
		if handler.CanHandle(msg) {
			return handler.Handle(msg, dc)
		}
	}

	// If no specific handler found, use default text handler
	return r.handleDefault(msg, dc)
}

// handleDefault provides default handling for unrecognized messages
func (r *HandlerRegistry) handleDefault(msg *types.ClineMessage, dc *DisplayContext) error {
	if msg.Text == "" {
		return nil
	}

	prefix := "RESPONSE:"

	return dc.Renderer.RenderMessage(prefix, msg.Text, true)
}

// GetHandlers returns all registered handlers
func (r *HandlerRegistry) GetHandlers() []MessageHandler {
	return r.handlers
}

// GetHandlerByName finds a handler by name
func (r *HandlerRegistry) GetHandlerByName(name string) MessageHandler {
	for _, handler := range r.handlers {
		if handler.GetName() == name {
			return handler
		}
	}
	return nil
}

// HandlerPriorities defines standard priority levels for handlers
const (
	PriorityHigh   = 100
	PriorityNormal = 50
	PriorityLow    = 10
)
