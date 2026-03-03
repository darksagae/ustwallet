# Database Setup (Cloud PostgreSQL)

PostgreSQL is not installed locally. Use a free cloud database for development and deployment.

## 1. Create a free Neon database

1. Go to [neon.tech](https://neon.tech) and sign up (free).
2. Create a new project.
3. Copy the connection string from the dashboard (looks like `postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require`).

## 2. Configure the app

Edit `app/.env` and set `DATABASE_URL` to your Neon connection string:

```
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

Also update `app/.env.local` so Next.js uses the same database:

```
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
```

## 3. Push the schema

From the project root, run:

```bash
cd app && npm run db:push
```

(You must run from inside `app/` so Prisma finds `.env` and the schema.)

## Alternative: Supabase

[supabase.com](https://supabase.com) also offers free PostgreSQL. Create a project → Settings → Database → copy the connection string (URI format).
