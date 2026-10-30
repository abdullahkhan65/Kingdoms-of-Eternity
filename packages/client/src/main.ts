/// <reference types="vite/client" />
import Phaser from "phaser";
import { GameScene, PLAYER_COLORS } from "./GameScene";
import { MatchConnection } from "./net";

// ?server=ws://host:port overrides the default. In dev the page comes from Vite
// and the game server is on :2567; in production the game server serves the page.
const params = new URLSearchParams(location.search);
const wsProto = location.protocol === "https:" ? "wss" : "ws";
const endpoint = params.get("server") ?? (import.meta.env.DEV ? `${wsProto}://${location.hostname}:2567` : `${wsProto}://${location.host}`);

const status = document.getElementById("status")!;
const hud = document.getElementById("hud")!;

async function start(): Promise<void> {
  status.textContent = `Connecting to ${endpoint}…`;
  const net = new MatchConnection(endpoint);
  try {
    await net.connect();
  } catch (err) {
    status.textContent = `Could not connect to ${endpoint}. Is the server running? (${(err as Error).message ?? err})`;
    return;
  }
  status.remove();
  // Dev-only handle for the browser smoke test (and the console). Not in production builds.
  if (import.meta.env.DEV) Object.assign(window, { koe: net });
  net.onLeave((code) => {
    hud.innerHTML = `<b>Disconnected</b> (code ${code}). Reload to rejoin.`;
  });

  const color = `#${PLAYER_COLORS[net.welcome.player % PLAYER_COLORS.length]!.toString(16).padStart(6, "0")}`;
  new Phaser.Game({
    type: Phaser.WEBGL,
    parent: "game",
    backgroundColor: "#1b2a17",
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: new GameScene(net, ({ units, selected }) => {
      hud.innerHTML =
        `<span class="swatch" style="background:${color}"></span>Player ${net.welcome.player + 1}` +
        ` · ${units} units · ${selected} selected · ping ${Math.round(net.rttMs)} ms`;
    }),
  });
}

start();
