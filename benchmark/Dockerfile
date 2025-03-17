# docker build -f Dockerfile.base -t roo-code-benchmark-base ..
# docker build -f Dockerfile -t roo-code-benchmark ..
# docker run -d -it -p 3000:3000 -v /tmp/benchmarks.db:/tmp/benchmarks.db roo-code-benchmark
# docker exec -it $(docker ps --filter "ancestor=roo-code-benchmark" -q) /bin/bash

FROM ubuntu:latest

# Install dependencies
RUN apt update && apt install -y sudo curl git vim jq

# Create a `vscode` user
RUN useradd -m vscode -s /bin/bash && \
  echo "vscode ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/vscode && \
  chmod 0440 /etc/sudoers.d/vscode

# Install VS Code
# https://code.visualstudio.com/docs/setup/linux
RUN apt install -y wget gpg apt-transport-https
RUN wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg
RUN install -D -o root -g root -m 644 packages.microsoft.gpg /etc/apt/keyrings/packages.microsoft.gpg
RUN echo "deb [arch=amd64,arm64,armhf signed-by=/etc/apt/keyrings/packages.microsoft.gpg] https://packages.microsoft.com/repos/code stable main" | tee /etc/apt/sources.list.d/vscode.list > /dev/null
RUN rm -f packages.microsoft.gpg
RUN apt update && apt install -y code

# Install Xvfb
RUN apt install -y xvfb

# [cpp] Install cmake 3.28.3
RUN apt install -y cmake

# [go] Install Go 1.22.2
RUN apt install -y golang-go

# [java] Install Java 21
RUN apt install -y default-jre

# [javascript] Install Node.js v18.20.6
RUN curl -sL https://deb.nodesource.com/setup_18.x | bash -
RUN apt update && apt install -y nodejs
RUN npm install -g corepack@latest

# [python] Install Python 3.12.3 and uv 0.6.6
RUN apt install -y python3 python3-venv python3-dev python3-pip

# [rust] Install Rust 1.85
RUN curl https://sh.rustup.rs -sSf | bash -s -- -y
RUN echo 'source $HOME/.cargo/env' >> $HOME/.bashrc

WORKDIR /home/vscode
USER vscode

# Enable corepack and install pnpm for the vscode user
RUN corepack enable
RUN yes y | pnpm --version

COPY benchmark/entrypoint.sh /usr/local/bin/entrypoint.sh

# Copy and build dependencies
COPY --chown=vscode:vscode package*.json /home/vscode/repo/
COPY --chown=vscode:vscode webview-ui/package*.json /home/vscode/repo/webview-ui/
COPY --chown=vscode:vscode e2e/package*.json /home/vscode/repo/e2e/
COPY --chown=vscode:vscode benchmark/package*.json /home/vscode/repo/benchmark/
WORKDIR /home/vscode/repo
RUN npm run install:all

# Copy and build benchmark runner
COPY --chown=vscode:vscode . /home/vscode/repo
WORKDIR /home/vscode/repo/benchmark
RUN npm run build

# Copy exercises
WORKDIR /home/vscode
RUN git clone https://github.com/cte/Roo-Code-Benchmark.git exercises

# Prepare exercises
WORKDIR /home/vscode/exercises/python
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
RUN /home/vscode/.local/bin/uv sync

# Build web-ui
WORKDIR /home/vscode/exercises/web-ui
RUN echo "DB_FILE_NAME=file:/tmp/benchmarks.db" > .env
RUN pnpm install
RUN npx drizzle-kit push

# Run web-ui
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/bin/pnpm", "dev"]
