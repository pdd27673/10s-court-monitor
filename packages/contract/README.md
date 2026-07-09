# `@pdd27673/10s-contract`

Types-only REST contract for the court-monitor API. Route handlers in this repo
and `10s-mobile` both import from here so shapes can't drift.

## Local use (this repo)

The app depends on it via `file:packages/contract` — no publish needed for
backend development.

## Publishing to GitHub Packages

1. Bump `version` in this `package.json` (or let the tag workflow set it).
2. Tag and push:

```bash
git tag contract-v0.1.1
git push origin contract-v0.1.1
```

The `Publish contract` workflow publishes to
`https://npm.pkg.github.com/@pdd27673/10s-contract`.

## Consuming from 10s-mobile

`.npmrc`:

```
@pdd27673:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}
```

```bash
npm install @pdd27673/10s-contract@^0.1.0
```

For EAS builds, set an EAS secret `NODE_AUTH_TOKEN` to a GitHub PAT with
`read:packages` (or use a fine-grained token with Packages read on this repo).
