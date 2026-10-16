// The "empty app": healthy, and nothing else. Every acceptance test must fail
// against it; a test that passes here proves nothing.
import http from "node:http";

http
  .createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
      return;
    }
    res.writeHead(404, { "content-type": "application/json" }).end('{"error":{"code":"not_found","message":"empty app"}}');
  })
  .listen(Number(process.env.PORT), "127.0.0.1");
