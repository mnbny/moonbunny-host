# moonbunny-host

Self-hosted static site host for personal reports. One server accepts deploys and serves the files. A CLI deploys a directory or a single file. Everything is a path on one domain: `/{project}/{slug}/`.

## Deploy

Requirements: `~/.local/bin` on your `PATH` and Node.js 20 or later. Run the setup from the checkout. It links the committed bundle and installs nothing:

```sh
node cli/setup.mjs
```

```sh
moonbunny deploy ./dist --project reports
# → https://static.example.com/reports/1b2a97e0-.../
```

`moonbunny readme` prints this guide.

### Connection

A flag wins over its env var.

| Env               | Flag      | Description                        |
| ----------------- | --------- | ---------------------------------- |
| `MOONBUNNY_HOST`  | `--host`  | Server URL.                        |
| `MOONBUNNY_TOKEN` | `--token` | One of the server's deploy tokens. |

### Flags

| Flag        | Description                                                          |
| ----------- | -------------------------------------------------------------------- |
| `--project` | First URL path segment. Required.                                    |
| `--slug`    | Second URL path segment. Default: the server picks a UUID.           |
| `--auth`    | `user:pass` basic auth required to view this deploy.                 |
| `--expires` | Days until the deploy is deleted. `0` keeps it forever. Default: 30. |

The server slugifies the project and the slug: `"My Report"` becomes `my-report`.

### Examples

```sh
# named slug, password-protected, deleted after 7 days
moonbunny deploy ./coverage --project ci --slug pr-123 --auth me:secret --expires 7

# kept forever, connection via flags
moonbunny deploy ./docs --project handbook --slug v1 --expires 0 --host https://reports.example.com --token abc123
```

### Behavior

- On success, stdout is exactly the deploy URL. Errors go to stderr with exit code 1.
- Deploys are immutable. A taken slug gets a unique suffix, and the printed URL carries the final slug.
- Deploys are ephemeral. A sweep at server start, and once a day after, deletes expired deploys.
- `index.html` serves at the slug root. Any other single file serves at its own name.

## Run the server

```sh
docker compose up -d
```

The compose file pulls the published image. It reads these values from the environment or from a `.env` file beside it:

| Var               | Description                                           |
| ----------------- | ----------------------------------------------------- |
| `MOONBUNNY_IMAGE` | Image to run. Pin a `:<commit>` tag to roll back.     |
| `DEPLOY_TOKENS`   | Comma-separated tokens that may deploy.               |
| `DATA_PATH`       | Host path for the deployed content. Default `./data`. |
| `PORT`            | Published HTTP port. Default `8080`.                  |

Put a reverse proxy in front for the public domain and TLS. Set the proxy body limit to 50MB or more, or the proxy rejects large deploys before the server sees them.

## Development

Requirements: Node.js 22 or later and pnpm 11. Install, then link the TypeScript entry point. `moonbunny` then runs your working copy:

```sh
pnpm install
node cli/setup.mjs --dev
```

The `*.bundle.mjs` files are generated. Never edit them. `pnpm validate` formats, lints, typechecks, and rebuilds both.

### Release

`pnpm release` builds the image for x86_64 and pushes `ghcr.io/mnbny/moonbunny-host` as `:latest` plus an immutable `:<commit>` tag. A release runs only from a clean, committed tree, so every tag names its exact source. To roll back, run the previous commit tag.

Registry auth is once per machine. The token needs the `packages` scopes, which `gh` does not grant by default:

```sh
gh auth refresh -s write:packages,read:packages
gh auth token | docker login ghcr.io -u yulolimum --password-stdin
```

The first push creates the package as private. Make it public in the package settings, or run the same login on the NAS.
