# Changelog

## 0.3.0 — 2026-11-19

- Add optional automatic retention for scheduled reports, alerts and manual currency reports, disabled by default with a three-day lifetime.
- Keep webhook publication; use a persistent Gryt bot identity only for deletion after administrator approval, inside the existing container/data volume.
- Track acknowledged message IDs with server/channel/time metadata; skip legacy/unknown sends and old-server records. Preserve market history and delivery counters.
- Confirm deletion events, continue after already-absent messages, and isolate cleanup errors from normal collection/publication. Test/demo sends remain excluded.

### Upgrade from 0.2.0

Change your Compose image tag to `0.3.0`, pull the image and recreate the service. Preserve the existing data volume and configuration. Retention stays disabled unless explicitly enabled in YAML; its default lifetime is three days. Approve the new retention bot in Gryt only if enabling cleanup. No state reset or manual migration is needed. Messages published before this upgrade without complete channel/time receipts remain untouched.

## 0.2.0 — 2026-11-19

Consistent report rows and independent category selection for automatic alerts.

- Use percentage | bold compact price | item name in daily movements, expensive rankings, currency reports and individual alerts; retain category icons, colors and all eligible rows.
- Display sub-Div individual alert prices in Ex using the current Currency conversion rate, and use vertical separators in alert details.
- Add optional `alerts.categories` for individual and group alerts: `socketable`, `lineage_supports`, `crafting`, `uniques` and `boss_fragments`. All five remain enabled by default; `[]` disables alert generation for every group.
- Keep daily report categories and market/history collection independent of alert selection. Clear disabled-category confirmations while retaining cooldowns, delivery records and daily reservations.
- Preserve confirmation progress after an item is reassigned into an enabled category, even while its former category remains in retained history.
- Update configuration documentation and regression coverage. Market analysis, thresholds and architecture are unchanged.

### Upgrade from 0.1.x

Change the image tag in your existing `compose.yaml` to `0.2.0`, run `docker compose pull`, then `docker compose up -d`. Preserve `.env`, optional YAML configuration and the existing data volume/project name. No state migration is required. Omitted `alerts.categories` retains all five groups. Previously prepared immutable report parts retain their original payload.

The core functionality was preliminarily checked by the operator on 0.1.1. The 0.2.0 changes have automated and offline Docker demo coverage; a sustained operational run remains recommended before 1.0.

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
