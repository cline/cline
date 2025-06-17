# Run Roo Code Evals

### Prerequisites

- [Docker Desktop](https://docs.docker.com/desktop/)
- [git](https://git-scm.com/)
- That's it!

### Setup

Clone the Roo Code repo:

```sh
git clone https://github.com/RooCodeInc/Roo-Code.git
cd Roo-Code
```

Add your OpenRouter API key:

```sh
echo "OPENROUTER_API_KEY=sk-or-v1-[...]" > packages/evals/.env.local
```

### Run

Start the evals service:

```sh
docker compose -f packages/evals/docker-compose.yml --profile server --profile runner up --build --scale runner=0
```

The initial build process can take a minute or two. Upon success you should see ouput indicating that a web service is running on [localhost:3000](http://localhost:3000/):
<img width="1182" alt="Screenshot 2025-06-05 at 12 05 38 PM" src="https://github.com/user-attachments/assets/34f25a59-1362-458c-aafa-25e13cdb2a7a" />

Additionally, you'll find in Docker Desktop that database and redis services are running:
<img width="1283" alt="Screenshot 2025-06-05 at 12 07 09 PM" src="https://github.com/user-attachments/assets/ad75d791-9cc7-41e3-8168-df7b21b49da2" />

Navigate to [localhost:3446](http://localhost:3446/) in your browser and click the 🚀 button.

By default a evals run will run all programming exercises in [Roo Code Evals](https://github.com/RooCodeInc/Roo-Code-Evals) repository with the Claude Sonnet 4 model and default settings. For basic configuration you can specify the LLM to use and any subset of the exercises you'd like. For advanced configuration you can import a Roo Code settings file which will allow you to run the evals with Roo Code configured any way you'd like (this includes custom modes, a footgun prompt, etc).

<img width="1053" alt="Screenshot 2025-06-05 at 12 08 06 PM" src="https://github.com/user-attachments/assets/2367eef4-6ae9-4ac2-8ee4-80f981046486" />

After clicking "Launch" you should find that a "controller" container has spawned as well as `N` "task" containers where `N` is the value you chose for concurrency:
<img width="1283" alt="Screenshot 2025-06-05 at 12 13 29 PM" src="https://github.com/user-attachments/assets/024413e2-c886-4272-ab59-909b4b114e7c" />

The web app's UI should update in realtime with the results of the eval run:
<img width="1053" alt="Screenshot 2025-06-05 at 12 14 52 PM" src="https://github.com/user-attachments/assets/6fe3b651-0898-4f14-a231-3cc8d66f0e1f" />

## Resource Usage

If you want to run evals with high parallelism by increasing the concurrency you need to be mindful of your Docker resource limits.

We've found the following formula to be helpful in practice:

```
Memory Limit = 3GB * concurrency
CPU Limit = 2 * concurrency
```

The memory and CPU limits can be set from the "Resources" section of the Docker Desktop settings:

<img width="996" alt="Screenshot 2025-06-06 at 8 54 24 AM" src="https://github.com/user-attachments/assets/a1cbb27d-b09c-450c-9fa8-b662c0537d48" />

## Stopping

To stop an evals run early you can simply stop the "controller" container using Docker Desktop. This will prevent any new task containers from being spawned. You can optionally stop any existing task containers immediately or let them finish their current tasks at which point they will exit.

<img width="1302" alt="Screenshot 2025-06-06 at 9 00 41 AM" src="https://github.com/user-attachments/assets/a9d4725b-730c-441a-ba24-ac99f9599ced" />

## Advanced Usage

The evals system runs VS Code headlessly in Docker containers for consistent, reproducible environments. While this design ensures reliability, it can make debugging more challenging. For debugging purposes, you can run the system locally on macOS, though this approach is less reliable due to hardware and environment variability.

To configure your MacOS system to run evals locally, execute the setup script:

```sh
cd packages/evals && ./scripts/setup.sh
```

The setup script does the following:

- Installs development tools: Homebrew, asdf, GitHub CLI, pnpm
- Installs programming languages: Node.js 20.19.2, Python 3.13.2, Go 1.24.2, Rust 1.85.1, Java 17
- Sets up VS Code with required extensions
- Configures Docker services (PostgreSQL, Redis)
- Clones/updates the evals repository
- Creates and migrates a Postgres database
- Prompts for an OpenRouter API key to add to `.env.local`
- Optionally builds and installs the Roo Code extension from source

## Troubleshooting

Here are some errors that you might encounter along with potential fixes:

Problem:

```sh
Error response from daemon: network 3d812c43410fcad072c764fa872a53fc0a5edf33634964699242a886947aff1a not found
```

Solution:

Prune orphaned resources:

```sh
docker system prune -f
```
