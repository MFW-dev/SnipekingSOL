import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./config.js";

const LOG_PATH = path.join(REPO_ROOT, "decision-log.json");
const MAX_DECISIONS = 500;

function readLog() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
}

export function recordDecision(entry) {
  const decisions = readLog();
  decisions.push({
    time: new Date().toISOString(),
    actor: entry.actor,
    type: entry.type,
    summary: entry.summary,
    reason: entry.reason,
    risks: entry.risks || [],
    metrics: entry.metrics || {},
    candidate: entry.candidate || null,
    tx: entry.tx || null
  });
  const trimmed = decisions.slice(-MAX_DECISIONS);
  fs.writeFileSync(LOG_PATH, `${JSON.stringify(trimmed, null, 2)}\n`);
}
