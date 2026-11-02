# Portfolio Chatbot

A reusable, drop-in AI chat widget for portfolio websites. Visitors ask questions, and the assistant answers directly from **your resume** (Word `.docx`, PDF `.pdf`, plain text `.txt`, or Markdown `.md`).

- **Front end:** One single `<script>` tag. No frameworks, zero external dependencies, no build steps. Works on any HTML page, React, Vue, Next.js, Astro, Hugo, or WordPress site.
- **Back end:** Drop your resume into the `resume/` folder, choose your AI provider, and run `npm start`.
- **Multi-AI Support:** Works with **Anthropic Claude**, **NVIDIA NIM** (Free 1,000 credits), **Google Gemini** (Free tier), **Groq Cloud** (Free tier), **Ollama** (100% Free / Local), **OpenAI**, **OpenRouter**, **DeepSeek**, and **Mistral AI**.

---

## Supported AI Providers

You can switch between any AI provider simply by setting `AI_PROVIDER` and its API key in `.env`:

| Provider | `AI_PROVIDER` | Free / Budget Option? | Default Recommended Model | Where to get Key |
|---|---|---|---|---|
| **NVIDIA NIM** | `nvidia` | **Free (1,000 credits)** | `meta/llama-3.3-70b-instruct` | [build.nvidia.com](https://build.nvidia.com) |
| **Google Gemini** | `gemini` | **Free Tier** | `gemini-1.5-flash` | [aistudio.google.com](https://aistudio.google.com) |
| **Groq Cloud** | `groq` | **Free Tier** (Ultra-fast) | `llama-3.3-70b-versatile` | [console.groq.com](https://console.groq.com) |
| **Ollama (Local)** | `ollama` | **100% Free & Offline** | `llama3.2` | [ollama.com](https://ollama.com) |
| **Anthropic Claude** | `claude` | Paid / Trial credits | `claude-3-5-haiku-20241022` | [console.anthropic.com](https://console.anthropic.com) |
| **OpenAI** | `openai` | Paid / Low-cost | `gpt-4o-mini` | [platform.openai.com](https://platform.openai.com) |
| **OpenRouter** | `openrouter` | Free models available | `meta-llama/llama-3.3-70b-instruct:free` | [openrouter.ai](https://openrouter.ai) |
| **DeepSeek** | `deepseek` | Extremely low cost | `deepseek-chat` | [platform.deepseek.com](https://platform.deepseek.com) |
| **Mistral AI** | `mistral` | Free tier / Paid | `mistral-small-latest` | [console.mistral.ai](https://console.mistral.ai) |

---

## Quick Setup (3 Minutes)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (`.env`)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Pick your preferred AI tool:

- **Using NVIDIA NIM (Free 1,000 Credits):**
  ```env
  AI_PROVIDER=nvidia
  NVIDIA_API_KEY=nvapi-your-key-here
  ```

- **Using Google Gemini (Free Tier):**
  ```env
  AI_PROVIDER=gemini
  GEMINI_API_KEY=AIzaSy...your-key-here
  ```

- **Using Groq (Free Tier & Fast):**
  ```env
  AI_PROVIDER=groq
  GROQ_API_KEY=gsk_...your-key-here
  ```

- **Using Ollama (100% Free / Local / No API Key):**
  ```bash
  ollama run llama3.2
  ```
  ```env
  AI_PROVIDER=ollama
  ```

- **Using Anthropic Claude:**
  ```env
  AI_PROVIDER=claude
  ANTHROPIC_API_KEY=sk-ant-...
  ```

- **Using OpenAI:**
  ```env
  AI_PROVIDER=openai
  OPENAI_API_KEY=sk-proj-...
  ```

### 3. Add Your Resume
Place your resume file (`.docx`, `.pdf`, `.txt`, or `.md`) inside the `resume/` directory.
*(The included `sample-resume.md` is automatically ignored as soon as you add your own file!)*

### 4. Start the Server
```bash
npm start
```
Open **http://localhost:3000/demo.html** to test the widget!

---

## How the Code Works

Every file in this project is documented with detailed, beginner-friendly comments:

### 1. `server.js` (Backend)
- **Resume Reader & Auto-Cache:** Scans `./resume` using `mammoth` (for `.docx`), `pdf-parse` (for `.pdf`), and UTF-8 reader (for `.txt`/`.md`). Files are cached in memory using a file-modification timestamp hash (`mtimeMs`). Updating or replacing a resume in `./resume` automatically refreshes the cache without restarting the server!
- **Auto Name Detection:** Automatically extracts the candidate's name from the first heading of the resume or from `OWNER_NAME` in `.env`.
- **System Prompt Engineering:** Grounds the AI using strict `<resume>...</resume>` data tags, enforces third-person answers under 120 words, instructs the AI to decline out-of-scope questions, and includes anti-jailbreak defenses.
- **Unified Multi-Provider Dispatcher:** Routes chat requests to NVIDIA NIM, Gemini, Groq, Claude, OpenAI, Ollama, etc., with error handling and fallback logic.
- **Standalone Reference Code Blocks:** Includes clear, self-contained functions (`callNvidiaNIM`, `callGoogleGemini`, `callGroq`, `callOllamaLocal`, `callOpenAI`, `callAnthropicClaude`) demonstrating how each AI API is invoked.

### 2. `public/chatbot.js` (Frontend Widget)
- **Shadow DOM Isolation:** Encapsulates styles and HTML inside a Shadow Root so your website's CSS (Bootstrap, Tailwind, custom fonts) cannot break the chatbot layout, and chatbot styles cannot alter your site.
- **Accessibility & UX:** Includes ARIA roles, auto-resizing textarea up to 96px, keyboard shortcuts (Enter to send, Shift+Enter for new line, Escape to close), and animated typing indicators.
- **XSS-Safe Markdown Renderer:** Strictly escapes HTML entities first (`&`, `<`, `>`) to prevent injection vulnerabilities, then renders bold (`**text**`), inline code (`` `code` ``), safe external links (`[title](url)`), and bullet points (`- `).
- **Session Memory:** Stores the conversation in `sessionStorage` so visitors can navigate between different pages on your portfolio without losing their chat history.

---

## Add the Chatbot to Your Portfolio

Paste this single line right before `</body>` on any page:

```html
<script src="https://YOUR-SERVER-URL/chatbot.js" defer></script>
```

### Optional Styling Attributes

Customize the look and behavior by adding attributes to the `<script>` tag:

```html
<script src="https://YOUR-SERVER-URL/chatbot.js" defer
  data-accent="#0f766e"
  data-position="left"
  data-theme="auto"
  data-label="Ask about my work"></script>
```

| Attribute | Description | Options | Default |
|---|---|---|---|
| `data-accent` | Button and user message bubble color | Any CSS color (`#3b5bdb`, `#0f766e`, `teal`) | `#3b5bdb` |
| `data-position` | Corner of the screen | `right`, `left` | `right` |
| `data-theme` | Visual color theme | `auto`, `light`, `dark` | `auto` (matches visitor's OS) |
| `data-label` | Launcher button label | Any string | `"Ask about {name}"` |
| `data-api` | Custom API server URL | Full URL | Origin of the script |

---

## Configuration Reference (`.env`)

| Variable | Description |
|---|---|
| `AI_PROVIDER` | `nvidia`, `gemini`, `groq`, `ollama`, `claude`, `openai`, `openrouter`, `deepseek`, `mistral` |
| `AI_MODEL` | Custom model name (overrides default) |
| `NVIDIA_API_KEY` | Key for NVIDIA NIM developer tier |
| `GEMINI_API_KEY` | Key for Google Gemini (Google AI Studio) |
| `GROQ_API_KEY` | Key for Groq Cloud |
| `OLLAMA_BASE_URL` | Base URL for local Ollama (default: `http://localhost:11434`) |
| `ANTHROPIC_API_KEY`| Key for Anthropic Claude |
| `OPENAI_API_KEY` | Key for OpenAI ChatGPT |
| `PORT` | Web server port (default: `3000`) |
| `OWNER_NAME` | Portfolio owner's name (defaults to first line of resume) |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed domains (e.g. `https://yourname.dev`) |
| `MAX_DAILY_REQUESTS`| Global daily cap on chat requests to protect your API bill (default: `500`) |
| `EXTRA_INSTRUCTIONS`| Additional custom instructions (e.g. `"Mention that I am available for freelance."`) |
| `SUGGESTIONS` | Starter question chips separated by `\|` |
| `TRUST_PROXY` | Set to `1` when hosting behind reverse proxies (Render, Railway, Fly.io, Nginx) |

---

## Built-in Security & Safeguards

- **No Exposed API Keys:** Keys stay on your server and are never sent to the browser.
- **Rate Limiting:** Protects against spam by limiting each visitor IP to 20 messages per minute.
- **Daily Budget Cap:** `MAX_DAILY_REQUESTS` prevents billing spikes if a bot attacks your site.
- **Input Sanitization:** Strips invalid roles, caps message lengths to 1,000 characters, and limits chat context to a 12-turn sliding window.
- **Context Grounding & Anti-Jailbreak:** Instructs the LLM to only answer from within `<resume>` tags and ignore prompt injection attempts.
- **Strict HTML Escaping:** Eliminates Cross-Site Scripting (XSS) risks before formatting Markdown.

---

## License

MIT
