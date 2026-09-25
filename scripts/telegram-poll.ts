// scripts/telegram-poll.ts
import dotenv from 'dotenv';
dotenv.config({ path: './.env.local' });

const token = process.env.PILOT_TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('No TELEGRAM_BOT_TOKEN found in .env.local');
  process.exit(1);
}

const apiUrl = `https://api.telegram.org/bot${token}`;
let offset = 0;

// Helper to send a message
async function sendMessage(chatId: number, text: string) {
  const resp = await fetch(`${apiUrl}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!resp.ok) {
    console.error('Failed to send message:', await resp.text());
  }
}

// Main polling loop
(async () => {
  console.log('🚀 Creator OS Telegram worker starting...');
  try {
    // Get bot info to show username
    const meResp = await fetch(`${apiUrl}/getMe`);
    const meData = await meResp.json();
    if (meData.ok) {
      console.log(`✅ Connected as @${meData.result.username}`);
    } else {
      console.error('Failed to get bot info:', meData);
    }
    console.log(`📅 Daily workspace pulse: ${process.env.PILOT_TELEGRAM_DAILY_HOUR}:${process.env.PILOT_TELEGRAM_DAILY_MINUTE} ${process.env.PILOT_TELEGRAM_TIMEZONE}`);
    console.log('🔄 Waiting for messages…');

    while (true) {
      const resp = await fetch(`${apiUrl}/getUpdates?offset=${offset}&timeout=30`);
      const data = await resp.json();
      if (!data.ok) {
        console.error('Error in getUpdates:', data);
        // Wait a bit before retrying to avoid tight loop on error
        await new Promise(res => setTimeout(res, 5000));
        continue;
      }
      for (const update of data.result) {
        offset = update.update_id + 1;
        const message = update.message;
        if (!message) continue;
        if (message.text && message.text.startsWith('/start')) {
          await sendMessage(message.chat.id, 'I am the Creator OS Telegram doorway.\n\nTo connect me to your workspace:\n1️⃣ Open Creator OS → Settings → Telegram → Connect Telegram.\n2️⃣ Generate a connection link.\n3️⃣ Open that link in Telegram to finish the set‑up.');
        }
        // Optionally handle other messages here
      }
    }
  } catch (err) {
    console.error('❌ Polling error:', err);
  }
})();