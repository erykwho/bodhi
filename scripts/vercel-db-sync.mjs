import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const BASELINE_MIGRATION = "00000000000000_init";

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
if (!existsSync(migrationsDir)) {
  console.error(
    "[db-sync] Missing prisma/migrations directory. Refusing to run destructive db push in production."
  );
  process.exit(1);
}

function runPrisma(args) {
  console.log(`[db-sync] Running: pnpm exec prisma ${args.join(" ")}`);
  const result = spawnSync("pnpm", ["exec", "prisma", ...args], {
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

const deployResult = runPrisma(["migrate", "deploy"]);

if (deployResult.status === 0) {
  process.exit(0);
}

const combinedOutput = `${deployResult.stdout ?? ""}\n${deployResult.stderr ?? ""}`;
const isNonEmptySchemaError = combinedOutput.includes("P3005");
const baselinePath = path.join(migrationsDir, BASELINE_MIGRATION);

if (isNonEmptySchemaError && existsSync(baselinePath)) {
  console.log(
    `[db-sync] Detected existing schema without _prisma_migrations (P3005). Baselining ${BASELINE_MIGRATION}...`
  );
  const resolveResult = runPrisma([
    "migrate",
    "resolve",
    "--applied",
    BASELINE_MIGRATION,
  ]);

  if (resolveResult.status !== 0) {
    process.exit(resolveResult.status ?? 1);
  }

  const retryDeployResult = runPrisma(["migrate", "deploy"]);
  process.exit(retryDeployResult.status ?? 1);
}

process.exit(deployResult.status ?? 1);
