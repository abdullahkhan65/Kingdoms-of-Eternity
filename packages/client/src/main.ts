/// <reference types="vite/client" />
import Phaser from "phaser";
import { Msg, type LobbyState } from "@koe/protocol";
import { CIVS } from "@koe/sim";
import { colorCss, GameScene } from "./GameScene";
import { Hud } from "./hud";
import { Net } from "./net";

// ?server=ws://host:port overrides the default. In dev the page comes from Vite
// and the game server is on :2567; in production the game server serves the page.
const params = new URLSearchParams(location.search);
const wsProto = location.protocol === "https:" ? "wss" : "ws";
const endpoint = params.get("server") ?? (import.meta.env.DEV ? `${wsProto}://${location.hostname}:2567` : `${wsProto}://${location.host}`);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string) => {
  for (const s of ["menu", "lobby"]) $(s).classList.toggle("hidden", s !== id);
};
const nameInput = $<HTMLInputElement>("name");
nameInput.value = safeGet("koe.name") ?? "";
nameInput.onchange = () => safeSet("koe.name", nameInput.value);
if (params.get("room")) $<HTMLInputElement>("join-code").value = params.get("room")!;

let net: Net | null = null;
let game: Phaser.Game | null = null;

function playerName(): string {
  return nameInput.value.trim() || "Player";
}

function status(text: string | null): void {
  $("status").textContent = text ?? "";
  $("status").classList.toggle("hidden", !text);
}

async function connect(make: () => Promise<Net>): Promise<void> {
  $("menu-error").textContent = "";
  status("Connecting…");
  try {
    net = await make();
  } catch (err) {
    status(null);
    $("menu-error").textContent = (err as Error).message || "Could not connect to the server.";
    return;
  }
  status(null);
  attach(net);
  show("lobby");
  if (net.lobby) renderLobby(net.lobby);
}

function attach(n: Net): void {
  n.events.lobby = renderLobby;
  n.events.started = () => startGame(n);
  n.events.dropped = () => status("Connection lost — reconnecting…");
  n.events.reconnected = () => status(null);
  n.events.left = (code) => {
    if (code === 4000 || code === 1000) return; // we left on purpose
    status(null);
    $("menu-error").textContent = "Disconnected from the match.";
    returnToMenu();
  };
}

// ------------------------------------------------------------ menu

$("play-bot").onclick = () => connect(() => Net.create(endpoint, playerName(), { bots: 1, autoStart: true }));
$("create").onclick = () => connect(() => Net.create(endpoint, playerName()));
$("join").onclick = () => {
  const code = $<HTMLInputElement>("join-code").value.trim();
  if (!code) return void ($("menu-error").textContent = "Enter a room code.");
  connect(() => Net.join(endpoint, code, playerName()));
};

// ------------------------------------------------------------ lobby

function renderLobby(lobby: LobbyState): void {
  if (!net || net.started) return;
  const me = lobby.seats.find((s) => s.slot === lobby.you);
  const iAmHost = me?.slot === lobby.host;
  $("room-code").textContent = lobby.roomId;
  $("host-controls").classList.toggle("hidden", !iAmHost);
  $("wait-host").classList.toggle("hidden", iAmHost);
  $<HTMLButtonElement>("add-bot").disabled = lobby.seats.length >= 8;

  const rows = lobby.seats.map((s) => {
    const editable = s.slot === me?.slot || (iAmHost && s.bot);
    const civ = `<select data-slot="${s.slot}" data-field="civ" ${editable ? "" : "disabled"}>${CIVS.map((c, i) => `<option value="${i}" ${i === s.civ ? "selected" : ""}>${c.name}</option>`).join("")}</select>`;
    const team = `<select data-slot="${s.slot}" data-field="team" ${editable ? "" : "disabled"}>${[0, 1, 2, 3, 4].map((t) => `<option value="${t}" ${t === s.team ? "selected" : ""}>${t === 0 ? "No team" : `Team ${t}`}</option>`).join("")}</select>`;
    const label = `${escapeHtml(s.name)}${s.slot === me?.slot ? " (you)" : ""}${s.slot === lobby.host ? " 👑" : ""}${s.bot ? " 🤖" : ""}`;
    const remove = iAmHost && s.bot ? `<button data-remove="${s.slot}">✕</button>` : "";
    return `<tr><td><span class="swatch" style="background:${colorCss(s.slot)}"></span>${label}</td><td>${civ}</td><td>${team}</td><td>${remove}</td></tr>`;
  });
  $("seats").innerHTML = rows.join("");
  $("civ-help").innerHTML = CIVS.map((c) => `<b>${c.name}</b>: ${c.bonus}`).join("<br>");
  $("seats").querySelectorAll<HTMLSelectElement>("select").forEach((sel) => {
    sel.onchange = () => net?.sendLobby(Msg.SetSeat, { slot: Number(sel.dataset.slot), [sel.dataset.field!]: Number(sel.value) });
  });
  $("seats").querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((b) => {
    b.onclick = () => net?.sendLobby(Msg.RemoveBot, Number(b.dataset.remove));
  });
}

$("add-bot").onclick = () => net?.sendLobby(Msg.AddBot);
$("start").onclick = () => net?.sendLobby(Msg.Start);
$("leave-lobby").onclick = () => returnToMenu();
$("copy-link").onclick = async () => {
  const link = `${location.origin}${location.pathname}?room=${net?.roomId ?? ""}`;
  try {
    await navigator.clipboard.writeText(link);
    $("copy-link").textContent = "Copied!";
  } catch {
    prompt("Copy this invite link:", link);
  }
};

// ------------------------------------------------------------ game

function startGame(n: Net): void {
  if (game) return; // a rejoin re-sends "started"; the scene already exists
  show("none");
  for (const id of ["game", "topbar", "bottom"]) $(id).classList.remove("hidden");
  const scene = new GameScene(n);
  scene.onReady = () => {
    const hud = new Hud(scene, n);
    window.addEventListener("keydown", (ev) => {
      if ((ev.target as HTMLElement)?.tagName === "INPUT") return;
      if (hud.handleKey(ev) || scene.handleKey(ev)) ev.preventDefault();
    });
    if (import.meta.env.DEV) Object.assign(window, { koe: { net: n, scene } });
  };
  game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: "game",
    backgroundColor: "#000000",
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene,
  });
}

$("resign-btn").onclick = () => {
  if (confirm("Resign this match?")) net?.send({ type: "resign" });
};
$("help-btn").onclick = () => $("help").classList.remove("hidden");
$("help-close").onclick = () => $("help").classList.add("hidden");
$("end-watch").onclick = () => $("end").classList.add("hidden");
$("end-menu").onclick = () => returnToMenu();

function returnToMenu(): void {
  net?.leave();
  // Simplest reliable reset of Phaser and all screens.
  location.href = location.pathname;
}

// ------------------------------------------------------------ boot

(async () => {
  // Rejoin after a refresh, if this tab was in a match.
  const resumed = await Net.resume(endpoint);
  if (resumed) {
    net = resumed;
    attach(resumed);
    return;
  }
  show("menu");
})();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: fine */
  }
}
