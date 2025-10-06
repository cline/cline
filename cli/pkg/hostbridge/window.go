package hostbridge

import (
	"context"
	"fmt"
	"log"

	proto "github.com/cline/grpc-go/host"
)

// WindowService implements the proto.WindowServiceServer interface
type WindowService struct {
	proto.UnimplementedWindowServiceServer
	verbose bool
}

// NewWindowService creates a new WindowService
func NewWindowService(verbose bool) *WindowService {
	return &WindowService{
		verbose: verbose,
	}
}

// ShowTextDocument opens a text document for viewing/editing
func (s *WindowService) ShowTextDocument(ctx context.Context, req *proto.ShowTextDocumentRequest) (*proto.TextEditorInfo, error) {
	if s.verbose {
		log.Printf("ShowTextDocument called for path: %s", req.GetPath())
	}

	// For console implementation, we'll just log that we would open the document
	fmt.Printf("[Cline] Would open document: %s\n", req.GetPath())

	return &proto.TextEditorInfo{
		DocumentPath: req.GetPath(),
		IsActive:     true,
	}, nil
}

// ShowOpenDialogue shows a file open dialog
func (s *WindowService) ShowOpenDialogue(ctx context.Context, req *proto.ShowOpenDialogueRequest) (*proto.SelectedResources, error) {
	if s.verbose {
		log.Printf("ShowOpenDialogue called")
	}

	// For console implementation, return empty list (user cancelled)
	return &proto.SelectedResources{
		Paths: []string{},
	}, nil
}

// ShowMessage displays a message to the user
func (s *WindowService) ShowMessage(ctx context.Context, req *proto.ShowMessageRequest) (*proto.SelectedResponse, error) {
	if s.verbose {
		log.Printf("ShowMessage called: %s", req.GetMessage())
	}

	// Display message to console
	fmt.Printf("[Cline] %s\n", req.GetMessage())

	return &proto.SelectedResponse{}, nil
}

// ShowInputBox shows an input dialog to the user
func (s *WindowService) ShowInputBox(ctx context.Context, req *proto.ShowInputBoxRequest) (*proto.ShowInputBoxResponse, error) {
	if s.verbose {
		log.Printf("ShowInputBox called: %s", req.GetTitle())
	}

	// For console implementation, return empty response (user cancelled)
	return &proto.ShowInputBoxResponse{}, nil
}

// ShowSaveDialog shows a save file dialog
func (s *WindowService) ShowSaveDialog(ctx context.Context, req *proto.ShowSaveDialogRequest) (*proto.ShowSaveDialogResponse, error) {
	if s.verbose {
		log.Printf("ShowSaveDialog called")
	}

	// For console implementation, return empty response (user cancelled)
	return &proto.ShowSaveDialogResponse{}, nil
}

// OpenFile opens a file in the editor
func (s *WindowService) OpenFile(ctx context.Context, req *proto.OpenFileRequest) (*proto.OpenFileResponse, error) {
	if s.verbose {
		log.Printf("OpenFile called for path: %s", req.GetFilePath())
	}

	// For console implementation, just log that we would open the file
	fmt.Printf("[Cline] Would open file: %s\n", req.GetFilePath())

	return &proto.OpenFileResponse{}, nil
}

// GetOpenTabs returns a list of currently open tabs
func (s *WindowService) GetOpenTabs(ctx context.Context, req *proto.GetOpenTabsRequest) (*proto.GetOpenTabsResponse, error) {
	if s.verbose {
		log.Printf("GetOpenTabs called")
	}

	// For console implementation, return empty list
	return &proto.GetOpenTabsResponse{
		Paths: []string{},
	}, nil
}

// GetVisibleTabs returns a list of currently visible tabs
func (s *WindowService) GetVisibleTabs(ctx context.Context, req *proto.GetVisibleTabsRequest) (*proto.GetVisibleTabsResponse, error) {
	if s.verbose {
		log.Printf("GetVisibleTabs called")
	}

	// For console implementation, return empty list
	return &proto.GetVisibleTabsResponse{
		Paths: []string{},
	}, nil
}

// GetActiveEditor returns information about the current active editor
func (s *WindowService) GetActiveEditor(ctx context.Context, req *proto.GetActiveEditorRequest) (*proto.GetActiveEditorResponse, error) {
	if s.verbose {
		log.Printf("GetActiveEditor called")
	}

	// Return empty response (no active file)
	return &proto.GetActiveEditorResponse{
		FilePath: nil,
	}, nil
}
