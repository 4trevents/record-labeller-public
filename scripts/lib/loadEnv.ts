import { existsSync } from "node:fs";

// Side-effect-only module: loads .env into process.env if present.
// Uses Node's built-in loader (no dotenv dependency needed on Node 20.6+).
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}
