#!/bin/bash

# Cline CLI - Compute Engine Deployment Script
# This script creates a GCP Compute Engine VM and sets it up to run the Cline CLI

set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-cline-preview}"
ZONE="${GCP_ZONE:-us-central1-a}"
MACHINE_TYPE="${GCP_MACHINE_TYPE:-e2-medium}"
VM_NAME="${VM_NAME:-cline-cli-vm}"
IMAGE="gcr.io/${PROJECT_ID}/cline-cli:latest"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Cline CLI - Compute Engine Deployment ===${NC}\n"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed${NC}"
    echo "Install it with: brew install --cask google-cloud-sdk"
    exit 1
fi

# Check if user is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" &> /dev/null; then
    echo -e "${YELLOW}Not authenticated. Running gcloud auth login...${NC}"
    gcloud auth login
fi

# Set project
echo -e "${YELLOW}Setting project to: ${PROJECT_ID}${NC}"
gcloud config set project "${PROJECT_ID}"

# Check if VM already exists
if gcloud compute instances describe "${VM_NAME}" --zone="${ZONE}" &> /dev/null; then
    echo -e "${YELLOW}VM '${VM_NAME}' already exists in zone ${ZONE}${NC}"
    read -p "Do you want to delete and recreate it? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Deleting existing VM...${NC}"
        gcloud compute instances delete "${VM_NAME}" --zone="${ZONE}" --quiet
    else
        echo -e "${GREEN}Using existing VM. To connect, run:${NC}"
        echo -e "  gcloud compute ssh ${VM_NAME} --zone=${ZONE}"
        exit 0
    fi
fi

# Create the VM with Container-Optimized OS
echo -e "${GREEN}Creating VM: ${VM_NAME}${NC}"
echo "  Zone: ${ZONE}"
echo "  Machine type: ${MACHINE_TYPE}"
echo "  Image: ${IMAGE}"
echo

gcloud compute instances create "${VM_NAME}" \
    --zone="${ZONE}" \
    --machine-type="${MACHINE_TYPE}" \
    --image-family=cos-stable \
    --image-project=cos-cloud \
    --boot-disk-size=20GB \
    --boot-disk-type=pd-standard \
    --scopes=cloud-platform \
    --metadata=google-logging-enabled=true

echo -e "\n${GREEN}VM created successfully!${NC}\n"

# Wait for VM to be ready
echo -e "${YELLOW}Waiting for VM to be ready...${NC}"
sleep 10

# Create a startup script that will be uploaded to the VM
cat > /tmp/cline-setup.sh << 'EOF'
#!/bin/bash
set -e

echo "=== Setting up Cline CLI on VM ==="

# Configure Docker to use gcloud for authentication
gcloud auth configure-docker --quiet

# Pull the Cline CLI image
echo "Pulling Cline CLI image..."
docker pull gcr.io/cline-preview/cline-cli:latest

# Create a helper script to run Cline
cat > /home/$(whoami)/run-cline.sh << 'INNER_EOF'
#!/bin/bash

# Check if ANTHROPIC_API_KEY is set
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "Error: ANTHROPIC_API_KEY environment variable is not set"
    echo "Set it with: export ANTHROPIC_API_KEY='your-key-here'"
    exit 1
fi

# Run Cline CLI in Docker
docker run -it --rm \
    -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
    -v "$(pwd):/workspace" \
    -v cline-home:/root/.cline \
    gcr.io/cline-preview/cline-cli:latest "$@"
INNER_EOF

chmod +x /home/$(whoami)/run-cline.sh

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "To use Cline CLI:"
echo "  1. Set your API key: export ANTHROPIC_API_KEY='your-key-here'"
echo "  2. Run Cline: ./run-cline.sh"
echo ""
echo "Or run directly with Docker:"
echo "  docker run -it --rm -e ANTHROPIC_API_KEY=\$ANTHROPIC_API_KEY gcr.io/cline-preview/cline-cli:latest"
echo ""
EOF

# Copy setup script to VM and execute it
echo -e "${YELLOW}Setting up Cline CLI on the VM...${NC}"
gcloud compute scp /tmp/cline-setup.sh "${VM_NAME}:/tmp/cline-setup.sh" --zone="${ZONE}"
gcloud compute ssh "${VM_NAME}" --zone="${ZONE}" --command="bash /tmp/cline-setup.sh"

# Clean up local temp file
rm /tmp/cline-setup.sh

echo -e "\n${GREEN}=== Deployment Complete! ===${NC}\n"
echo -e "To connect to your VM and use Cline CLI:"
echo -e "  ${YELLOW}gcloud compute ssh ${VM_NAME} --zone=${ZONE}${NC}"
echo -e "\nOnce connected:"
echo -e "  1. Set your API key: ${YELLOW}export ANTHROPIC_API_KEY='your-key-here'${NC}"
echo -e "  2. Run Cline: ${YELLOW}./run-cline.sh${NC}"
echo -e "\nTo stop the VM (to save costs):"
echo -e "  ${YELLOW}gcloud compute instances stop ${VM_NAME} --zone=${ZONE}${NC}"
echo -e "\nTo start it again:"
echo -e "  ${YELLOW}gcloud compute instances start ${VM_NAME} --zone=${ZONE}${NC}"
echo -e "\nTo delete the VM:"
echo -e "  ${YELLOW}gcloud compute instances delete ${VM_NAME} --zone=${ZONE}${NC}"
echo
