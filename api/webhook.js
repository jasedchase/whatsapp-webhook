import fs from "fs";
import path from "path";

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
  const knowledge = await loadKnowledgeBase();
  console.log("Knowledge length:", knowledge.length);

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5-nano",
        input: `
You are a WhatsApp assistant for JPL Wong & Co, an accounting and audit firm.

Answer client questions using ONLY the knowledge base below.

The knowledge base contains:
- service descriptions
- ESG grant audit procedures
- audit fees
- company incorporation requirements
- bookkeeping and tax requirements
- statutory audit requirements

When a question asks about services, list the services explicitly.

When a question asks about ESG audit fees, return the fee tiers.

When a question asks about requirements, return the requested documents.

Only reply "I don't have that information yet." if the answer truly does not exist in the knowledge base.

KNOWLEDGE BASE:
${knowledge}

CLIENT QUESTION:
${userMessage}
`
      })
    }
  );

  const data = await response.json();

  console.log("OPENAI RAW RESPONSE:", JSON.stringify(data, null, 2));

  return (
    data.output_text ||
    data.output?.[0]?.content?.[0]?.text ||
    "I couldn’t find that in the knowledge base."
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

async function loadKnowledgeBase() {
  try {
    const filePath = path.resolve("./knowledge/knowledge.txt");
    const data = fs.readFileSync(filePath, "utf8");

    console.log("Loaded knowledge from:", filePath);
    console.log("Knowledge preview:", data.substring(0, 100));

    return data;
  } catch (err) {
    console.error("Failed to load knowledge file:", err);
    return "";
  }
}