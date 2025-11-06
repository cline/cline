# Multi-stage build for Cline CLI Docker image
# Optimized for both local development and Cloud Run deployment

# Stage 1: Builder - Install dependencies and compile native modules
FROM node:21 AS builder

# Install build dependencies for native modules (better-sqlite3, grpc)
RUN apt-get update && apt-get install -y \
    make \
    g++ \
    git \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Install Cline CLI globally
RUN npm install -g cline

# Stage 2: Runtime - Minimal image with only runtime dependencies
FROM node:21

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy Cline CLI from builder stage
COPY --from=builder /usr/local/lib/node_modules/cline /usr/local/lib/node_modules/cline
COPY --from=builder /usr/local/bin/cline /usr/local/bin/cline
COPY --from=builder /usr/local/bin/cline-host /usr/local/bin/cline-host

# Create workspace directory
WORKDIR /workspace

# Copy vscode stub module (needed by cline-core.js)
COPY standalone/runtime-files/vscode /usr/local/fake_node_modules/vscode

# Copy proto descriptor (needed by cline-core for gRPC)
COPY proto/descriptor_set.pb /usr/local/lib/node_modules/cline/proto/descriptor_set.pb

# Copy entrypoint script
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Set environment variables
ENV NODE_ENV=production
ENV CLINE_HOME=/root/.cline
ENV NODE_PATH=/usr/local/node_modules:/usr/local/fake_node_modules

# Create Cline home directory
RUN mkdir -p $CLINE_HOME

# Create symlink for cline-core.js so CLI can find it
RUN ln -s /usr/local/lib/node_modules/cline/cline-core.js /usr/local/cline-core.js

# Expose port for potential web interface or API
EXPOSE 8080

# Set entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Default command (can be overridden)
CMD ["--help"]
