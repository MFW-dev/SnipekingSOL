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
      log("telegram", "failed to send message", error.message, "warn");
    }
  }

  startCommandPolling(statusProvider) {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => {
      this.poll(statusProvider).catch(() => {});
    }, this.config.pollIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(statusProvider) {
    const result = await this.request("getUpdates", {
      offset: this.offset,
      timeout: 30,
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
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    
    if (!response.ok || data?.ok === false) {
      throw new Error(`Telegram API Error: ${data?.description || text}`);
    }
    return data;
  }
}