# Instructions

- Use `pnpm` instead of `npm`.
- Use `pnpm run lint && pnpm run typecheck` instead of `pnpm build`.
- If you make any changes to the database schema, generate a database migration with `pnpm run db-generate` and apply it with `pnpm run db-migrate`.
- If you think this Next.js version's APIs, conventions, or file structure differ from your training data, read the relevant guide in `node_modules/next/dist/docs/` before writing code.
- Refer to `.env.example` to see which environment variables are available.
- When implementing a ticket, include the ticket status update in the same commit: update its `Status:` line to `done` (or the appropriate state) and check off all completed acceptance criteria (`- [ ]` to `- [x]`). A ticket is only `done` when every acceptance criterion is met. Do NOT split this into a separate docs-only commit.

# Tech stack

- Authentication: [better-auth](https://better-auth.com/docs/basic-usage)
- Database: PostgreSQL with [drizzle-orm](https://orm.drizzle.team/docs/overview)
- Object Storage: [SeaweedFS](https://github.com/seaweedfs/seaweedfs) (S3-compatible storage)

## Agent skills

### Issue tracker

Issues and specs are tracked as local markdown files in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles mapped 1:1 (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at root). See `docs/agents/domain.md`.

# Design system & UI

- Always consult `DESIGN.md` before writing or modifying any UI.
- The application operates strictly in single-light mode (`color-scheme: light`): do NOT add `dark:*` Tailwind classes or dark canvas backgrounds.
- Use the theme tokens configured in `app/globals.css` (e.g. `bg-canvas`, `bg-surface-card`, `bg-surface-soft`, `text-ink`, `text-body`, `text-muted`, `border-hairline`, `bg-primary`, `text-on-primary`).
- Display headings must use the serif display font (`font-serif` / Cormorant Garamond), UI body/labels use sans (`font-sans` / Inter), and code/SQL blocks use monospace (`font-mono` / JetBrains Mono).
- High-contrast dark navy surfaces (`bg-surface-dark`, `#181715`) are reserved exclusively for developer code chrome (raw SQL dump viewers, schema DDL inspection, terminal panels).
- Primary CTAs use warm coral (`bg-primary` / `#cc785c`), hover/active darkens to `#a9583e`. Avoid generic blues or purples.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
