



# JoinTheDots Gear

A powerful build tool and development environment for creating web applications, libraries, and distributable artifacts.

## Installation

```bash
npm install -g @jointhedots/gear
```

## CLI Commands

The `jointhedots-gear` CLI provides several commands for project management and development workflow:

### `init` - Initialize Project Settings

Initializes VS Code settings with JSON schema configurations for application and component files.

```bash
jointhedots-gear init
```

**What it does:**

- Sets up `.vscode/settings.json` with JSON schema mappings
- Enables IntelliSense for `application.json` files
- Enables IntelliSense for component files (`component.json`, `*.component.json`, `component.yml`, `*.component.yml`, `component.toml`, `*.component.toml`)

### `make` - Build Distributable Artifacts

Creates distributable artifacts from your applications and libraries.

```bash
jointhedots-gear make [options]
```

**Options:**
- `--project <file>` - Project descriptor file location
- `--apps <list>` - Comma-separated list of applications to build (e.g., `app1,app2`)
- `--libs <list>` - Comma-separated list of libraries to build (e.g., `lib1,lib2`)
- `--env <file>` - Environment file location
- `--ws <path>` - Workspace directory location (default: `.`)
- `--watch` - Watch and rebuild on file changes
- `--devmode` - Enable development mode
- `--pack` - Create tarball delivery packages
- `--versioned <version>` - Version applied to delivered package (use `*` for root package version, default: `*`)
- `--dist <path>` - Distribution directory (default: `./dist`)

**Examples:**
```bash
# Build all applications and libraries
jointhedots-gear make

# Build specific applications with watch mode
jointhedots-gear make --apps "app1,app2" --watch

# Build in development mode with custom output directory
jointhedots-gear make --devmode --dist ./build

# Create packaged artifacts
jointhedots-gear make --pack --versioned "1.0.0"
```

### `serve` - Development Server

Serves a web application with continuous building and hot reload capabilities.

```bash
jointhedots-gear serve --app <application> [options]
```

**Options:**

- `--app <name>` - **Required.** Application name to serve
- `--port <number>` - Port number for the development server (default: `3000`)
- `--env <file>` - Environment file location
- `--ws <path>` - Workspace directory location (default: `.`)
- `--devmode` - Enable development mode
- `--versioned <version>` - Version applied to delivered package (use `*` for root package version, default: `*`)
- `--dist <path>` - Distribution directory (default: `./dist`)

**Examples:**

```bash
# Serve an application on default port (3000)
jointhedots-gear serve --app myapp

# Serve with custom port and development mode
jointhedots-gear serve --app myapp --port 8080 --devmode

# Serve with environment configuration
jointhedots-gear serve --app myapp --env .env.development
```

### `run` - Program Execution with Auto-Restart

Executes a Node.js program with file watching and automatic restart capabilities.

```bash
jointhedots-gear run --dir <watch-dir> --entry <entry-file> [options] [-- <program-args>]
```

**Options:**

- `--dir <path>` - **Required.** Directory to watch for file changes
- `--entry <file>` - **Required.** Entry point file to execute
- `--inspect <port>` - Enable Node.js debugger on specified port
- `--break` - Start debugger with breakpoint at startup
- `-- <args>` - Arguments to pass to the executed program

**Interactive Controls:**

- **Enter** - Restart the program
- **Backspace** - Restart the program in debug break mode
- **Ctrl+C** - Exit the monitor

**Examples:**

```bash
# Basic file watching and auto-restart
jointhedots-gear run --dir ./src --entry server.js

# With debugging enabled
jointhedots-gear run --dir ./src --entry server.js --inspect 9229

# With program arguments
jointhedots-gear run --dir ./src --entry server.js -- --config production

# Start with debugger breakpoint
jointhedots-gear run --dir ./src --entry server.js --inspect 9229 --break
```

## Project Structure

The tool expects projects to follow a specific structure with:

- Component definitions in JSON, YAML, or TOML format
- Application configurations
- Environment-specific settings

## Environment Configuration

Use environment files to configure different deployment environments. Specify the environment file location using the `--env` option in `make` and `serve` commands.

## Development Workflow

1. **Initialize** your project with `jointhedots-gear init`
2. **Develop** using `jointhedots-gear serve --app <your-app>` for web applications
3. **Test** with `jointhedots-gear run --dir <src> --entry <file>` for Node.js programs
4. **Build** production artifacts with `jointhedots-gear make --pack`
