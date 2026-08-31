<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Instructions

- Instead of npm use pnpm 
- Instead of `pnpm build` use `pnpm run lint && pnpm run typecheck`

# Tech stack

- Authentication: [better-auth](https://better-auth.com/docs/basic-usage)
- Database: MySQL with [drizzle-orm](https://orm.drizzle.team/docs/overview)
