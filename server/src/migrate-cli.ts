import { runMigrations } from "./migrate.js";

runMigrations()
  .then((applied) => {
    console.log(
      applied.length
        ? `Applied migrations: ${applied.join(", ")}`
        : "No pending migrations.",
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
