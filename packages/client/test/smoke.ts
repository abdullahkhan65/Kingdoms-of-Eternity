// Browser smoke test: real server + real client, two players.
// Player 1 box-selects its units and right-clicks; player 2 must see them move.
//   npm run smoke            (screenshots go to $SMOKE_OUT or ./smoke-out)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const SERVER_PORT = 2570;
/** World units per second: sim speed 3/tick at 20 Hz. */
const UNIT_SPEED = 60;
const CLIENT_PORT = 5180;
const out = process.env.SMOKE_OUT ?? "smoke-out";
mkdirSync(out, { recursive: true });

function startAndWait(cmd: string, args: string[], env: Record<string, string>, readyText: string, cwd?: string): Promise<ChildProcess> {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${readyText}" from ${cmd}`)), 30_000);
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

/** Phaser handles input on its next frame, so wait for the HUD instead of reading it right away. */
async function waitForHud(page: Page, pattern: RegExp): Promise<boolean> {
  try {
    await page.waitForFunction((src) => new RegExp(src).test(document.getElementById("hud")?.textContent ?? ""), pattern.source, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Average position of `player`'s units as this page currently renders them. */
function centroid(page: Page, player: number) {
  return page.evaluate((p) => {
    const units = [...((window as any).koe.sample(performance.now()) as Map<number, { owner: number; x: number; y: number }>).values()].filter((u) => u.owner === p);
    return { n: units.length, x: units.reduce((s, u) => s + u.x, 0) / units.length, y: units.reduce((s, u) => s + u.y, 0) / units.length };
  }, player);
}

const children: ChildProcess[] = [];
const errors: string[] = [];
let failed = false;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) failed = true;
};

try {
  children.push(await startAndWait(process.execPath, ["--import", "tsx", "packages/server/src/main.ts"], { PORT: String(SERVER_PORT) }, "listening on"));
  children.push(await startAndWait(process.execPath, ["node_modules/vite/bin/vite.js", "packages/client", "--port", String(CLIENT_PORT), "--strictPort"], {}, "Local:"));

  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const url = `http://localhost:${CLIENT_PORT}/?server=ws://localhost:${SERVER_PORT}`;
  const pages: Page[] = [];
  for (let i = 0; i < 2; i++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (e) => errors.push(`page ${i + 1}: ${e.message}`));
    page.on("console", (m) => m.type() === "error" && errors.push(`page ${i + 1} console: ${m.text()}`));
    await page.goto(url);
    await page.waitForFunction(() => /12 units/.test(document.getElementById("hud")?.textContent ?? ""), null, { timeout: 15_000 });
    pages.push(page);
  }
  const [p1, p2] = pages as [Page, Page];
  check(true, "both players joined and see their 12 units");
  await p1.screenshot({ path: `${out}/1-joined.png` });

  // Player 1: drag-select the whole screen (only own units get selected), then right-click 400px to the right.
  await p1.mouse.move(40, 60);
  await p1.mouse.down();
  await p1.mouse.move(1240, 740, { steps: 8 });
  await p1.mouse.up();
  check(await waitForHud(p1, /12 selected/), `box select picks exactly own units (${await p1.locator("#hud").textContent()})`);

  const before = await centroid(p2, 0);
  await p1.mouse.click(1040, 400, { button: "right" });
  await p1.waitForTimeout(150);
  await p1.screenshot({ path: `${out}/2-order-feedback.png` });
  const seconds = 5;
  await p1.waitForTimeout(seconds * 1000);
  const after = await centroid(p2, 0);
  const dx = after.x - before.x;
  // Target is 800 world units away (400 px at zoom 0.5), so they're still walking: expect most of speed × time.
  check(dx > UNIT_SPEED * seconds * 0.6, `player 2 sees player 1's units move right (Δx = ${Math.round(dx)}, max possible ${UNIT_SPEED * seconds})`);
  const p1View = await centroid(p1, 0);
  check(Math.abs(p1View.x - after.x) < 30, `both players see the units in the same place (differ by ${Math.round(Math.abs(p1View.x - after.x))})`);
  check(Math.abs(after.y - before.y) < 150, `…and roughly level (Δy = ${Math.round(after.y - before.y)})`);
  await p1.screenshot({ path: `${out}/3-moved.png` });

  // Player 2 can't command player 1's units: its selection only ever contains its own.
  await p2.mouse.move(40, 60);
  await p2.mouse.down();
  await p2.mouse.move(1240, 740, { steps: 8 });
  await p2.mouse.up();
  check(await waitForHud(p2, /12 selected/), "player 2 selects only its own 12 units");

  check(errors.length === 0, `no browser errors${errors.length ? ":\n  " + errors.join("\n  ") : ""}`);
  await browser.close();
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  for (const c of children) c.kill();
}
process.exit(failed ? 1 : 0);
