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
    return res.status(403).send("Forbidden");
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
        return res.status(200).send("OK");
      }

      const from = message.from;
      const userText = message.text.body;

      // =====================================================
      // 3️⃣ OpenAI response
      // =====================================================
      const aiReply = await getAIResponse(userText);

      await sendWhatsAppMessage(from, aiReply);

      return res.status(200).send("OK");
    } catch (err) {
      console.error("Webhook error:", err);
      return res.status(200).send("OK"); // Always return 200 to Meta
    }
  }
}

async function getAIResponse(userMessage) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful WhatsApp chatbot. Keep replies short and friendly."
        },
        {
          role: "user",
          content: userMessage
        }
      ],
      temperature: 0.7
    })
  });

  const data = await response.json();

  return (
    data.choices?.[0]?.message?.content ||
    "Sorry, I had trouble answering that."
  );
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