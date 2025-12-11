import { createServer } from "http";
import { TunnelRouter } from "./core/TunnelRouter";
import { WSHandler } from "./core/WSHandler";
import { HTTPProxy } from "./core/HTTPProxy";
import { config } from "./config";

const router = new TunnelRouter();
const httpServer = createServer();
const proxy = new HTTPProxy(router, config.baseDomain);

console.log("🚨 BASE DOMAIN LOADED:", config.baseDomain);

new WSHandler(httpServer, router);

httpServer.on("request", (req, res) => {
  proxy.handleRequest(req, res);
});

httpServer.listen(config.port, () => {
  console.log(`OutRay Server running on port ${config.port}`);
  console.log(`Base domain: ${config.baseDomain}`);
});
