package hostbridge

import (
	"context"
	"log"
	"os"

	"github.com/cline/grpc-go/host"
)

// WorkspaceService implements the host.WorkspaceServiceServer interface
type WorkspaceService struct {
	host.UnimplementedWorkspaceServiceServer
	coreAddress string
	verbose     bool
}

// NewWorkspaceService creates a new WorkspaceService
func NewWorkspaceService(coreAddress string, verbose bool) *WorkspaceService {
	return &WorkspaceService{
		coreAddress: coreAddress,
		verbose:     verbose,
	}
}

// GetWorkspacePaths returns the workspace directory paths
func (s *WorkspaceService) GetWorkspacePaths(ctx context.Context, req *host.GetWorkspacePathsRequest) (*host.GetWorkspacePathsResponse, error) {
	if s.verbose {
		log.Printf("GetWorkspacePaths called")
	}

	// Get current working directory as the workspace
	cwd, err := os.Getwd()
	if err != nil {
		return nil, err
	}

	return &host.GetWorkspacePathsResponse{
		Paths: []string{cwd},
	}, nil
}

// SaveOpenDocumentIfDirty saves an open document if it has unsaved changes
func (s *WorkspaceService) SaveOpenDocumentIfDirty(ctx context.Context, req *host.SaveOpenDocumentIfDirtyRequest) (*host.SaveOpenDocumentIfDirtyResponse, error) {
	if s.verbose {
		log.Printf("SaveOpenDocumentIfDirty called for path: %s", req.GetPath())
	}

	// For console implementation, we'll assume the document is already saved
	// In a real implementation, we'd check if the file has unsaved changes
	return &host.SaveOpenDocumentIfDirtyResponse{
		WasSaved: false, // Assume no changes to save
	}, nil
}

// GetDiagnostics returns diagnostic information for a file
func (s *WorkspaceService) GetDiagnostics(ctx context.Context, req *host.GetDiagnosticsRequest) (*host.GetDiagnosticsResponse, error) {
	if s.verbose {
		log.Printf("GetDiagnostics called for path: %s", req.GetPath())
	}

	// For console implementation, return empty diagnostics
	return &host.GetDiagnosticsResponse{
		Diagnostics: []*host.Diagnostic{},
	}, nil
}
