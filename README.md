# Shreya — Facebook Page Auto-Reply Bot 💜

Facebook Page-এ কেউ Messenger-এ মেসেজ দিলে বা post-এ comment করলে AI (Groq) স্বয়ংক্রিয়ভাবে শ্রেয়ার স্টাইলে reply দেয়। MongoDB-তে প্রতিটা ইউজারের কথা আলাদা করে সেভ হয়, তাই AI আগের কথা মনে রাখে।

---

## ✨ Features

- 🤖 Messenger-এ auto-reply (Groq LLM)
- 💬 Post comment-এ auto-reply
- 🧠 প্রতিটা Facebook user-এর জন্য আলাদা conversation memory (MongoDB)
- 🔐 API key সার্ভার সাইডে, ব্রাউজারে কখনো যায় না
- ✅ Webhook signature verification (নিরাপত্তা)
- 🚀 Render-এ এক ক্লিকে deploy
- 🧪 লোকাল টেস্ট UI (`/` route)

---

## 📋 যা যা লাগবে

| জিনিস | কোথায় পাবে |
|---|---|
| Node.js 20+ | https://nodejs.org |
| MongoDB Atlas (free) | https://www.mongodb.com/cloud/atlas |
| Groq API key | https://console.groq.com/keys |
| Facebook Page (তোমার নিজের) | — |
| Facebook Developer App | https://developers.facebook.com |

---

## 🛠️ Local Setup

### ১) প্রজেক্ট সেটআপ

```bash
git clone https://github.com/YOUR_USERNAME/shreya-fb-bot.git
cd shreya-fb-bot
npm install
cp .env.example .env
```

### ২) MongoDB Atlas

1. Free cluster (M0) বানাও
2. Database user তৈরি করো
3. Network Access → `0.0.0.0/0` allow
4. Connection string কপি করে `.env`-এ বসাও, শেষে `/shreya_chat` যোগ করো

### ৩) Groq key

https://console.groq.com/keys → Create key → `.env`-এ `GROQ_API_KEY`-এ বসাও

### ৪) Facebook App + Page Token

1. https://developers.facebook.com/apps → **Create App** → **Business** টাইপ
2. App Dashboard → **Add Product** → **Messenger** যোগ করো
3. Messenger → Settings → **Access Tokens** → তোমার page সিলেক্ট করে **Generate Token** ক্লিক করো
   - Permissions দরকার: `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_manage_engagement` (comments reply-এর জন্য)
4. টোকেন কপি করো → `.env`-এ `FB_PAGE_ACCESS_TOKEN`
5. App → Settings → Basic → **App Secret** কপি → `.env`-এ `FB_APP_SECRET`
6. `.env`-এ `FB_VERIFY_TOKEN` = যা খুশি একটা random string (যেমন `shreya_verify_9f8a7b6c5d`)

### ৫) লোকালি চালাও

```bash
npm run dev
```

খোলো: http://localhost:3000 (টেস্ট চ্যাট UI)

---

## 🚀 Render-এ Deploy

### ১) GitHub-এ push

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/shreya-fb-bot.git
git push -u origin main
```

> ⚠️ `.env` কখনো push করবে না — `.gitignore`-তে already আছে।

### ২) Render-এ Web Service

1. https://render.com → sign up with GitHub
2. **New +** → **Web Service** → তোমার repo সিলেক্ট করো
3. সেটিংস:
   - **Name**: `shreya-fb-bot`
   - **Region**: Singapore
   - **Runtime**: Node
   - **Build**: `npm install`
   - **Start**: `npm start`
   - **Plan**: Free

### ৩) Environment Variables (Render Dashboard → Environment)

| Key | Value |
|---|---|
| `MONGODB_URI` | তোমার Atlas string |
| `GROQ_API_KEY` | তোমার Groq key |
| `FB_PAGE_ACCESS_TOKEN` | Page token |
| `FB_VERIFY_TOKEN` | তোমার বানানো string |
| `FB_APP_SECRET` | App secret |
| `MODEL` | `openai/gpt-oss-120b` |
| `MAX_HISTORY` | `30` |

### ৪) Deploy

**Create Web Service** ক্লিক করো। ২-৩ মিনিটে deploy হবে। তোমার URL হবে:
```
https://shreya-fb-bot.onrender.com
```

---

## 🔗 Facebook Webhook কানেক্ট করা

### ১) Webhook URL সেট করো

1. Facebook App → **Messenger** → **Settings**
2. **Webhooks** সেকশনে → **Add Callback URL**
3. দাও:
   - **Callback URL**: `https://shreya-fb-bot.onrender.com/webhook`
   - **Verify Token**: তোমার `.env`-এ যেই `FB_VERIFY_TOKEN` দিয়েছ, হুবহু সেটাই
