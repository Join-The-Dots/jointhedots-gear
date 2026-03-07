
# jointhedots-gear CLI

This package exposes the CLI binary `jointhedots-gear` (see `package.json` `bin`).

The CLI entrypoint is implemented in `src/cli.ts` and registers these commands:

- `init`
- `make`
- `serve`
- `publish`
- `run`

If a command is invalid, the CLI fails and shows help (`showHelpOnFail(true)` + `.help()`).

## Usage

```bash
jointhedots-gear <command> [options]
```

## Commands

### `init`

Initialize VS Code JSON schema settings.

Behavior implemented in `src/commands/init.ts`:

- Reads `.vscode/settings.json`
- Writes/overrides `json.schemas` with:
	- `application.*` mappings to `./node_modules/@jointhedots/gear/schemas/application.schema.json`
	- `component.*` mappings to `./node_modules/@jointhedots/gear/schemas/component.schema.json`
	- `declaration.*` mappings to `./node_modules/@jointhedots/gear/schemas/declaration.schema.json`

`declaration.*` files are consumed by workspace discovery/build logic (`src/model/helpers/discover-workspace.ts`) and support `.json`, `.yaml`, `.yml`, `.toml` formats (`src/model/helpers/config-loader.ts`).

Arguments: none.

### `make`

Build distributable artifacts (apps, libs, bundles).

Options implemented in `src/commands/make.ts`:

- `--apps <csv>`: app names list, comma-separated (default: `""`)
- `--libs <csv>`: library names list, comma-separated (default: `""`)
- `--bundles <csv>`: bundle names list, comma-separated (default: `""`)
- `--buns <csv>`: alias for `--bundles`
- `--watch`: rebuild on changes (default: `false`)
- `--devmode`: development mode (default: `false`)
- `--clean`: clean output before build (default: `false`)
- `--pack`: request tarball packaging for libraries
- `--versioned <value>`: output version (default: `"*"`)
	- when `"*"`, version is resolved from nearest `package.json` with non-`0.0.0` version
- `--ws <path>`: workspace directory (default: `"."`)
- `--dist <path>`: output directory root (default: `"./dist"`)

Selection behavior:

- `--libs "*"` builds all libraries in workspace
- `--bundles "*"` builds all bundles in workspace
- `--apps` expects explicit CSV names (no `*` branch implemented)

### `serve`

Continuously build one application and optionally start an HTTP server.

Options implemented in `src/commands/serve.ts`:

- `--app <name>`: required application name
- `--devmode`: development mode (default: `false`)
- `--port <number>`: server port (default: `3000`)
- `--versioned <value>`: output version (default: `"*"`)
	- when `"*"`, version is resolved from nearest `package.json` with non-`0.0.0` version
- `--ws <path>`: workspace directory (default: `"."`)
- `--dist <path>`: output directory root (default: `"./dist"`)

Server behavior (when `--port` is truthy):

- serves output files
- exposes `/esbuild` endpoint for build change notifications
- sets `Access-Control-Allow-*` headers to `*`
- logs `http://localhost:<port>`

### `publish`

Build and publish an application to AWS S3.

Options implemented in `src/commands/publish.ts`:

- `--app <name>`: required application name
- `--bucket <name>`: required S3 bucket
- `--region <name>`: AWS region (default: `"eu-north-1"`)
- `--dist <path>`: output directory root (default: `"./dist"`)

Implementation notes from `src/publish/publish_aws_s3.ts`:

- builds app with version marker `"aws_s3"`
- uploads files with `ACL: "public-read"`
- sets `ContentType` from detected MIME type

### `run`

Run a Node entrypoint with file watching and restart logic.

Options implemented in `src/commands/run.ts`:

- `--dir <path>`: required directory to watch
- `--entry <path>`: required program entry path (resolved against `--dir`)
- `--inspect <port>`: enable Node inspector on given port
- `--break`: start inspector in break mode (or use Backspace key for break-mode restart)
- `-- <args...>`: pass remaining arguments to the executed entry program

Runtime behavior:

- watches `--dir` recursively
- on file changes, kills and restarts the child process
- child process is started as:
	- `node --require source-map-support/register --require tsconfig-paths/register --enable-source-maps <entry> ...`
- keyboard controls:
	- `Enter`: restart normally when process is not running
	- `Backspace`: restart in break mode when process is not running
	- `Ctrl+C`: exit monitor

## Environment variables

Only one environment variable is explicitly read in the TypeScript source relevant to CLI build flow:

- `ESBUILD_LOG_LEVEL`
	- used in `src/builder/esbuild-plugins.ts`
	- controls esbuild `logLevel`
	- default is `"silent"` when not set

`process.env.NODE_ENV` is injected by build code as a compile-time define (`"development"` / `"production"`) in `src/builder/esbuild-plugins.ts`; this value is set by CLI build mode logic, not read from shell env by this tool.

