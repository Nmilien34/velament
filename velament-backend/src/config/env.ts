import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
export const env = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z.string().min(1),
    CLIENT_ORIGIN: z.string().refine(
      (value) =>
        value.split(",").every((item) => {
          try {
            const url = new URL(item.trim());
            return (
              ["http:", "https:"].includes(url.protocol) &&
              url.origin === item.trim()
            );
          } catch {
            return false;
          }
        }),
      "Use comma-separated HTTP(S) origins without trailing slashes",
    ),
  })
  .parse(process.env);
