---
type: decision
id: ADR-014
title: "Containerized Stack — Image Pinning, Migration Strategy, Proxy Trust, and Offline Fonts"
status: accepted
date: "2026-10-26"
deciders: ["PromptLab Core Team"]
---

# ADR-014 — Containerized Stack

## Context

INFRA-01 introduced a `docker-compose.yml` that runs the full PromptLab stack (PostgreSQL, LiteLLM proxy, NestJS API, and Angular/Nginx web) in Docker. Several non-obvious decisions were made that are documented here.

---

## Decision 1: LiteLLM image pinned by tag **and** digest

```
image: ghcr.io/berriai/litellm:v1.106.2@sha256:7294b90f868c5c38c99b83021c7ba46f9b439e95f8e32964c925c7d2563a03f7
```

**Rationale:**  A floating tag (`:main`, `:latest`) silently upgrades the third-party LiteLLM binary on every `docker compose pull`, which can introduce breaking API changes or security regressions. Pinning by digest makes the image immutable: even if the tag is moved, the exact content that was tested is what runs.

**Upgrade path:** Pull the new tag, verify it with `docker pull ghcr.io/berriai/litellm:<tag>`, confirm the digest, update both this ADR and `docker-compose.yml`, and re-run CI.

---

## Decision 2: `prisma` in `dependencies`; `migrate deploy` in the entrypoint

`prisma` (the CLI) is listed in `apps/api/package.json` `dependencies` (not `devDependencies`) so that `npm ci --omit=dev` inside the production Docker image still installs it.

The API `docker-entrypoint.sh` runs `prisma migrate deploy` on every container start before launching the NestJS process:

```sh
npx prisma migrate deploy
exec node dist/main.js
```

**Consequences:**
- Schema changes are applied automatically with zero manual steps on each deploy.
- **Only one replica** of the API container should run at a time (single-replica constraint). Concurrent migrations across replicas are not safe with Prisma's migrate deploy. This is acceptable for the POC; a production setup would use an init container or a pre-deploy job.

---

## Decision 3: `TRUST_PROXY=1` behind Nginx

The `api` service sets:

```yaml
environment:
  TRUST_PROXY: "1"
```

**Rationale:** The Nginx `web` container is the **only** reverse proxy in front of the API. It appends `X-Forwarded-For` with exactly one hop. Setting `TRUST_PROXY=1` tells the NestJS/Express rate-limiter to trust exactly one proxy hop and resolve the real client IP from that header, ensuring that per-IP throttling (`ThrottleUser`) applies to each end-user independently rather than to Nginx's container IP (which would combine all users into one bucket).

`TRUST_PROXY` is deliberately **not set** in `.env.example` by default. When the API is exposed directly (development mode, no proxy), the socket IP is used and no trust is required.

---

## Decision 4: Offline fonts (`optimization.fonts: false`)

`angular.json` production build sets:

```json
"optimization": {
  "fonts": false
}
```

**Rationale:** Angular's default font optimization inlines Google Fonts CSS via an outbound HTTP request at build time. In CI, sandboxed build environments, and air-gapped deployments this network call fails and breaks the build. Disabling it means the font link tag is left as-is in `index.html`; fonts load from the CDN at runtime (acceptable for a POC) or can be bundled locally in a future phase.

---

## Alternatives Considered

| Alternative | Reason rejected |
|---|---|
| Floating `:latest` LiteLLM tag | Unpredictable breakage on upstream releases |
| `prisma migrate deploy` as a separate init container | Over-engineering for single-replica POC |
| `TRUST_PROXY=true` (boolean) | Rejected at API startup; only explicit integer or IP/CIDR accepted |
| `optimization.fonts: true` + proxy settings | Adds network dependency to CI build |
