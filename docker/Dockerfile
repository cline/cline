# Simple Cline CLI Docker image using npm package
# Using ARM64 architecture for better compatibility

FROM node:21

# Install runtime dependencies including GitHub CLI
RUN apt-get update && apt-get install -y \
    git \
    curl \
    ca-certificates \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install Cline CLI globally
RUN npm install -g cline

# Create workspace directory
WORKDIR /workspace

# Clone the cline/cline repository
RUN git clone https://github.com/cline/cline.git /workspace/cline

# Set working directory to the cloned repository
WORKDIR /workspace/cline

# Copy entrypoint script
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Set environment variables
ENV NODE_ENV=production
ENV CLINE_HOME=/root/.cline

# Create Cline home directory
RUN mkdir -p $CLINE_HOME

# Expose port for potential web interface or API
EXPOSE 8080

# Set entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Default command (can be overridden)
CMD ["--help"]
