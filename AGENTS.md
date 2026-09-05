# Instructions

- Present a complete implementation plan and wait for explicit user approval before creating or modifying any files. Read-only codebase exploration to prepare the plan is permitted.
- Instead of npm use pnpm 
- Instead of `pnpm build` use `pnpm run lint && pnpm run typecheck`
- If you make any changes to database schema, generate database migration with `pnpm run db-generate`, but do not run`pnpm run db-migrate` as i will do migration myself.
- If you think this nextjs version APIs, conventions, file structure, etc differ from your training data, read the relevant guide in `node_modules/next/dist/docs/` before writing the code.
- To know which env variables available to you, read `.env.example`

# Tech stack

- Authentication: [better-auth](https://better-auth.com/docs/basic-usage)
- Database: MySQL with [drizzle-orm](https://orm.drizzle.team/docs/overview)
- Object Storage: [Seafsweed](https://github.com/seaweedfs/seaweedfs) (S3-compatible storage)

## Agent skills

### Issue tracker

Issues and specs are tracked as local markdown files in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles mapped 1:1 (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` + `docs/adr/` at root). See `docs/agents/domain.md`.
