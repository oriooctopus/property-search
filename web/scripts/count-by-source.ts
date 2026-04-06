import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envContent = readFileSync(resolve(__dirname, "..", ".env.local"), "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  if (!process.env[trimmed.slice(0, eq)]) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const sources = ["craigslist", "facebook", "streeteasy"];
  for (const source of sources) {
    const { count } = await supabase
      .from("listings")
      .select("*", { count: "exact", head: true })
      .eq("source", source);
    console.log(`${source}: ${count}`);
  }

  const { count: total } = await supabase
    .from("listings")
    .select("*", { count: "exact", head: true });
  console.log(`Total: ${total}`);
}

main().catch(console.error);
