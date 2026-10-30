// Civ balance check: bot vs bot on several seeds, then again with civs swapped
// so start position can't explain the result.   npm run balance
import { BOT_INTERVAL, CIVS, generateMatch, newBotMemory, runBot, step } from "@koe/sim";

const SEEDS = [3, 11, 21, 40];
const MAX_MINUTES = 40;
const wins = [0, 0];

for (const swap of [false, true]) {
  for (const seed of SEEDS) {
    const w = generateMatch(seed, [{ slot: 0, team: 0, civ: swap ? 1 : 0 }, { slot: 1, team: 0, civ: swap ? 0 : 1 }]);
    const memory = [newBotMemory(), newBotMemory()];
    for (let t = 0; t < MAX_MINUTES * 60 * 20 && w.winnerTeam === null; t++) {
      if (t % BOT_INTERVAL === 0) for (const slot of [0, 1]) runBot(w, slot, memory[slot]!);
      step(w);
    }
    const minutes = (w.tick / 1200).toFixed(1);
    if (w.winnerTeam === null) {
      console.log(`seed ${seed}${swap ? " (swapped)" : ""}: no winner after ${minutes} min`);
      continue;
    }
    const civ = w.players[w.winnerTeam - 1000]!.civ;
    wins[civ]!++;
    console.log(`seed ${seed}${swap ? " (swapped)" : ""}: ${CIVS[civ]!.name} won at ${minutes} min`);
  }
}
console.log(`\n${CIVS[0]!.name} ${wins[0]} – ${wins[1]} ${CIVS[1]!.name}`);
