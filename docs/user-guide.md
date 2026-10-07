# Octop User Guide

> This guide is for end users and walks through the full flow of **Install → Setup wizard → Configure models → Basic usage**.
> All runtime data is stored under `~/.octop/` by default (override with `OCTOP_HOME`).

---

## Contents

- [1. Introduction](#1-introduction)
- [2. Installing Octop](#2-installing-octop)
  - [2.1 Requirements](#21-requirements)
  - [2.2 One-line script install (recommended)](#22-one-line-script-install-recommended)
  - [2.3 Verifying the install](#23-verifying-the-install)
  - [2.4 Docker install (recommended for production)](#24-docker-install-recommended-for-production)
- [3. First launch and the setup wizard](#3-first-launch-and-the-setup-wizard)
  - [3.1 Starting the service](#31-starting-the-service)
  - [3.2 Wizard steps](#32-wizard-steps)
  - [3.3 Unattended / skipping the wizard](#33-unattended--skipping-the-wizard)
- [4. Configuring models (LLM providers)](#4-configuring-models-llm-providers)
  - [4.1 Preset providers](#41-preset-providers)
  - [4.2 Custom providers](#42-custom-providers)
  - [4.3 Selecting models and testing the connection](#43-selecting-models-and-testing-the-connection)
  - [4.4 Managing providers in the console](#44-managing-providers-in-the-console)
  - [4.5 Configuring providers via the CLI](#45-configuring-providers-via-the-cli)
  - [4.6 Local models with Ollama](#46-local-models-with-ollama)
- [5. Basic usage](#5-basic-usage)
  - [5.1 Login](#51-login)
  - [5.2 Chat](#52-chat)
  - [5.3 Creating agents (expert library / MBTI personas)](#53-creating-agents-expert-library--mbti-personas)
  - [5.4 Connectors](#54-connectors)
  - [5.5 Channels (IM)](#55-channels-im)
  - [5.6 Scheduled tasks (Cron)](#56-scheduled-tasks-cron)
  - [5.7 ACP (working with IDEs / coding agents)](#57-acp-working-with-ides--coding-agents)
  - [5.8 Settings (users / security / TLS / system)](#58-settings-users--security--tls--system)
  - [5.9 Remote desktop and Browser AI](#59-remote-desktop-and-browser-ai)
- [6. Common command quick reference](#6-common-command-quick-reference)
- [7. FAQ](#7-faq)
- [8. Figure index](#8-figure-index)

---

## 1. Introduction

**Octop** is an open-source, self-hosted AI assistant platform with multi-user and multi-agent support. A single process serves the Web console, the CLI, IM channels (Telegram, Discord, MQTT, and more), and scheduled tasks — and all data stays on your own machine.

![Figure 1.1 — Octop product overview](assets/overview.png)

At a glance:

- 👥 Multi-user, multi-agent expert teams you can share across a household or team.
- 🎭 16 MBTI persona templates that give every agent a distinct character.
- 🔒 Local-first design, JWT multi-user isolation, tool approval, and command guardrails.
- 🔌 Connectors (OAuth + MCP) and the expert library extend what agents can do.
- 🧠 Portable memory that migrates with the workspace.
- 🖥️ Rich interactions such as remote desktop, Browser AI+, and Terminal AI+.

---

## 2. Installing Octop

### 2.1 Requirements

- Operating system: **macOS / Linux / Windows**.
- **No** pre-installed Python required — the installer uses [uv](https://docs.astral.sh/uv/) to create an isolated Python 3.12 virtual environment under `~/.octop/`.
- Outbound network access, to download the installer and dependencies.

### 2.2 One-line script install (recommended)

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/onlinegill/Octop/main/scripts/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/onlinegill/Octop/main/scripts/install.ps1 | iex
```

**Windows (cmd)** — download first, then run:

```bat
curl -fsSL https://raw.githubusercontent.com/onlinegill/Octop/main/scripts/install.bat -o install.bat
install.bat
```

After the install completes, **open a new terminal** or reload your shell config so PATH takes effect:

```bash
source ~/.zshrc   # Zsh
# or
source ~/.bashrc  # Bash
```

The installer places the `octop` command in `~/.octop/bin` and adds it to PATH, and creates an isolated environment in `~/.octop/venv`; it **never modifies the system Python**.

> **Optional extras**: the installer supports extra capabilities via `--extras`, for example browser automation with `--extras browser`; you can also pin a version with `--version` or use a custom PyPI mirror with `--mirror <url>`. See [scripts/README.md](../scripts/README.md) for more options.

### 2.3 Verifying the install

```bash
octop --version
octop run --help
```

If you see `command not found: octop`, reload your shell or check that `~/.octop/bin` is on PATH.

### 2.4 Docker install (recommended for production)

```bash
# Build and start in the background
docker compose -f docker/docker-compose.yml up -d

# Or build manually and then run
bash docker/docker_build.sh
docker run -d \
  -p 8088:8088 \
  -v octop-data:/data/.octop \
  -e HOME=/data \
  -e OCTOP_DEFAULT_PASSWORD="<your own strong password; leave empty to auto-generate a random one>" \
  octop:latest
```

See [.env.example](../.env.example) for the full set of environment variables:

| Variable | Default | Description |
|------|--------|------|
| `OCTOP_PORT` | `8088` | HTTP listen port |
| `OCTOP_DEFAULT_PASSWORD` | _(empty)_ | First-run admin password (Docker bootstrap; ≥8 characters with letters + digits; empty auto-generates a random password and writes it to credential.txt) |
| `OCTOP_ADMIN_USERNAME` | `admin` | First-run admin username |
| `OCTOP_DATA` | `~/.octop` | Host data directory (compose bind mount) |

> Planned: later Docker first-boot may randomize the admin password and write it only to `credential.txt`.

---

## 3. First launch and the setup wizard

### 3.1 Starting the service

Once the install finishes, just start the service. On first run, the control-plane database, the JWT secret, and the first admin are created in the **setup wizard** (a green-field install defers opening the database until you confirm SQLite / PostgreSQL in the wizard):

```bash
octop run       # Start the API + Web console in the foreground
```

If you want the service to run persistently in the background, register it as a system service:

```bash
octop service start   # Linux (systemd) / macOS (launchd) / Windows service
```

After it starts, open **http://127.0.0.1:8088**.

The first visit **automatically redirects to the setup wizard page** (a URL like `/setup`). If startup password protection is enabled, the wizard first asks for a one-time "setup password".

### 3.2 Wizard steps

The setup wizard is a step-by-step guide that walks through the following in order (if `require_setup_password` is disabled, it starts at the "Database" step):

![Figure 3.1 — Setup wizard step bar](assets/setup-01-steps.png)

**Step 1: Set a password (optional)**

- The initial configuration needs a temporary "setup password" as protection (enabled by default).
- The password is printed in the startup terminal and written to a bootstrap file on the server (commonly `~/octop-login.txt`).
- This step does **not** depend on whether the control-plane database is open yet.

**Step 2: Choose the control-plane database**

- The default is local **SQLite** (path relative to `~/.octop/`, usually `octop.db`); click "Save and continue".
- "Show more" lets you configure **PostgreSQL** (beta): fill in the host and so on, "Test connection" first, then "Use PostgreSQL and continue".
- The wizard writes the choice into the `database` section of `config.json`, and **binds the connection pool for the first time** inside the service process and runs migrations.
- You can also specify this up front via environment variables (see `OCTOP_DATABASE_*` in [configuration.md](configuration.md)); upgrading an install that already has a database file does not defer the connection.
- This step only configures the **control plane**; if you choose PostgreSQL, agent memory reuses the same DSN by default (you can force file-based memory with `memory.backend.type=sqlite`). See [configuration.md](configuration.md).

**Step 3: Create the admin account**

- Enter a **username** (default `admin`), a **password**, and a **display name**.
- The password must be at least 8 characters and contain both letters and digits (same policy as "Change password" in the console).
- This account is the first administrator and holds the highest privileges, including user management and system settings.
- Note the account down; later logins and daily use depend on it.

![Figure 3.2 — Creating the admin account](assets/setup-02-admin.png)

**Step 4: Configure models (LLM providers)**

- Choose a preset provider (such as OpenAI, DeepSeek, Ollama, etc.) or a custom provider.
- Enter the API Key and Base URL, and check the models you want to enable.
- Click **Test connection**, and once it passes click **Continue**.
- This step can be **skipped** and configured later in the console under "Settings → Models / Providers".

See the next section, [4. Configuring models](#4-configuring-models-llm-providers).

![Figure 3.3 — Model configuration in the wizard](assets/setup-03-model.png)

**Step 5: Finish**

- The wizard writes the configuration, unlocks the full API, and automatically logs you in as the admin you just created.
- When it completes you land on the Web console home page.

> **Backup note:** system backups differ by control-plane engine (a SQLite file vs `pg_dump`). SQLite and PostgreSQL backups **cannot be restored across engines**; before restoring, the running engine must match the backup. In PostgreSQL mode the host must provide `pg_dump` / `pg_restore`.

### 3.3 Unattended / skipping the wizard

For automated deployments you can skip the "setup password" step and pre-set the admin identity via environment variables before starting, straight from the Web console:

```bash
export OCTOP_ADMIN_USERNAME=admin
export OCTOP_ADMIN_PASSWORD="<your strong password, ≥8 characters with letters and digits>"
octop run
```

The password must satisfy the policy (≥8 characters with both letters and digits). Afterward you can finish the rest of the configuration, such as models, in the Web console.

---

## 4. Configuring models (LLM providers)

Octop connects to large models through **providers**. Each agent can use a different provider and model. It supports OpenAI-compatible APIs, Anthropic, AWS Bedrock, and local models via Ollama.

### 4.1 Preset providers

In the wizard's "Models" step or the console's "Settings → Models", you can pick common presets in one click:

| Preset | Description |
|------|------|
| OpenAI | Official API, needs an API Key |
| Anthropic | Claude family, needs an API Key |
| DeepSeek | Needs an API Key |
| Ollama | Local models, no API Key by default |

Selecting a preset automatically fills in that provider's default `base_url` and built-in model list.

### 4.2 Custom providers

When the service you need is not among the presets (for example a self-hosted OpenAI-compatible gateway, Azure OpenAI, or a third-party relay), choose "Custom":

- **Type (kind)**: `openai` (OpenAI-compatible), `anthropic`, `bedrock`.
- **Name**: a custom display name.
- **Base URL**: the API endpoint (for example `https://api.openai.com/v1`).
- **API Key**: the key provided by the vendor.

![Figure 4.1 — Custom provider and model selection](assets/model-01-custom.png)

### 4.3 Selecting models and testing the connection

1. Under a provider, check the models you want to enable (you can select all / none).
2. Click **Test connection**; the system sends one probe request to the provider and shows the latency.
3. Once the test passes, click **Continue / Save**.

> If the test fails, check the API Key, Base URL, network connectivity, and account quota.

### 4.4 Managing providers in the console

Beyond the initial wizard, you can do the following day to day under **Settings → Models / Providers**:

- Add / edit / delete providers.
- Add or remove models for a provider (including a custom model ID, context window, max tokens, and whether reasoning is supported).
- Assign a default provider and model to different agents.

![Figure 4.2 — Console model management](assets/model-02-manage.png)

### 4.5 Configuring providers via the CLI

```bash
octop models              # View provider presets and model resolution
octop provider list       # List configured providers
octop provider --help     # Provider CRUD help
```

### 4.6 Local models with Ollama

If Ollama is already running on the machine, choose the `ollama` preset (its default `base_url` is a local address) to use local models without an API Key — well suited to privacy-sensitive or offline scenarios.

If Ollama stores models in a non-default directory (for example on a different disk than the system drive), enter the **model download directory** in the provider settings and save. Octop will identify already-downloaded models by that path and set `OLLAMA_MODELS` when starting the local Ollama service.

---

## 5. Basic usage

### 5.1 Login

Open **http://127.0.0.1:8088** and sign in with the account created by the wizard.

> ⚠️ **Security reminder**: if Docker initialization does not set `OCTOP_DEFAULT_PASSWORD`, it auto-generates a random admin password (written to `/data/.octop/credential.txt`, viewable with `docker exec <container> cat /data/.octop/credential.txt`). Either way, change it promptly under **Personal settings → Change password** to avoid unauthorized access when the service is exposed to the public internet.

![Figure 5.1 — Login page](assets/use-01-login.png)

### 5.2 Chat

- Open the **Chat** page and select the current agent to start chatting in real time.
- Multi-turn conversation, attachment uploads, and tool-call display are supported.
- You can trigger specific capabilities in chat via slash commands.

![Figure 5.2 — Chat main screen](assets/use-02-chat.png)

### 5.3 Creating agents (expert library / MBTI personas)

- Open the **Agent → Experts** page and pick a professional role from the expert library templates (such as writing, coding, or data analysis) to create one in a click.
- Choose an **MBTI persona** template to give an agent a character (or take the personality quiz to auto-generate one).
- Assign that agent a **provider and model**, and a workspace backend.

![Figure 5.3 — Expert library (creating an agent)](assets/use-03-agent.png)

### 5.4 Connectors

- Open the **Connectors** page to configure OAuth apps and MCP gateways.
- Use connectors to bring in external services (such as Notion, OpenAlex, and Dify) and extend an agent's reach.

### 5.5 Channels (IM)

- Open the **Channels** page to install and configure IM platforms: Telegram, Discord, MQTT, and more.
- The credentials required for each channel are listed below:

| Channel | Credentials |
|------|----------|
| Telegram | Bot Token |
| Discord | Bot Token |
| MQTT | Broker URL, Topic |
| Web console | Enabled by default |

![Figure 5.4 — Channel configuration](assets/use-04-channels.png)

### 5.6 Scheduled tasks (Cron)

- Open the **Scheduled tasks** page to create Cron jobs visually.
- Trigger them with natural language or slash commands so agents can push or run tasks on schedule.

![Figure 5.5 — Scheduled task management](assets/use-05-cron.png)

### 5.7 ACP (working with IDEs / coding agents)

Octop supports ACP integration in two directions:

1. **Inbound** — let external tools (Zed, OpenCode, and so on) use your Octop agent:

   ```bash
   octop acp --agent main
   ```

2. **Outbound** — delegate coding tasks to external agents (OpenCode, CodeBuddy, Claude Code, Codex) from chat:
   - Console → **ACP**: configure runners (global per user).
   - Enable `acp_runner` for an agent, then delegate in chat.

See [docs/acp.md](acp.md) for the full configuration.

### 5.8 Settings (users / security / TLS / system)

- **Users**: manage accounts and roles, and change passwords.
- **Security**: tool approval and shell command guardrails (`~/.octop/security/tool_guard/`).
- **TLS**: configure HTTPS (self-signed or Let's Encrypt).
- **System**: listen address / port, log level, cron timezone, and more.

> Manual configuration file edits: runtime parameters are stored in `~/.octop/config.json` and can be overridden with environment variables (such as `OCTOP_PORT`, `OCTOP_BIND_HOST`). See [docs/configuration.md](configuration.md).

![Figure 5.6 — Settings page](assets/use-06-settings.png)

### 5.9 Remote desktop and Browser AI

On the **Console → Control** page you can use:

- **Remote desktop**: view the screen in real time and control keyboard and mouse, on Linux / Windows / macOS; a headless Linux host can create an isolated desktop in one click — ideal for remote work and GUI applications.

![Figure 5.7 — Remote desktop](assets/use-07-remote-desktop.png)

- **Browser AI+**: a Chromium-based headless session with web automation, screenshots, and remote browsing, plus a built-in AI assistant and skill recording.

![Figure 5.8 — Browser AI+](assets/use-08-browser-ai.png)

---

## 6. Common command quick reference

| Command | Description |
|------|------|
| `octop run` | Start Octop in the foreground |
| `octop run --host 0.0.0.0 --port 8088` | Custom listen address and port |
| `octop service start` | Install and start the system service |
| `octop service stop` | Stop the system service |
| `octop agent` | Create, list, start/stop agents |
| `octop channel` | Install and manage IM channels |
| `octop chats` | REPL and session management |
| `octop acp` | Provide a stdio ACP service for IDEs |
| `octop cron` | Manage scheduled tasks |
| `octop models` | Provider presets and model resolution |
| `octop provider list` | List configured providers |
| `octop skills` | Enable / disable skills per agent |
| `octop user list` | List users (admin) |
| `octop backup` | Export / restore backups |
| `octop update` | Check for and install updates |

See [docs/cli.md](cli.md) for the full reference.

---

## 7. FAQ

**Q: I can't open http://127.0.0.1:8088.**
- Make sure `octop run` is running and the terminal shows no errors.
- If you changed the port, use the corresponding address (such as `http://127.0.0.1:8088` or your custom port).
- Use `octop service status` (Linux / macOS) to check the service status.

**Q: I forgot the admin password.**
- You can reset or re-initialize it via the CLI (note: use the user-management commands / manage the database directly to reset the password).

**Q: The model test connection fails.**
- Check whether the API Key and Base URL are correct, whether the network can reach the service, and whether the account has quota.

**Q: How do I change the listen address so the LAN can reach it?**
- At startup: `octop run --host 0.0.0.0 --port 8088`; or set the environment variables `OCTOP_BIND_HOST=0.0.0.0` and `OCTOP_PORT=8088`.

**Q: Where is the data stored?**
- Everything is under `~/.octop/`:

```
~/.octop/
├── config.json              # process-level config (address, port, CORS, TLS, database …)
├── octop.db                 # default SQLite control plane — users, agents, channels, cron …
├── secrets/                 # JWT secret, channel tokens
├── agents/<agent_id>/       # per-agent workspace (SOUL.md, skills …)
├── security/tool_guard/     # shell command allow / deny rules
├── logs/                    # runtime logs
└── bin/octop                # PATH wrapper → venv/bin/octop
```

**Q: How do I upgrade?**
- `octop update` (if installed via the one-line installer); or reinstall from PyPI / source and restart the service.

---

## 8. Figure index

The figures used in this document are collected below (they live in the `docs/assets/` directory):

| No. | Location | File | Status | Description |
|------|------|--------|------|----------|
| Figure 1.1 | 1. Introduction | `overview.png` | ✅ In place | Octop brand banner |
| Figure 3.1 | 3.2 Wizard steps | `setup-01-steps.png` | ✅ In place | Wizard step bar (password verification page) |
| Figure 3.2 | 3.2 Admin | `setup-02-admin.png` | ✅ In place | Create-admin-account form |
| Figure 3.3 | 3.2 Models | `setup-03-model.png` | ✅ In place | Preset provider selection in the wizard |
| Figure 4.1 | 4.2 Custom | `model-01-custom.png` | ✅ In place | Custom provider dialog |
| Figure 4.2 | 4.4 Manage | `model-02-manage.png` | ✅ In place | Console model-management page (preset/custom provider list) |
| Figure 5.1 | 5.1 Login | `use-01-login.png` | ✅ In place | Login page |
| Figure 5.2 | 5.2 Chat | `use-02-chat.png` | ✅ In place | Chat main screen (Welcome + quick cards) |
| Figure 5.3 | 5.3 Agent | `use-03-agent.png` | ✅ In place | Expert-library template list |
| Figure 5.4 | 5.5 Channels | `use-04-channels.png` | ✅ In place | IM channel toggle list |
| Figure 5.5 | 5.6 Cron | `use-05-cron.png` | ✅ In place | Create-cron-job dialog |
| Figure 5.6 | 5.8 Settings | `use-06-settings.png` | ✅ In place | Application settings page |
| Figure 5.7 | 5.9 Remote desktop | `use-07-remote-desktop.png` | ✅ In place | Remote desktop connection page |
| Figure 5.8 | 5.9 Browser AI | `use-08-browser-ai.png` | ✅ In place | Browser AI+ session page |
