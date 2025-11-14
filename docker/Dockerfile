FROM node:22-slim

# Docker automatically sets TARGETARCH to the build platform's architecture
ARG TARGETARCH

# Install only runtime dependencies
RUN apt-get update && apt-get install -y \
    git curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/cline

# Copy the entire pre-built distribution
COPY dist-standalone/ ./

# Create symlink for Linux native modules
# Map Docker's TARGETARCH (arm64/amd64) to Node's platform naming (x64 for amd64)
RUN if [ "$TARGETARCH" = "amd64" ]; then \
        ln -sf /opt/cline/binaries/linux-x64/node_modules/better-sqlite3 /opt/cline/node_modules/better-sqlite3; \
    else \
        ln -sf /opt/cline/binaries/linux-$TARGETARCH/node_modules/better-sqlite3 /opt/cline/node_modules/better-sqlite3; \
    fi

# Set up CLI binaries
# The Linux binaries are already in /opt/cline/bin/ from dist-standalone
# Just need to create symlinks to the platform-specific ones
RUN cd /opt/cline/bin && \
    ln -sf cline-linux-$TARGETARCH cline && \
    ln -sf cline-host-linux-$TARGETARCH cline-host && \
    chmod +x cline-linux-$TARGETARCH cline-host-linux-$TARGETARCH cline cline-host

# Add binaries to PATH
ENV PATH="/opt/cline/bin:${PATH}"
ENV NODE_ENV=production
ENV CLINE_HOME=/root/.cline

RUN mkdir -p $CLINE_HOME

WORKDIR /workspace

EXPOSE 8000

ENTRYPOINT ["/opt/cline/bin/cline"]
CMD ["--help"]
