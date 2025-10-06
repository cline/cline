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
	coreAddress string
	verbose     bool
}

// NewWindowService creates a new WindowService
func NewWindowService(coreAddress string, verbose bool) *WindowService {
	return &WindowService{
		coreAddress: coreAddress,
		verbose:     verbose,
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
