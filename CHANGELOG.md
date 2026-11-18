# Changelog

## 0.1.1 — 2026-11-18

Report presentation improvements; market analysis, filtering, scheduling and delivery behavior are unchanged.

- Combine gainers and losers in one Markdown card per category.
- Add distinct category icons, human-readable names and accent colors shared by movements, rankings and intermediate alerts.
- Use colored movement markers, bold signed percentages and compact prices without trailing zeros; clarify currency pair units and alert baselines/windows.
- Escape external item names as Markdown text and preserve styling, Unicode and all rows when splitting oversized cards.
- Replace generic demo labels with realistic examples from reviewed API fixtures, preserving synthetic identities, prices and activity.
- Verify all 13 demo scenarios (47 physical messages) and add formatter regressions; live Gryt delivery/rendering is not part of automated verification.
- Publish image `ghcr.io/inferlopec/poe2-economy-reporter:0.1.1` and update `latest` for Linux/amd64.

### Upgrade from 0.1.0

Change the image tag in your existing `compose.yaml` to `0.1.1`, run `docker compose pull`, then `docker compose up -d`. Preserve `.env`, optional YAML configuration and the existing data volume/project name. No configuration or state migration is required. Previously prepared immutable report parts retain their original payload.

## 0.1.0 — 2026-11-18

First MVP for self-hosted PoE2 economy reports in one Gryt channel.

- Daily English report with three currency pairs, currency turnover ranking, item gainers/losers and most-expensive rankings across five groups.
- Explicit selection of 14 Fragments plus Audience and Breachstone from their existing sources; configurable item overrides and deliberate source omissions.
- Individual/group price alerts with distinct-content confirmation, cooldowns and a maximum of three intermediate messages per local day.
- Hourly public poe.ninja collection, conservative freshness estimates, per-source conversion, seven-day league-isolated JSON history and atomic persisted delivery state.
- Numbered report parts, rate-limit handling and conservative treatment of ambiguous webhook outcomes.
- Read-only `check`/`preview`, manual currency delivery, test message delivery and a deterministic 13-case visual suite (46 messages) using a separate test webhook.
- Non-root Node.js 24 container, persistent volume, image-only Compose deployment with a separate source-build overlay, verification CI and release-tag automation for GHCR and GitHub releases.
- Versioned image: `ghcr.io/inferlopec/poe2-economy-reporter:0.1.0`; `latest` follows stable release publication. The initial registry image targets Linux/amd64; other hosts can build from source.

### Operational limits

- Compatibility and card rendering on a real deployed Gryt server have not yet been tested. Use `preview --demo --all`, then explicitly send selected cases to a separate test channel.
- poe.ninja generation time and turnover window are unverified. The default two-hour unchanged-content ceiling can suppress genuinely unchanged markets; activity filters can leave short rankings.
- Percentage changes and alerts need newly collected history. Boss Fragments membership is an explicit product selection, not exhaustive current-league boss coverage.
- Exactly-once delivery is not guaranteed. Inspect unknown delivery records before deliberately repeating a send; do not clear production state to retry.
- Local verification does not establish live-server compatibility; CI status and registry availability must be checked separately at publication.
