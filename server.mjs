import { createServer } from "node:http";
import next from "next";
import { attachRealtime } from "./server/realtime.mjs";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  handle(req, res);
});

attachRealtime(server);

server.listen(port, "0.0.0.0", () => {
  console.log(`> Quizzy unified platform running on http://0.0.0.0:${port}`);
});
