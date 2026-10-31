// Visual check, not a test: screenshots of the art in a live match for a human to look at.
//   npm run look [-- <dir>]   (default ./smoke-out)
import { spawn, type ChildProcess } from "node:child_process";
import { chromium } from "playwright";

const out = process.argv[2] ?? "smoke-out";
function start(cmd: string, args: string[], env: Record<string, string>, ready: string): Promise<ChildProcess> {
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout " + ready)), 30000);
    const on = (c: Buffer) => { if (c.toString().includes(ready)) { clearTimeout(t); resolve(child); } };
    child.stdout!.on("data", on);
    child.stderr!.on("data", on);
  });
}
const server = await start(process.execPath, ["--import", "tsx", "packages/server/src/main.ts"], { PORT: "2571" }, "listening");
const client = await start(process.execPath, ["node_modules/vite/bin/vite.js", "packages/client", "--port", "5181", "--strictPort"], {}, "Local:");
try {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text()); });
  await page.addInitScript("window.__name = (f) => f");
  // Give both sides an army so there's a fight to look at.
  await page.route("**/matchmake/**", (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    route.continue({ postData: JSON.stringify({ ...body, extraUnits: 10 }) });
  });
  await page.goto("http://localhost:5181/?server=ws://localhost:2571");
  await page.fill("#name", "Look");
  await page.click("#play-bot");
  await page.waitForFunction(() => (window as any).koe?.scene?.entities?.size > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1000);
  console.log("terrain 128x128 paint ms:", await page.evaluate(async () => {
    const src = "/src/terrain.ts"; // served by Vite, resolved in the browser
    const { paintTerrain } = await import(src);
    const t = performance.now();
    paintTerrain(128, 128, new Uint8Array(128 * 128).map((_, i) => ((i * 7) % 13 === 0 ? 1 : 0)));
    return Math.round(performance.now() - t);
  }));
  // Villagers: one chops, one builds a house, one picks berries. The army marches on the enemy.
  const enemyAt = await page.evaluate(() => {
    const { scene, net } = (window as any).koe;
    const mine = [...net.latest().values()].filter((e: any) => e.owner === scene.me);
    const tc = mine.find((e: any) => e.type === 20);
    const vills = mine.filter((e: any) => e.type === 1);
    const all = [...net.latest().values()] as any[];
    const near = (t: number) => all.filter((e) => e.type === t).sort((a, b) => Math.hypot(a.x - tc.x, a.y - tc.y) - Math.hypot(b.x - tc.x, b.y - tc.y))[0];
    scene.issue({ type: "interact", ids: [vills[0].id], target: near(40).id });
    scene.issue({ type: "interact", ids: [vills[1].id], target: near(42).id });
    scene.issue({ type: "build", ids: [vills[2].id], building: 21, tx: Math.floor(tc.x / 64) - 4, ty: Math.floor(tc.y / 64) + 2 });
    const W = scene.cols * 64, H = scene.rows * 64;
    const target = { x: W - tc.x, y: H - tc.y };
    scene.issue({ type: "attackMove", ids: mine.filter((e: any) => e.type === 2).map((e: any) => e.id), x: Math.round(target.x), y: Math.round(target.y) });
    scene.cameras.main.setZoom(1.2);
    scene.centerOn(tc.x - 120, tc.y + 100);
    return target;
  });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}/f-work.png` });
  // Follow the army until it meets the enemy.
  for (let i = 0; i < 60; i++) {
    const fighting = await page.evaluate(() => {
      const { scene, net } = (window as any).koe;
      const army = [...net.latest().values()].filter((e: any) => e.owner === scene.me && e.type === 2);
      if (army.length === 0) return true;
      const cx = army.reduce((s: number, e: any) => s + e.x, 0) / army.length;
      const cy = army.reduce((s: number, e: any) => s + e.y, 0) / army.length;
      scene.centerOn(cx, cy);
      return [...net.latest().values()].some((e: any) => e.owner !== scene.me && e.owner !== 255 && Math.hypot(e.x - cx, e.y - cy) < 500);
    });
    if (fighting) break;
    await page.waitForTimeout(1500);
  }
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(i < 4 ? 1500 : 450);
    await page.screenshot({ path: `${out}/g-fight${i}.png` });
  }
  console.log("enemy near", enemyAt);
  await browser.close();
} finally {
  server.kill();
  client.kill();
}
