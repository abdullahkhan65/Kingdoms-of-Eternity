// Browser smoke test: real server + real client. Two humans and a computer in
// one lobby, then core gameplay through actual clicks and hotkeys.
//   npm run smoke            (screenshots go to $SMOKE_OUT or ./smoke-out)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const SERVER_PORT = 2570;
const CLIENT_PORT = 5180;
const out = process.env.SMOKE_OUT ?? "smoke-out";
mkdirSync(out, { recursive: true });

function startAndWait(cmd: string, args: string[], env: Record<string, string>, readyText: string): Promise<ChildProcess> {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${readyText}"`)), 30_000);
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes(readyText)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout!.on("data", onData);
    child.stderr!.on("data", onData);
    child.on("exit", (code) => reject(new Error(`${cmd} exited with ${code}`)));
  });
}

let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed = true;
};

async function waitFor(page: Page, fn: string, timeout = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction(fn, null, { timeout });
    return true;
  } catch {
    return false;
  }
}

/** Screen position of a world point in this page's camera. */
function toScreen(page: Page, x: number, y: number) {
  return page.evaluate(([wx, wy]) => {
    const cam = (window as any).koe.scene.cameras.main;
    const v = cam.worldView;
    return { x: cam.x + (wx! - v.x) * cam.zoom, y: cam.y + (wy! - v.y) * cam.zoom };
  }, [x, y]);
}

const mine = (page: Page, type: number) =>
  page.evaluate((t) => {
    const { net, scene } = (window as any).koe;
    return [...net.latest().values()].filter((e: any) => e.owner === scene.me && e.type === t);
  }, type) as Promise<Array<{ id: number; x: number; y: number }>>;

const you = (page: Page) => page.evaluate(() => (window as any).koe.net.you) as Promise<{ food: number; wood: number; gold: number; pop: number; queues: Record<string, { items: number[] }> }>;

