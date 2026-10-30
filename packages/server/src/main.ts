import { defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MatchRoom } from "./MatchRoom";

const port = Number(process.env.PORT ?? 2567);

const server = defineServer({
  transport: new WebSocketTransport(),
  greet: false,
  rooms: {
    match: defineRoom(MatchRoom),
  },
});

await server.listen(port);
// The spike harness waits for this exact line before connecting bots.
console.log(`koe-server listening on ${port}`);
