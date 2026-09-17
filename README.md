# Digital Sign by HealthProHub

An electronic signature platform. Upload a PDF, mark where people sign, and send them a link.
Signers sign in their browser on any device without creating an account.

> **Status:** Phase 1 (Foundation) is in progress. See [`docs/`](docs/README.md) for the full
> product specification.

## Repository layout

```
apps/
  api/        NestJS API          (added in Phase 1)
  web/        React + Vite app    (added in Phase 1)
packages/
  shared/     schemas, error codes, limits and brand constants used by both apps
docs/         product specification, architecture and roadmap
```

## Tooling

- Node 22 (see `.nvmrc`) and pnpm 10
- TypeScript 6, strict mode
- Biome for linting and formatting: `pnpm lint`, `pnpm lint:fix`, `pnpm format`

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```
