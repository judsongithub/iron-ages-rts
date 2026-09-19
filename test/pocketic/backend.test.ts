import { PocketIc } from "@dfinity/pic";
import { Principal } from "@icp-sdk/core/principal";
import { afterAll, beforeAll, expect, it } from "vitest";

import { idlFactory } from "../../src/frontend/src/declarations/backend.did.js";
import type { _SERVICE } from "../../src/frontend/src/declarations/backend.did";

const PIC_URL = process.env.POCKET_IC_URL ?? "";
const BACKEND_WASM = process.env.BACKEND_WASM ?? "";

/**
 * Two distinct, stable (non-anonymous) principals. The anonymous principal is a
 * single shared identity, so the backend refuses to key caller-scoped data on
 * it: `recordMatch`/`saveSettings` trap and the reads return empty. Every test
 * that persists or reads caller-scoped data must therefore set a real caller
 * first — PocketIC's default caller is the anonymous principal.
 */
const ALICE = Principal.fromText("aaaaa-aa");
const BOB = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

let pic: PocketIc | undefined;
let actor: _SERVICE;

beforeAll(async () => {
  pic = await PocketIc.create(PIC_URL);
  ({ actor } = await pic.setupCanister<_SERVICE>({
    idlFactory,
    wasm: BACKEND_WASM,
  }));
});

afterAll(async () => {
  await pic?.tearDown();
});

it("answers empty-state reads instead of trapping", async () => {
  actor.setPrincipal(ALICE);
  await expect(actor.listRecentMatches(10n)).resolves.toEqual([]);
  await expect(actor.getSettings()).resolves.toEqual([]);
  const stats = await actor.getMatchStats();
  expect(stats.totalMatches).toBe(0n);
  expect(stats.wins).toBe(0n);
  expect(stats.losses).toBe(0n);
});

it("round-trips a recorded match through the real canister", async () => {
  actor.setPrincipal(ALICE);
  const id = await actor.recordMatch(
    { romans: null },
    { medium: null },
    { normal: null },
    { victory: null },
    125n,
  );
  expect(id).toBe(0n);

  const recent = await actor.listRecentMatches(10n);
  expect(recent).toHaveLength(1);
  expect(recent[0]).toMatchObject({
    id: 0n,
    faction: { romans: null },
    mapSize: { medium: null },
    difficulty: { normal: null },
    result: { victory: null },
    durationSeconds: 125n,
  });

  const stats = await actor.getMatchStats();
  expect(stats.totalMatches).toBe(1n);
  expect(stats.wins).toBe(1n);
  expect(stats.losses).toBe(0n);
  expect(stats.totalDurationSeconds).toBe(125n);
});

it("round-trips saved settings through the real canister", async () => {
  actor.setPrincipal(ALICE);
  const saved = await actor.saveSettings({
    preferredFaction: { mongols: null },
    preferredDifficulty: { hard: null },
    lastMapSize: { large: null },
  });
  expect(saved).toMatchObject({
    preferredFaction: { mongols: null },
    preferredDifficulty: { hard: null },
    lastMapSize: { large: null },
  });

  const read = await actor.getSettings();
  expect(read).toHaveLength(1);
  expect(read[0]).toMatchObject({
    preferredFaction: { mongols: null },
    preferredDifficulty: { hard: null },
    lastMapSize: { large: null },
  });
});

it("keeps one caller's matches and settings out of another's", async () => {
  // Seed explicitly and compare against Alice's own baseline rather than an
  // absolute count, so this test does not depend on what earlier tests wrote.
  actor.setPrincipal(ALICE);
  const aliceBefore = (await actor.listRecentMatches(100n)).length;
  await actor.recordMatch(
    { vikings: null },
    { small: null },
    { easy: null },
    { defeat: null },
    60n,
  );
  await actor.saveSettings({
    preferredFaction: { vikings: null },
    preferredDifficulty: { easy: null },
    lastMapSize: { small: null },
  });

  actor.setPrincipal(BOB);
  expect(await actor.listRecentMatches(10n)).toEqual([]);
  expect(await actor.getSettings()).toEqual([]);
  const stats = await actor.getMatchStats();
  expect(stats.totalMatches).toBe(0n);

  // Alice still sees her own data after Bob's reads.
  actor.setPrincipal(ALICE);
  expect(await actor.listRecentMatches(100n)).toHaveLength(aliceBefore + 1);
  expect(await actor.getSettings()).toHaveLength(1);
});

it("refuses to persist caller-scoped data for the anonymous caller", async () => {
  actor.setPrincipal(Principal.anonymous());
  await expect(
    actor.recordMatch(
      { romans: null },
      { medium: null },
      { normal: null },
      { victory: null },
      10n,
    ),
  ).rejects.toThrow(/Unauthorized/);
  await expect(
    actor.saveSettings({
      preferredFaction: { romans: null },
      preferredDifficulty: { normal: null },
      lastMapSize: { medium: null },
    }),
  ).rejects.toThrow(/Unauthorized/);
});

it("returns empty results for the anonymous caller instead of trapping", async () => {
  actor.setPrincipal(Principal.anonymous());
  await expect(actor.listRecentMatches(10n)).resolves.toEqual([]);
  await expect(actor.getSettings()).resolves.toEqual([]);
  const stats = await actor.getMatchStats();
  expect(stats.totalMatches).toBe(0n);
  expect(stats.wins).toBe(0n);
  expect(stats.losses).toBe(0n);
});
