import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.js";

const STATE_PATH = path.join(REPO_ROOT, "state.json");

function defaultState() {
  return {
    seenSignatures: {},
    seenMints: {},
    watchlist: [],
    openPositions: [],
    closedPositions: []
  };
}

export function loadState() {
  if (!fs.existsSync(STATE_PATH)) return defaultState();
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  return { ...defaultState(), ...state };
}

export function saveState(state) {
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

export function pruneSeen(state, maxAgeHours = 24) {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
  for (const [key, value] of Object.entries(state.seenSignatures || {})) {
    if (new Date(value).getTime() < cutoff) delete state.seenSignatures[key];
  }
}

export function isMintOnCooldown(state, mint, cooldownMinutes) {
  const last = state.seenMints?.[mint];
  if (!last) return false;
  return Date.now() - new Date(last).getTime() < cooldownMinutes * 60 * 1000;
}

export function markMintSeen(state, mint) {
  state.seenMints ||= {};
  state.seenMints[mint] = new Date().toISOString();
}

export function isMintWatched(state, mint) {
  return (state.watchlist || []).some((candidate) => candidate.mint === mint);
}

export function addWatchCandidate(state, candidate, waitTimeMinutes) {
  state.watchlist ||= [];
  if (isMintWatched(state, candidate.mint)) return null;

  const now = Date.now();
  const item = {
    ...candidate,
    firstSeenAt: candidate.seenAt || new Date(now).toISOString(),
    eligibleAt: new Date(now + waitTimeMinutes * 60_000).toISOString(),
    attempts: 0
  };
  state.watchlist.push(item);
  return item;
}

export function dueWatchCandidates(state, now = Date.now()) {
  return (state.watchlist || []).filter((candidate) => new Date(candidate.eligibleAt).getTime() <= now);
}

export function removeWatchCandidate(state, mint) {
  const watchlist = state.watchlist || [];
  const item = watchlist.find((candidate) => candidate.mint === mint) || null;
  state.watchlist = watchlist.filter((candidate) => candidate.mint !== mint);
  return item;
}

export function addOpenPosition(state, position) {
  state.openPositions.push(position);
}

export function replaceOpenPosition(state, nextPosition) {
  state.openPositions = state.openPositions.map((position) =>
    position.id === nextPosition.id ? nextPosition : position
  );
}

export function closePosition(state, positionId, patch = {}) {
  const index = state.openPositions.findIndex((position) => position.id === positionId);
  if (index === -1) return null;
  const [position] = state.openPositions.splice(index, 1);
  const closed = {
    ...position,
    ...patch,
    status: "closed",
    closedAt: new Date().toISOString()
  };
  state.closedPositions.push(closed);
  return closed;
}
