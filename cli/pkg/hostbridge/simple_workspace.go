package hostbridge

import (
	"context"
	"log"
	"os"

	"github.com/cline/grpc-go/cline"
	"github.com/cline/grpc-go/host"
)

// SimpleWorkspaceService implements a basic workspace service without complex dependencies
type SimpleWorkspaceService struct {
	host.UnimplementedWorkspaceServiceServer
	verbose bool
}

// NewSimpleWorkspaceService creates a new SimpleWorkspaceService
func NewSimpleWorkspaceService(verbose bool) *SimpleWorkspaceService {
	return &SimpleWorkspaceService{
		verbose: verbose,
	}
}

// GetWorkspacePaths returns the workspace directory paths
func (s *SimpleWorkspaceService) GetWorkspacePaths(ctx context.Context, req *host.GetWorkspacePathsRequest) (*host.GetWorkspacePathsResponse, error) {
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
func (s *SimpleWorkspaceService) SaveOpenDocumentIfDirty(ctx context.Context, req *host.SaveOpenDocumentIfDirtyRequest) (*host.SaveOpenDocumentIfDirtyResponse, error) {
	if s.verbose {
		log.Printf("SaveOpenDocumentIfDirty called for path: %s", req.GetFilePath())
	}

	// For console implementation, we'll assume the document is already saved
	wasSaved := false
	return &host.SaveOpenDocumentIfDirtyResponse{
		WasSaved: &wasSaved,
	}, nil
}

// GetDiagnostics returns diagnostic information for a file - simplified version
func (s *SimpleWorkspaceService) GetDiagnostics(ctx context.Context, req *host.GetDiagnosticsRequest) (*host.GetDiagnosticsResponse, error) {
	if s.verbose {
		log.Printf("GetDiagnostics called")
	}

	// For console implementation, return empty diagnostics
	return &host.GetDiagnosticsResponse{
		FileDiagnostics: []*cline.FileDiagnostics{},
	}, nil
}
