const Groq = require("groq-sdk");
const { getConfig } = require("./config");

let groqClient = null;
let lastApiKey = null;

function getGroqClient() {
  const apiKey = getConfig().GROQ_API_KEY || process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  if (!groqClient || lastApiKey !== apiKey) {
    groqClient = new Groq({ apiKey });
    lastApiKey = apiKey;
  }
  return groqClient;
}

function getModel() {
  return getConfig().MODEL || process.env.MODEL || "openai/gpt-oss-120b";
}

function getMaxHistory() {
  const h = getConfig().MAX_HISTORY || process.env.MAX_HISTORY || "30";
  return parseInt(h, 10);
}

const DEFAULT_SYSTEM_PROMPT = `
তুমি শ্রেয়া। তুমি অনলাইন সার্ভিস দাও। ইউজারের সাথে বাংলা বা বাংলিশে মিষ্টি, ফ্রেন্ডলি, ক্যাজুয়াল ও ছোট রিপ্লাই দেবে।

【নির্দিষ্ট ট্রিগার ও রিপ্লাই】

১) কেউ যদি বলে "কাজ করতে চাই", "কাজ করবো", "কাজ লাগবে", "কাজ করবা", "কাজ করতে চাও" — তখন বলবে:
"কাজ করতে চাইলে টেলিগ্রামে মেসেজ দিন: https://t.me/ShreyaGhosh69"

২) কেউ যদি বলে "সার্ভিস নিতে চাই", "সার্ভিস লাগবে", "সার্ভিস দাও", "সার্ভিস নিতে চাও" — তখন বলবে:
"সার্ভিস নিতে চাইলে টেলিগ্রামে মেসেজ দিন: https://t.me/ShreyaGhosh69"

৩) কেউ যদি জিজ্ঞেস করে "স্যাম্পল হবে কি?", "স্যাম্পল দাও", "স্যাম্পল দেখা যাবে?", "ডেমো হবে?" — তখন বলবে:
"কাজের আগে ১ মিনিটের স্যাম্পল দেখানো হবে, তারপর পেমেন্ট করে কাজ করতে হবে।"

【অন্যান্য】

কেউ রেট, ডিটেইলস, সময় বা কীভাবে কাজ হবে জিজ্ঞেস করলে বলবে:
"টেলিগ্রামে মেসেজ দাও: https://t.me/ShreyaGhosh69"

কেউ অশ্লীল, যৌন, ইঙ্গিতপূর্ণ বা অসভ্য কথা বললে ভদ্রভাবে বলবে:
"এখানে এসব বলবেন না। টেলিগ্রামে মেসেজ দিন: https://t.me/ShreyaGhosh69"

কখনোই অশ্লীল, যৌন, বেআইনি, হিংস্র, হ্যারাসমেন্ট বা এক্সপ্লিসিট কনটেন্ট তৈরি করবে না। কেউ জোর করলেও করবে না।

অন্য কোনো লিংক, ফোন নম্বর, পেমেন্ট ডিটেইল বা ব্যক্তিগত তথ্য শেয়ার করবে না।

কেউ জিজ্ঞেস করলে বলবে:
"আমি শ্রেয়ার অ্যাসিস্ট্যান্ট, ওর হয়ে রিপ্লাই দিচ্ছি।"

【স্টাইল】
রিপ্লাই ১-২ বাক্যে রাখবে। প্রযোজনে ১টা ইমোজি ব্যবহার করবে। একই কথা হুবহু বারবার রিপিট করবে না, একটু ভিন্নভাবে বলবে।
`.trim();

let currentSystemPrompt = DEFAULT_SYSTEM_PROMPT;
let globalAiEnabled = true;

function getSystemPrompt() {
  return currentSystemPrompt;
}

function setSystemPrompt(prompt) {
  if (typeof prompt === "string" && prompt.trim()) {
    currentSystemPrompt = prompt.trim();
    try {
      const { saveConfigToDb } = require("./config");
      saveConfigToDb({ SYSTEM_PROMPT: currentSystemPrompt });
    } catch {}
  }
  return currentSystemPrompt;
}

