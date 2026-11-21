import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const isVercelProduction = process.env.VERCEL_ENV === "production";
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());

if (!isVercelProduction) {
  console.log(
    `[db-sync] Skipping database sync (VERCEL_ENV=${process.env.VERCEL_ENV ?? "local"}).`
  );
  process.exit(0);
}

if (!hasDatabaseUrl) {
  console.warn(
    "[db-sync] DATABASE_URL is not configured in production; skipping database sync."
  );
  process.exit(0);
}

const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
const command = existsSync(migrationsDir)
  ? "pnpm exec prisma migrate deploy"
  : "pnpm exec prisma db push --skip-generate";

console.log(`[db-sync] Running: ${command}`);
execSync(command, { stdio: "inherit" });
