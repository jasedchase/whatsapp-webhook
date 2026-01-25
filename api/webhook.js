export default async function handler(req, res) {
  // =====================================================
  // 1️⃣ Webhook verification (required by Meta)
  // =====================================================
  if (req.method === "GET") {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  // =====================================================
  // 2️⃣ Incoming WhatsApp message
  // =====================================================
  if (req.method === "POST") {
    try {
      const entry = req.body.entry?.[0];
      const changes = entry?.changes?.[0];
      const message = changes?.value?.messages?.[0];

      // Always acknowledge Meta
      if (!message || message.type !== "text") {
        return res.sendStatus(200);
      }

      const from = message.from;
      const text = message.text.body;

      // =====================================================
      // 3️⃣ Sample reply (NO AI)
      // =====================================================
      const reply = `👋 Hello!

You said:
"${text}"

✅ This reply is coming from:
• WhatsApp Cloud API
• Vercel serverless
• Node.js webhook

(No AI yet 🚀)`;

      await sendWhatsAppMessage(from, reply);

      return res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err);
      return res.sendStatus(200); // Always return 200 to Meta
    }
  }
}

// =====================================================
// 📤 Send message back to WhatsApp
// =====================================================
async function sendWhatsAppMessage(to, text) {
  await fetch(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text }
      })
    }
  );
}