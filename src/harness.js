import { log, errorToJson } from "./logger.js";

export class AgentHarness {
  constructor(role) {
    this.role = role;
  }

  async run(goal, fn) {
    const started = Date.now();
    log(this.role, goal);
    try {
      const result = await fn();
      log(this.role, "cycle finished", { ms: Date.now() - started });
      return result;
    } catch (error) {
      log(this.role, "cycle failed", errorToJson(error), "error");
      throw error;
    }
  }
}