4. **Verify and Save** ক্লিক করো — সব ঠিক থাকলে "verified" দেখাবে

> যদি verify fail করে: Render-এ server চালু আছে কিনা, `FB_VERIFY_TOKEN` মিলছে কিনা চেক করো।

### ২) Webhook Fields সাবস্ক্রাইব করো

**Webhooks** এর নিচে **Add Subscriptions**:
- ✅ `messages` (Messenger-এর জন্য অবশ্যই)
- ✅ `messaging_postbacks` (বাটন ক্লিক)
- ✅ `feed` (comment auto-reply চাইলে)

### ৩) Page সাবস্ক্রাইব করো

Messenger → Settings → **Subscribed Pages** → তোমার page সিলেক্ট করে **Subscribe** করো।

### ৪) টেস্ট করো

তোমার page-এ নিজের Facebook অ্যাকাউন্ট থেকে (বা অন্য কারো) একটা message পাঠাও — যেমন "কাজ করতে চাই"। কয়েক সেকেন্ডে reply আসবে।

---

## 🔌 API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/webhook` | Facebook verification |
| `POST` | `/webhook` | Facebook events (messages + comments) |
| `GET` | `/api/health` | Server status |
| `POST` | `/api/session` | টেস্ট chat session |
| `GET` | `/api/history/:sessionId` | টেস্ট chat history |
| `POST` | `/api/chat` | টেস্ট chat reply |

---

## 🗄️ MongoDB-তে কীভাবে সেভ হয়

**`sessions` collection:**
```json
{
  "platform": "facebook",
  "externalId": "1234567890",          // Facebook PSID
  "sessionId": "facebook:1234567890",
  "displayName": "Karim",
  "lastActive": "2026-01-01T10:00:00Z"
}
```

**`messages` collection:**
```json
{
  "sessionId": "facebook:1234567890",
  "role": "user",
  "content": "কাজ করতে চাই",
  "source": "messenger",
  "createdAt": "2026-01-01T10:00:01Z"
}
```

প্রতিটা Facebook user-এর PSID আলাদা, তাই প্রতি ইউজারের কথা আলাদা জায়গায় সেভ হয় — একজনের কথা অন্যের কাছে যায় না।

---

## 🐛 Troubleshooting

**Webhook verify fail**
- Render-এ app চালু আছে কিনা দেখো
- `FB_VERIFY_TOKEN` হুবহু মিলছে কিনা

**Message পাঠালে reply আসছে না**
- Render logs দেখো (Dashboard → Logs)
- Page Token expire হয়ে গেলে নতুন নাও
- Page-এ app subscribe করা আছে কিনা চেক করো

**"Invalid signature" error**
- `FB_APP_SECRET` সঠিক কিনা দেখো

**"HTTP 401" (Groq)**
- Groq key revoke হয়েছে → নতুন নাও

**Comment-এ reply আসছে না**
- `feed` subscription যোগ করা আছে কিনা দেখো
- `pages_manage_engagement` permission আছে কিনা চেক করো

**Render Free plan-এ প্রথমে slow**
- ১৫ মিনিট inactivity-তে server sleep করে। প্রথম request-এ ৩০-৬০ সেকেন্ড লাগতে পারে।

---

## 🔒 Security

- `.env` কখনো commit করবে না
- সব token Render-এর env var-এ রাখো
- Facebook webhook signature verification বন্ধ করো না (`FB_APP_SECRET` always set করো)
- Production-এ rate limit যোগ করা ভালো (`express-rate-limit`)

---

## 📜 License

MIT