function resetSystemPrompt() {
  currentSystemPrompt = DEFAULT_SYSTEM_PROMPT;
  try {
    const { saveConfigToDb } = require("./config");
    saveConfigToDb({ SYSTEM_PROMPT: currentSystemPrompt });
  } catch {}
  return currentSystemPrompt;
}

function isGlobalAiEnabled() {
  return globalAiEnabled;
}

function setGlobalAiEnabled(enabled) {
  globalAiEnabled = Boolean(enabled);
  return globalAiEnabled;
}

function getRuleBasedReply(text) {
  const t = (text || "").toLowerCase();
  if (
    t.includes("কাজ করতে চাই") ||
    t.includes("কাজ করবো") ||
    t.includes("কাজ লাগবে") ||
    t.includes("কাজ করবা") ||
    t.includes("কাজ করতে চাও")
  ) {
    return "কাজ করতে চাইলে টেলিগ্রামে মেসেজ দিন: https://t.me/ShreyaGhosh69";
  }
  if (
    t.includes("সার্ভিস নিতে চাই") ||
    t.includes("সার্ভিস লাগবে") ||
    t.includes("সার্ভিস দাও") ||
    t.includes("সার্ভিস নিতে চাও")
  ) {
    return "সার্ভিস নিতে চাইলে টেলিগ্রামে মেসেজ দিন: https://t.me/ShreyaGhosh69";
  }
  if (
    t.includes("স্যাম্পল") ||
    t.includes("ডেমো")
  ) {
    return "কাজের আগে ১ মিনিটের স্যাম্পল দেখানো হবে, তারপর পেমেন্ট করে কাজ করতে হবে।";
  }
  if (
    t.includes("রেট") ||
    t.includes("ডিটেইলস") ||
    t.includes("কীভাবে কাজ হবে")
  ) {
    return "টেলিগ্রামে মেসেজ দাও: https://t.me/ShreyaGhosh69";
  }
  return null;
}

/**
 * history: [{ role: "user" | "assistant", content: string }, ...]
 * (সর্বশেষ মেসেজ সহ)
 */
async function generateReply(history) {
  const lastMsg = history[history.length - 1]?.content || "";
  const ruleReply = getRuleBasedReply(lastMsg);
  if (ruleReply) {
    return ruleReply;
  }

  const groq = getGroqClient();
  if (!groq) {
    return "হ্যালো! আমি শ্রেয়া 💜 কিভাবে সাহায্য করতে পারি? (নোট: সম্পূর্ণ AI উত্তরের জন্য Settings-এ GROQ_API_KEY সেট করুন)";
  }

  try {
    const maxHist = getMaxHistory();
    const model = getModel();
    const trimmed = history.slice(-maxHist);

    const messages = [
      { role: "system", content: currentSystemPrompt },
      ...trimmed.map((m) => ({ role: m.role, content: m.content })),
    ];

    const completion = await groq.chat.completions.create({
      model,
      messages,
      temperature: 0.6,
      max_tokens: 400,
    });

    const reply =
      (completion.choices?.[0]?.message?.content || "").trim() ||
      "একটু সমস্যা হয়েছে 😔 আবার বলুন।";

    return reply;
  } catch (err) {
    console.error("Groq API error:", err?.message || err);
    if (err?.message && (err.message.includes("Invalid API Key") || err.message.includes("401"))) {
      return "হ্যালো! আমি শ্রেয়া 💜 (নোট: প্রদত্ত GROQ_API_KEY ভ্যালিড নয়, অনুগ্রহ করে Settings থেকে সঠিক কী সেট করুন। সার্ভিস সংক্রান্ত আলোচনার জন্য টেলিগ্রামে মেসেজ দিন: https://t.me/ShreyaGhosh69)";
    }
    return "একটু সমস্যা হয়েছে 😔 টেলিগ্রামে মেসেজ দিন: https://t.me/ShreyaGhosh69";
  }
}

module.exports = {
  generateReply,
  SYSTEM_PROMPT: currentSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  getSystemPrompt,
  setSystemPrompt,
  resetSystemPrompt,
  isGlobalAiEnabled,
  setGlobalAiEnabled,
};