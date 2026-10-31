import { describe, expect, it } from "vitest";
import { MAX_PLAYERS, MAX_POP } from "@koe/sim";
import { cleanOptions } from "../src/MatchRoom";

describe("room options from the creating client", () => {
  it("keeps valid options", () => {
    expect(cleanOptions({ bots: 1, autoStart: true, seed: 42, extraUnits: 10 })).toEqual({ bots: 1, autoStart: true, seed: 42, extraUnits: 10 });
  });

  it("clamps unit and bot counts so one room can't overload the server", () => {
    const o = cleanOptions({ bots: 1e9, extraUnits: 1e9, seed: -5 });
    expect(o.bots).toBe(MAX_PLAYERS - 1);
    expect(o.extraUnits).toBe(MAX_POP);
    expect(o.seed).toBe(0);
  });

  it("drops options of the wrong type", () => {
    expect(cleanOptions({ bots: "7", autoStart: "yes", seed: 1.5, extraUnits: NaN })).toEqual({ bots: undefined, autoStart: false, seed: undefined, extraUnits: undefined });
    expect(cleanOptions(null)).toEqual({ bots: undefined, autoStart: false, seed: undefined, extraUnits: undefined });
  });
});
