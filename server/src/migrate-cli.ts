import { runMigrations } from "./migrate.js";
import { provisionDatabase, stopEmbedded } from "./provision.js";

async function main(): Promise<void> {
  await provisionDatabase();
  try {
    const applied = await runMigrations();
    console.log(
      applied.length
        ? `Applied migrations: ${applied.join(", ")}`
        : "No pending migrations.",
    );
  } finally {
    await stopEmbedded();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
