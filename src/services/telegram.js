import { errorToJson, log } from "../logger.js";

export class TelegramNotifier {
  constructor(config) {
    this.config = config.telegram;
    this.enabled = Boolean(this.config.enabled && this.config.botToken && this.config.chatId);
    this.baseUrl = this.enabled ? `https://api.telegram.org/bot${this.config.botToken}` : "";
    this.offset = 0;
    this.timer = null;
  }

  async send(message) {
    if (!this.enabled) return;
    try {
      await this.request("sendMessage", {
        chat_id: this.config.chatId,
        text: message,
        disable_web_page_preview: true
      });
    } catch (error) {
      // Filter log: jangan spam jika hanya timeout atau fetch failed
      if (error.message.includes("504") || error.message.includes("fetch failed") || error.name === "AbortError") {
        console.warn(`[telegram] Connection issue, notification skipped: ${error.message}`);
      } else {
        log("telegram", "failed to send message", errorToJson(error), "warn");
      }
    }
  }

  startCommandPolling(statusProvider) {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      this.poll(statusProvider).catch((error) => {
        // Filter log: jangan spam jika polling gagal karena network issue
        if (!error.message.includes("504") && !error.message.includes("fetch failed")) {
          log("telegram", "command polling failed", errorToJson(error), "warn");
        }
      });
    }, this.config.pollIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(statusProvider) {
    const result = await this.request("getUpdates", {
      offset: this.offset,
      timeout: 0,
      allowed_updates: ["message"]
    });

    for (const update of result.result || []) {
      this.offset = Math.max(this.offset, update.update_id + 1);
      const text = update.message?.text || "";
      const chatId = String(update.message?.chat?.id || "");
      if (text.trim() === "/status" && chatId === String(this.config.chatId)) {
        await this.send(statusProvider());
      }
    }
  }

  async request(method, body) {
    // Menambahkan AbortController untuk menangani timeout 15 detik
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); 

    try {
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeout);

      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      
      if (!response.ok || data?.ok === false) {
        throw new Error(`Telegram ${response.status}: ${data?.description || text}`);
      }
      return data;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }
}