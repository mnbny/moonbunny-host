# Technical Brief

## Operating Model

The system is one Node server that accepts deploys and serves the deployed files. The server runs as a Docker container on the owner's NAS behind Nginx Proxy Manager. The container copies only the committed server bundle, so the image installs nothing. The proxy owns the public domain and TLS. The server uses plain HTTP on an internal port.

The server stores deployed content on a mounted volume, organized by project and then by slug. A deploy uploads a gzipped tarball of a directory. Deploys are immutable: the server never replaces an existing slug, and a taken slug receives a unique suffix. The server also normalizes the project and the slug into URL-safe names, generates the slug when a deploy does not send one, and holds the default expiration, so every client gets the same naming and lifetime. The response carries the final path, and the CLI prints the URL from that response.

Deploys are ephemeral. Each deploy carries a hidden metadata file with its deploy time, its expiration time, and its optional credentials. A sweep at server start, and once each hour after, deletes every deploy past its expiration. A deploy may opt out of expiration.

A deploy extracts into an unservable staging area, and publishing is one atomic rename. A partial deploy, an unauthenticated window, or a collision between concurrent deploys is therefore not possible: the rename fails on a taken slug and the deploy retries with a unique suffix.

## Authentication

- A deploy requires a bearer token. The container environment supplies the valid tokens in one comma-separated variable at start. There is no token management at runtime.
- A deploy may attach basic auth credentials. The server stores the credentials in the hidden metadata file inside the slug directory. The server then requires matching credentials on every read of that slug.
- The server never serves a hidden file (a name that starts with a dot). This rule also protects the stored credentials.

## Hardening

- Uploaded content is never executed. The server only extracts an archive and streams files back out, and responses forbid content-type sniffing.
- After extraction the server removes every entry that is not a directory or a regular file with one hard link, so a deploy cannot plant a link that reads outside its own slug.
- The server caps the upload size and the extracted size. Both counts run while the request streams, so an oversized upload or a decompression bomb is stopped before it fills the volume.
- The server writes its metadata file after extraction, so a metadata file inside a deploy never wins over the server's own.
- The host serves a robots rule that forbids all crawling. A file placed at the data root overrides the rule; a deploy cannot create that file.
- The container runs as an unprivileged user, so a code-execution bug in the extraction path does not grant root. The host data path must be writable by that user.

## CLI

The deploy client is a TypeScript CLI that follows the MAACS CLI conventions. A plain Node launcher registers tsx and runs the TypeScript entry point. The CLI has two subcommands: one deploys, and one prints the repository guide, which keeps the guide the single documentation source for people, agents, and scripts. The deploy command archives a directory or a single file with tar and uploads the archive to the deploy endpoint. The command reads the host URL and the token from environment variables or from flags, and a flag wins over its environment variable. The command takes the project, the optional slug, the optional basic auth credentials, and the optional expiration as flags. On success the command prints only the deploy URL to stdout, so a script can capture the URL. The CLI is the only client. There is no web UI. The HTTP surface contains only the deploy endpoint and static file serving.

Ready-to-run bundles of the CLI and the server are committed in the repository. Each bundle is one file, runs on an older Node release than development needs, and requires no install. The validation command rebuilds both bundles after its checks pass, so a repository that passes validation carries bundles that match their source. The bundles are generated: tooling does not format, lint, or diff them, and nobody edits them by hand.

A setup script links the CLI onto the user's search path. The script links the bundle by default, so a consumer is finished after one command with nothing installed. A development flag links the TypeScript entry point instead, which runs the working copy as it is edited.

## Distribution

A release publishes the server image to a container registry with a moving latest tag and an immutable tag that names the commit it was built from. A release runs only from a clean, committed tree, so every tag names its exact source. The compose file pulls the published image instead of building, so the NAS never needs a checkout. A rollback runs the previous commit tag. The test harness is the exception: it always builds the image from the working tree, so it tests the source and not a stale release.

## Testing

One end-to-end harness verifies the host. The harness builds the real container, puts a small nginx proxy in front of it as a stand-in for Nginx Proxy Manager, deploys fixture files with the real CLI, and checks the served responses: token rejection, basic auth, content and asset types, hidden files, traversal, redirects, slug conflicts, slug normalization, and expiration. The harness is sandboxed: it binds only to localhost, exposes the app only through the proxy, and removes every container and network on exit.

## Conventions

- Dependencies are welcome in the server and the CLI. Each ships as a committed bundle that validation rebuilds, so no runtime ever installs packages.
- The CLI follows the MAACS conventions: citty commands, a tsx launcher, strict TypeScript, and the shared prettier and eslint configuration. One validation command formats, lints, and typechecks the repository, then rebuilds the bundles.
- Keep the input validation at the trust boundary. The token check, the path segment validation, and the dotfile block are not simplification targets.
