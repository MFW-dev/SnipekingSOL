const LEVELS = new Set(["debug", "info", "warn", "error"]);

export function log(scope, message, extra = null, level = "info") {
  const safeLevel = LEVELS.has(level) ? level : "info";
  const time = new Date().toISOString();
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[${time}] [${safeLevel}] [${scope}] ${message}${suffix}`);
}

export function errorToJson(error) {
  return {
    name: error?.name,
    message: error?.message || String(error),
    stack: error?.stack?.split("\n").slice(0, 3).join("\n")
  };
}
