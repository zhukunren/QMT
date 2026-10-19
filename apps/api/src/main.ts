import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { Store } from "./store.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
config({ path: resolve(root, ".env"), quiet: true });
const host = process.env.API_HOST || "127.0.0.1";
if (
  !["127.0.0.1", "localhost", "::1"].includes(host) &&
  (!process.env.API_TOKEN || process.env.API_TOKEN.length < 32)
) {
  throw new Error(
    "对外监听必须配置至少 32 字符的 API_TOKEN；生产环境请通过 HTTPS 网关提供身份认证。",
  );
}
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.API_TOKEN || process.env.API_TOKEN.length < 32)
)
  throw new Error("生产环境必须配置至少 32 字符 API_TOKEN");
const store = new Store(
  resolve(process.env.DATA_DIR || resolve(root, "data"), "studio.sqlite"),
);
const app = await createApp({ store, logger: true });
await app.listen({ port: Number(process.env.API_PORT || 8000), host });
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    await app.close();
    store.close();
    process.exit(0);
  });