const children: ChildProcess[] = [];
const errors: string[] = [];
try {
  children.push(await startAndWait(process.execPath, ["--import", "tsx", "packages/server/src/main.ts"], { PORT: String(SERVER_PORT) }, "listening on"));
  children.push(await startAndWait(process.execPath, ["node_modules/vite/bin/vite.js", "packages/client", "--port", String(CLIENT_PORT), "--strictPort"], {}, "Local:"));

  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const url = `http://localhost:${CLIENT_PORT}/?server=ws://localhost:${SERVER_PORT}`;
  const open = async (i: number) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    page.on("pageerror", (e) => errors.push(`page ${i}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`page ${i} console: ${m.text()}`));
    page.on("dialog", (d) => void d.accept());
    await page.goto(url);
    return page;
  };

  // ---- lobby
  const p1 = await open(1);
  await p1.fill("#name", "Alice");
  await p1.click("#create");
  check(await waitFor(p1, `document.getElementById("room-code").textContent.length > 3`), "host creates a lobby with a room code");
  const code = (await p1.textContent("#room-code"))!;
  const p2 = await open(2);
  await p2.fill("#name", "Bob");
  await p2.fill("#join-code", code);
  await p2.click("#join");
  check(await waitFor(p1, `document.querySelectorAll("#seats tr").length === 2`), "second player appears in the host's lobby");
  await p1.click("#add-bot");
  check(await waitFor(p2, `document.querySelectorAll("#seats tr").length === 3 && document.getElementById("seats").textContent.includes("🤖")`), "computer player added, visible to everyone");
  check(await p2.isVisible("#wait-host"), "non-host waits for the host");
  await p1.screenshot({ path: `${out}/1-lobby.png` });
  await p1.click("#start");
  check(await waitFor(p1, `!!window.koe && window.koe.net.you && window.koe.net.latest()`) && await waitFor(p2, `!!window.koe && window.koe.net.you`), "match starts for both players");
  await p1.waitForTimeout(1500);
  await p1.screenshot({ path: `${out}/2-start.png` });

  // ---- economy: build a House with all villagers
  const villagers = await mine(p1, 1);
  check(villagers.length === 3, `start with 3 villagers (${villagers.length})`);
  const tc = (await mine(p1, 20))[0]!;
  const a = await toScreen(p1, tc.x - 260, tc.y - 260);
  const b = await toScreen(p1, tc.x + 260, tc.y + 300);
  await p1.mouse.move(a.x, a.y);
  await p1.mouse.down();
  await p1.mouse.move(b.x, b.y, { steps: 6 });
  await p1.mouse.up();
  check(await waitFor(p1, `window.koe.scene.selected.size === 3`, 3000), "drag-select picks the 3 villagers");
  await p1.keyboard.press("q"); // House is the first build button
  check(await waitFor(p1, `window.koe.scene.mode.k === "place"`, 2000), "Q starts placing a House");
  const woodBefore = (await you(p1)).wood;
  let placed = false;
  for (const [dx, dy] of [[-200, 0], [200, 0], [0, -220], [-200, -200], [200, -200]] as const) {
    const s = await toScreen(p1, tc.x + dx, tc.y + dy);
    await p1.mouse.move(s.x, s.y);
    await p1.waitForTimeout(100);
    await p1.mouse.click(s.x, s.y);
    if (await waitFor(p1, `window.koe.net.you.wood < ${woodBefore}`, 2000)) {
      placed = true;
      break;
    }
  }
  check(placed, "placing the House spends 30 wood");
  check(await waitFor(p1, `[...window.koe.net.latest().values()].some(e => e.type === 21 && e.owner === window.koe.scene.me && !(e.flags & 1))`, 40_000), "villagers finish building the House");
  await p1.screenshot({ path: `${out}/3-house.png` });

  // ---- gather wood: right-click the nearest tree
  const tree = await p1.evaluate(() => {
    const { net } = (window as any).koe;
    const tc = [...net.latest().values()].find((e: any) => e.type === 20 && e.owner === net.started.you);
    return [...net.latest().values()].filter((e: any) => e.type === 40).sort((a: any, b: any) => Math.hypot(a.x - tc.x, a.y - tc.y) - Math.hypot(b.x - tc.x, b.y - tc.y))[0];
  });
  await p1.evaluate(() => (window as any).koe.scene.centerOn(...[0, 0])); // reset then center on the tree
  await p1.evaluate(([x, y]) => (window as any).koe.scene.centerOn(x, y), [tree.x, tree.y]);
  await p1.evaluate(() => (window as any).koe.scene.select((window as any).koe.scene.entities && [...(window as any).koe.net.latest().values()].filter((e: any) => e.type === 1 && e.owner === (window as any).koe.scene.me).map((e: any) => e.id)));
  await p1.waitForTimeout(200);
  const ts = await toScreen(p1, tree.x, tree.y);
  const wood0 = (await you(p1)).wood;
  await p1.mouse.click(ts.x, ts.y, { button: "right" });
  check(await waitFor(p1, `window.koe.net.you.wood > ${wood0}`, 45_000), "villagers chop wood and bring it home");
  check(await waitFor(p1, `document.getElementById("idle-btn").textContent === "Idle villagers: 0"`, 3000), "working villagers don't count as idle");

  // ---- train a villager from the Town Center (H selects it, Q trains)
  await p1.keyboard.press("h");
  const food0 = (await you(p1)).food;
  await p1.keyboard.press("q");
  check(await waitFor(p1, `window.koe.net.you.food === ${food0 - 50}`, 3000), "H then Q queues a villager (−50 food)");
  check(await waitFor(p1, `[...window.koe.net.latest().values()].filter(e => e.type === 1 && e.owner === window.koe.scene.me).length === 4`, 30_000), "the new villager walks out of the Town Center");
  await p1.screenshot({ path: `${out}/4-economy.png` });

  // ---- fog of war: player 2 must not receive player 1's villagers across the map
  const leak = await p2.evaluate(() => {
    const { net } = (window as any).koe;
    return [...net.latest().values()].filter((e: any) => e.owner !== net.started.you && e.owner !== 255 && e.type === 1).length;
  });
  check(leak === 0, `fog of war: player 2 sees no enemy villagers at their base (${leak})`);

  // ---- rejoin after a refresh
  await p2.reload();
  check(await waitFor(p2, `!!window.koe && window.koe.net.you && window.koe.net.latest() && window.koe.net.latest().size > 10`, 20_000), "a refreshed tab rejoins the running match");
  await p2.screenshot({ path: `${out}/5-rejoined.png` });

  // ---- single player: "Play vs Computer" goes straight into a match
  const p3 = await open(3);
  await p3.click("#play-bot");
  check(await waitFor(p3, `!!window.koe && window.koe.net.started && window.koe.net.started.seats.length === 2 && window.koe.net.started.seats.some(s => s.bot)`), "Play vs Computer starts a 1v1 against a bot");

  check(errors.length === 0, `no browser errors${errors.length ? ":\n  " + errors.join("\n  ") : ""}`);
  await browser.close();
} catch (err) {
  console.error(err);
  if (errors.length) console.error("browser errors:\n  " + errors.join("\n  "));
  failed = true;
} finally {
  for (const c of children) c.kill();
}
process.exit(failed ? 1 : 0);
