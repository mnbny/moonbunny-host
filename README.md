# moonbunny-host

Self-hosted static site host for personal reports. One server accepts deploys and serves the files. One CLI command deploys a directory. Everything is a path on one domain: `/{project}/{slug}/`.

## Run the server

```sh
docker compose up -d
```

| Env             | Description                             |
| --------------- | --------------------------------------- |
| `DEPLOY_TOKENS` | Comma-separated tokens that may deploy. |
| `DATA_DIR`      | Content directory. Default `/data`.     |
| `PORT`          | Internal HTTP port. Default `8080`.     |

Put a reverse proxy (Nginx Proxy Manager) in front for the public domain and TLS.

## Deploy

Requirements: Node.js 22 or later. Run `pnpm install` once.

```sh
export MOONBUNNY_HOST=https://host.moonbunny.io
export MOONBUNNY_TOKEN=...

moonbunny deploy ./dist --project reports [--slug 2026-09-02] [--auth user:pass]
```

| Flag        | Description                                          |
| ----------- | ---------------------------------------------------- |
| `--project` | First URL path segment. Required.                    |
| `--slug`    | Second URL path segment. Default: a random UUID.     |
| `--auth`    | `user:pass` basic auth required to view this deploy. |

On success the command prints only the deploy URL to stdout, so a script can capture it. A repeat deploy to the same slug replaces the previous content.
