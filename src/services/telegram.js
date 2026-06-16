import { errorToJson, log } from "../logger.js";

export class TelegramNotifier {
  constructor(config) {
    this.config = config.telegram;
    this.enabled = Boolean(this.config.enabled && this.config.botToken && this.config.chatId);
    this.baseUrl = this.enabled ? `https://api.telegram.org/bot${this.config.botToken}` : "";
    this.offset = 0;
    this.isPolling = false; // Flag untuk mencegah tumpang tindih
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
      if (error.name === "AbortError") {
        console.warn(`[telegram] Notification timeout (slow network)`);
      } else {
        log("telegram", "failed to send message", errorToJson(error), "warn");
      }
    }
  }

  async startCommandPolling(statusProvider) {
    if (!this.enabled || this.isPolling) return;
    this.isPolling = true;

    // Gunakan fungsi rekursif, bukan setInterval
    const pollLoop = async () => {
      try {
        await this.poll(statusProvider);
      } catch (error) {
        if (error.name !== "AbortError") {
          log("telegram", "command polling error", errorToJson(error), "warn");
        }
      } finally {
        if (this.isPolling) {
          setTimeout(pollLoop, this.config.pollIntervalMs);
        }
      }
    };

    pollLoop();
  }

  stop() {
    this.isPolling = false;
  }

  async poll(statusProvider) {
    const result = await this.request("getUpdates", {
      offset: this.offset,
      timeout: 30, // Biarkan koneksi menunggu server (Long Polling)
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
    // Timeout diperpanjang jadi 30 detik untuk mengakomodasi koneksi lokal
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); 

    try {
      const response = await fetch(`${this.baseUrl}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeout);
      const data = await response.json();
      
      if (!response.ok || data?.ok === false) {
        throw new Error(`Telegram ${response.status}: ${data?.description}`);
      }
      return data;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }
}