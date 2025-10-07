import { Telegraf } from "telegraf";
import pkg from "whatsapp-web.js";
import QRCode from "qrcode";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import archiver from "archiver";

dotenv.config();
const { Client, LocalAuth } = pkg;

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const PORT = process.env.PORT || 3000;

// Persistent Disk path (Render)
const DATA_PATH = "/opt/data";  
if (!fs.existsSync(DATA_PATH)) fs.mkdirSync(DATA_PATH, { recursive: true });

if (!TELEGRAM_TOKEN) {
  console.error("❌ TELEGRAM_TOKEN missing");
  process.exit(1);
}

// Telegram bot
const bot = new Telegraf(TELEGRAM_TOKEN);

// WhatsApp Client
let waClient;
let waReady = false;

async function startWhatsApp() {
  console.log("📱 Starting WhatsApp client...");
  waClient = new Client({
    authStrategy: new LocalAuth({ clientId: "central", dataPath: DATA_PATH }),
    puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
  });

  waClient.on("qr", async (qr) => {
    console.log("⚡ New QR generated.");
    const qrImage = await QRCode.toBuffer(qr);
    if (process.env.ADMIN_ID) {
      await bot.telegram.sendPhoto(
        process.env.ADMIN_ID,
        { source: qrImage },
        { caption: "📲 Scan this QR with WhatsApp" }
      );
    }
  });

  waClient.on("ready", () => {
    waReady = true;
    console.log("✅ WhatsApp is ready and session is persistent.");
  });

  waClient.on("disconnected", () => {
    console.log("❌ WhatsApp disconnected. Reconnecting...");
    waReady = false;
    startWhatsApp();
  });

  await waClient.initialize();
}
startWhatsApp();

// Telegram commands
bot.start((ctx) => {
  ctx.reply(
    `👋 Welcome ${ctx.from.first_name}!\n\n` +
      `Commands:\n` +
      `/linkwhatsapp - Link WhatsApp\n` +
      `/checknumbers - Check WhatsApp numbers\n` +
      `/export_session - Backup WhatsApp session`
  );
});

// Link WhatsApp
bot.command("linkwhatsapp", (ctx) => {
  ctx.reply(
    "🔗 To link WhatsApp, scan the QR sent to admin or wait for QR in your chat."
  );
});

// Check numbers
bot.command("checknumbers", (ctx) => {
  if (!waReady) return ctx.reply("⚠️ WhatsApp not ready yet.");
  ctx.reply("Send numbers separated by newline or comma:");

  bot.on("message", async (msgCtx) => {
    const text = msgCtx.message.text;
    if (!text) return;

    const numbers = text
      .split(/[\s,]+/)
      .map((n) => n.replace(/\D/g, ""))
      .filter(Boolean);

    const found = [];
    const notFound = [];

    await msgCtx.reply("🔍 Checking WhatsApp status...");

    for (const num of numbers) {
      try {
        const res = await waClient.isRegisteredUser(num);
        if (res) found.push("+" + num);
        else notFound.push("+" + num);
      } catch {
        notFound.push("+" + num + " (error)");
      }
    }

    let reply =
      `✅ *WhatsApp Available:*\n${found.join("\n") || "None"}\n\n` +
      `❌ *Not Available:*\n${notFound.join("\n") || "None"}`;
    await msgCtx.reply(reply, { parse_mode: "Markdown" });
  });
});

// Export WhatsApp session
bot.command("export_session", async (ctx) => {
  try {
    const output = fs.createWriteStream("/opt/data/session.zip");
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(DATA_PATH, false);
    await archive.finalize();

    output.on("close", async () => {
      await ctx.replyWithDocument({ source: "/opt/data/session.zip", filename: "session.zip" });
    });
  } catch (err) {
    console.error(err);
    ctx.reply("❌ Failed to export session.");
  }
});

// Launch bot
bot.launch();
console.log("🚀 Telegram bot started with persistent WhatsApp session");

// Express server to keep alive on Render
const app = express();
app.get("/", (_, res) => res.send("Bot is running ✅"));
app.listen(PORT, () => console.log(`🌍 Web server on port ${PORT}`));