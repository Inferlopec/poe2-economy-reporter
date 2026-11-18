# AGENTS.md

## Project

PoE2 Economy Reporter is a small self-hosted service that posts daily market reports and significant price alerts to Gryt Chat. `SPEC.md` is the source of truth for product behavior.

## Architecture

- TypeScript on a supported Node.js LTS release; use npm and a committed lockfile.
- One process, one Docker container, one persistent volume (`/app/data`). No inbound ports, database, web UI, external scheduler, LLM, bot SDK or Gryt plugin.
- Public poe.ninja data → normalization → local history → market analysis → report/alert formatting → Gryt incoming webhook.
- Keep API access, history, analysis, formatting, scheduling and delivery separate. Prefer small modules and pure functions for analysis.
- Verify current poe.ninja and Gryt contracts against their documentation and representative responses; never assume undocumented field meanings, category IDs or webhook limits.

## Reliability and configuration

- A valid `GRYT_WEBHOOK_URL` is the only required setting for normal deployment. Optional YAML overrides built-in defaults. Validate configuration at startup; never log or commit secrets.
- Support the specified per-item classification overrides and explicit source disabling for league adjustments without rebuilding the image. Disclose reduced coverage; never silently disable failed sources or bypass Currency's required conversion role. Config changes must preserve delivery counters/cooldowns and reset affected confirmations as specified.
- Store timestamped history and delivery state as JSON using atomic replacement; retain seven days of price history. Isolate league histories. Do not silently discard corrupted state.
- Fetch hourly without overlapping runs. Handle timeouts, rate limits, malformed data and temporary outages. Do not send reports from stale or incomplete market data as if current.
- Persist report/alert delivery state across restarts. Handle ambiguous webhook delivery failures conservatively; do not blindly retry a POST that may have succeeded.
- Validate real webhook payload limits; split logical report cards into numbered physical messages where needed. Never silently truncate rankings.

## Development workflow

- Small project: work on `main`; no milestones, mandatory issue tracking or additional planning documents.
- Keep dependencies and configuration minimal. Use fixtures and mocked network calls for deterministic tests.
- Test price conversion, rankings, filtering, league transitions, restart/delivery state and payload splitting. Run type checking, tests and build before handoff.
- Provide `check`, `preview` (including deterministic demo data), `send-test`, and manual `report-currency` commands. `check` and `preview` must not contact Gryt or modify production state. Manual sends do not alter scheduled counters.
- Ship a non-root Docker image, Compose example, `.env.example`, optional `config.example.yaml`, and a short README.
- GitHub Actions: verify/build on changes; publish versioned GHCR images and `latest` on release tags. Do not publish, push or send real webhook messages without authorization.
- Document any necessary deviation from the specification before implementing it.
- MVP application, Docker/Compose and CI implementation was explicitly authorized by the user in the implementation session. External publication and real webhook sends still require authorization. Preserve the accepted decisions in `SPEC.md`, including currency-only grouping, Boss Fragments alerts, conservative freshness and configurable activity filters.
