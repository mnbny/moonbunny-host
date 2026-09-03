# Technical Brief

## Operating Model

The system is one zero-dependency Node server that accepts deploys and serves the deployed files. The server runs as a Docker container on the owner's NAS behind Nginx Proxy Manager. The proxy owns the public domain and TLS. The server uses plain HTTP on an internal port.

The server stores deployed content on a mounted volume, organized by project and then by slug. A deploy uploads a gzipped tarball of a directory. The server replaces the slug directory with the extracted content.

## Authentication

- A deploy requires a bearer token. The container environment supplies the valid tokens in one comma-separated variable at start. There is no token management at runtime.
- A deploy may attach basic auth credentials. The server stores the credentials in a hidden file inside the slug directory. The server then requires matching credentials on every read of that slug.
- The server never serves a hidden file (a name that starts with a dot). This rule also protects the stored credentials.

## CLI

The deploy client is a TypeScript CLI that follows the MAACS CLI conventions. A plain Node launcher registers tsx and runs the TypeScript entry point. The entry point defines one subcommand, deploy. The deploy command archives a directory with tar and uploads the archive to the deploy endpoint. The command reads the host URL and the token from environment variables. The command takes the project, the optional slug, and the optional basic auth credentials as flags. On success the command prints only the deploy URL to stdout, so a script can capture the URL. The CLI is the only client. There is no web UI. The HTTP surface contains only the deploy endpoint and static file serving.

## Conventions

- The server has no runtime dependencies. The standard library and standard Unix tools cover the server.
- The CLI follows the MAACS conventions: citty commands, a tsx launcher, strict TypeScript, and the shared prettier and eslint configuration. One validation command formats, lints, and typechecks the repository.
- Keep the input validation at the trust boundary. The token check, the path segment validation, and the dotfile block are not simplification targets.
