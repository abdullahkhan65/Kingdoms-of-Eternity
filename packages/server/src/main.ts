import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import { MatchRoom } from "./MatchRoom";

const port = Number(process.env.PORT ?? 2567);
// Optional: serve the built browser client (packages/client/dist) from this
// server too, so players only need one URL and one open port.
const clientDist = process.env.CLIENT_DIST;

const server = defineServer({
  transport: new WebSocketTransport(),
  greet: false,
  express: clientDist ? (app) => void app.use(express.static(clientDist)) : undefined,
  rooms: {
    match: defineRoom(MatchRoom),
  },
});

await server.listen(port);
// The spike harness waits for this exact line before connecting bots.
console.log(`koe-server listening on ${port}${clientDist ? `, serving client from ${clientDist}` : ""}`);
