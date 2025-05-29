FROM node:20-slim AS base
 ENV PNPM_HOME="/pnpm"
 ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN npm install -g npm@latest
RUN npm install -g npm-run-all
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
# [python] Install Python 3.12.3 and uv 0.6.6
RUN apt install -y python3 python3-venv python3-dev python3-pip
# [rust] Install Rust 1.85
RUN curl https://sh.rustup.rs -sSf | bash -s -- -y
RUN echo 'source $HOME/.cargo/env' >> $HOME/.bashrc
 WORKDIR /home/vscode
 USER vscode

 # Copy evals
 RUN git clone https://github.com/RooCodeInc/Roo-Code-Evals.git evals

 # Prepare evals
 WORKDIR /home/vscode/evals/python
 RUN curl -LsSf https://astral.sh/uv/install.sh | sh
 RUN /home/vscode/.local/bin/uv sync

 WORKDIR /home/vscode/repo/benchmark

 # Install dependencies
 COPY --chown=vscode:vscode ./evals/package.json ./evals/pnpm-lock.yaml ./evals/pnpm-workspace.yaml ./evals/.npmrc ./
 RUN mkdir -p apps/cli apps/web \
   config/eslint config/typescript \
   packages/db packages/ipc packages/lib packages/types
 COPY --chown=vscode:vscode ./evals/apps/cli/package.json          ./apps/cli/
 COPY --chown=vscode:vscode ./evals/apps/web/package.json          ./apps/web/
 COPY --chown=vscode:vscode ./evals/config/eslint/package.json     ./config/eslint/
 COPY --chown=vscode:vscode ./evals/config/typescript/package.json ./config/typescript/
 COPY --chown=vscode:vscode ./evals/packages/db/package.json       ./packages/db/
 COPY --chown=vscode:vscode ./evals/packages/ipc/package.json      ./packages/ipc/
 COPY --chown=vscode:vscode ./evals/packages/lib/package.json      ./packages/lib/
 COPY --chown=vscode:vscode ./evals/packages/types/package.json    ./packages/types/
 RUN pnpm install

 # Copy & install extension
 COPY --chown=vscode:vscode ./bin/roo-code-latest.vsix ./
 RUN code --debug --install-extension ./roo-code-latest.vsix

 # Copy application code
 COPY --chown=vscode:vscode ./evals ./

 # Copy environment variables
 COPY --chown=vscode:vscode ./evals/.env ./

 # Push database schema
 RUN pnpm --filter @evals/db db:push

 EXPOSE 3000
 CMD ["pnpm", "web"]
