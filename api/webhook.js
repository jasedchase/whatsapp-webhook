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
  const knowledge = loadKnowledgeBase();

  console.log("Checking knowledge base first...");

  const kbAnswer = await askOpenAI(knowledge, null, userMessage);

  if (kbAnswer !== "__NOT_FOUND__") {
    console.log("Answered from knowledge base");
    return kbAnswer;
  }

  console.log("Searching website...");

  const websiteContent = await searchWebsite(userMessage);

  if (!websiteContent) {
    return "I don't have that information yet.";
  }

  const siteAnswer = await askOpenAI(
    knowledge,
    websiteContent,
    userMessage
  );

  if (siteAnswer !== "__NOT_FOUND__") {
    console.log("Answered from website");
    return siteAnswer;
  }

  return "I don't have that information yet.";
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

async function getSitemapUrls() {
  const sitemapUrl = "https://www.jplwong.com.sg/sitemap.xml";

  const res = await fetch(sitemapUrl);
  const xml = await res.text();

  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)];
  return matches.map(m => m[1]);
}

async function extractPageText(url) {
  try {
    const res = await fetch(url);
    const html = await res.text();

    return html
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

async function searchWebsite(question) {
  const urls = await getSitemapUrls();

  const keywords = question
    .toLowerCase()
    .split(" ")
    .filter(word => word.length > 3);

  for (const url of urls) {
    console.log("Scanning:", url);

    const text = await extractPageText(url);

    if (!text) continue;

    if (keywords.some(k => text.toLowerCase().includes(k))) {
      console.log("Match found in:", url);
      return text.substring(0, 6000);
    }
  }

  console.log("No website match found");
  return "";
}

async function askOpenAI(knowledge, websiteContent, question) {
  const context = websiteContent
    ? `WEBSITE CONTENT:\n${websiteContent}`
    : "";

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
You are a WhatsApp assistant for JPL Wong & Co, Singapore.

PRIORITY RULES:

1. Always answer using the knowledge base first.
2. Only use WEBSITE CONTENT if the knowledge base does NOT contain the answer.
3. If neither contains the answer, reply exactly:

__NOT_FOUND__

KNOWLEDGE BASE:
${knowledge}

${context}

QUESTION:
${question}
`
      })
    }
  );

  const data = await response.json();

  return (
    data.output_text ||
    data.output
      ?.find(item => item.type === "message")
      ?.content?.find(c => c.type === "output_text")
      ?.text ||
    "__NOT_FOUND__"
  );
}

async function loadKnowledgeBase() {
  try {
    const filePath = path.resolve("./knowledge/knowledge.txt");
    const data = fs.readFileSync(filePath, "utf8");

    return data;
  } catch (err) {
    console.error("Failed to load knowledge file:", err);
    return "";
  }
}