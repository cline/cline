#!/bin/bash
# Build script for Cline CLI Docker image

set -e

echo "Building Cline CLI Docker image..."
docker build -f Dockerfile -t cline-cli:latest ..

echo ""
echo "✅ Build complete!"
echo ""
echo "Test the image with:"
echo "  docker run --rm cline-cli:latest --help"
echo ""
echo "Run interactively:"
echo "  docker run --rm -it cline-cli:latest bash"
echo ""
echo "With API key:"
echo "  docker run --rm -e ANTHROPIC_API_KEY=your_key cline-cli:latest"
