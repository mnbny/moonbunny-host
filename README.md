# moonbunny-host

Self-hosted static site host for personal reports. One server accepts deploys and serves the files. A CLI deploys a directory or a single file. Everything is a path on one domain: `/{project}/{slug}/`.

## Run the server

```sh
docker compose up -d
```

| Env             | Description                             |
| --------------- | --------------------------------------- |
| `DEPLOY_TOKENS` | Comma-separated tokens that may deploy. |
| `DATA_DIR`      | Content directory. Default `/data`.     |
| `PORT`          | Internal HTTP port. Default `8080`.     |

The compose file runs the published image and reads `MOONBUNNY_IMAGE` (pin a `:<commit>` tag to roll back), `PORT`, `DEPLOY_TOKENS`, and `DATA_PATH` (host path for the data volume, default `./data`) from the environment or a `.env` file beside it, so a NAS panel can configure it without edits.

To run without a checkout on the NAS, `pnpm release` builds the image for x86_64 and pushes it as `:latest` plus an immutable `:<commit>` tag (`MOONBUNNY_IMAGE` overrides the default `ghcr.io/mnbny/moonbunny-host`). A release only runs from a clean, committed tree, so every tag names its exact source. The NAS runs `:latest`; rolling back means pointing it at the previous commit tag.

Registry auth, once per machine — the token needs the `packages` scopes, which `gh` does not grant by default:

```sh
gh auth refresh -s write:packages,read:packages
gh auth token | docker login ghcr.io -u yulolimum --password-stdin
```

The first push creates the ghcr package as private. Make it public in the package settings, or run the same login on the NAS so it can pull.

Put a reverse proxy (Nginx Proxy Manager) in front for the public domain and TLS. Allow request bodies of at least 50MB in the proxy, or it rejects large deploys before the server sees them.

## Deploy

Requirements: `~/.local/bin` on your `PATH`. To use the CLI, Node.js 20 or later. To develop it, Node.js 22 or later and pnpm 11.

Run either setup from the checkout. It links `moonbunny` into `~/.local/bin`.

**Use the CLI.** A ready-to-run bundle is committed, so this setup installs nothing:

```sh
node cli/setup.mjs
```

**Develop the CLI.** `--dev` links the TypeScript entry point, so `moonbunny` runs your working copy:

```sh
pnpm install
node cli/setup.mjs --dev
```

The `*.bundle.mjs` files are generated: never edit them, and `pnpm validate` rebuilds both, so a repository that passes carries bundles that match their source.

```sh
moonbunny deploy ./dist --project reports
# → https://host.moonbunny.io/reports/1b2a97e0-.../
```

`moonbunny readme` prints this guide.

### Connection

Point the CLI at your server with env vars or flags. A flag wins over its env var.

| Env               | Flag      | Description                                   |
| ----------------- | --------- | --------------------------------------------- |
| `MOONBUNNY_HOST`  | `--host`  | Server URL, e.g. `https://host.moonbunny.io`. |
| `MOONBUNNY_TOKEN` | `--token` | One of the server's deploy tokens.            |

### Flags

| Flag        | Description                                                           |
| ----------- | --------------------------------------------------------------------- |
| `--project` | First URL path segment, slugified by the server. Required.            |
| `--slug`    | Second URL path segment, slugified. Default: the server picks a UUID. |
| `--auth`    | `user:pass` basic auth required to view this deploy.                  |
| `--expires` | Days until the deploy is deleted. `0` keeps it forever. Default: 30.  |

### Examples

```sh
# named slug, password-protected, deleted after 7 days
moonbunny deploy ./coverage --project ci --slug pr-123 --auth me:secret --expires 7

# kept forever, connection via flags
moonbunny deploy ./docs --project handbook --slug v1 --expires 0 --host https://reports.example.com --token abc123
```

### Behavior

- Prints only the deploy URL to stdout, so scripts can capture it. Errors go to stderr with exit code 1.
- Deploys are immutable: a taken slug gets a unique suffix, and the printed URL carries the final slug.
- Deploys are ephemeral: the server deletes each deploy after its expiration, with a sweep at start and once each day.
- `--project` and `--slug` are slugified: `"My Report"` becomes `my-report`.
- The target can be a directory or a single file. `index.html` serves at the slug root; any other file serves at its own name.
