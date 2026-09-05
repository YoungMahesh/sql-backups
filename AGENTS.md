# Instructions

- Instead of npm use pnpm 
- Instead of `pnpm build` use `pnpm run lint && pnpm run typecheck`
- If you change database schema, you need to run database migration using `pnpm run db-generate` then `pnpm run db-migrate`
- If you think this nextjs version APIs, conventions, file structure, etc differ from your training data, read the relevant guide in `node_modules/next/dist/docs/` before writing the code.
- To know which env variables available to you, read `.env.example`

# Tech stack

- Authentication: [better-auth](https://better-auth.com/docs/basic-usage)
- Database: MySQL with [drizzle-orm](https://orm.drizzle.team/docs/overview)
- Object Storage: [Seafsweed](https://github.com/seaweedfs/seaweedfs) (S3-compatible storage) 
