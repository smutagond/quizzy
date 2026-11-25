import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import next from "next";
import { attachRealtime } from "./server/realtime.mjs";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";

if (!dev && !existsSync("./.next/BUILD_ID")) {
  console.log("No production build found in .next. Running next build...");
  execSync("npx next build", { stdio: "inherit" });
}

const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.url && req.url.startsWith("/socket.io")) {
    return;
  }
  handle(req, res);
});

attachRealtime(server);

server.listen(port, "0.0.0.0", () => {
  console.log(`> Quizzy unified platform running on http://0.0.0.0:${port}`);
});

