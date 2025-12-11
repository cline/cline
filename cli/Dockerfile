# Use an Ubuntu base image as requested
FROM ubuntu:24.04

# Set the working directory
WORKDIR /app

# Install necessary system packages for Node.js, Go, and Git
# apt-get update && apt-get upgrade -y is recommended for base images
RUN apt-get update && \
    # apt-get upgrade -y && \
    apt-get install -y ca-certificates curl gnupg git wget xz-utils && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js and npm (download latest stable version directly)
ARG NODE_VERSION=v24.12.0
RUN curl -fsSL https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz -o /tmp/node.tar.xz && \
    tar -C /usr/local --strip-components 1 -xf /tmp/node.tar.xz && \
    rm /tmp/node.tar.xz

RUN npm install -g cline

COPY bin/cline /usr/local/bin/cline
COPY bin/cline-host /usr/local/bin/cline-host
