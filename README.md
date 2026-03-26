# You're Not Alone

A minimal, compassionate website where users share an anonymous worry and receive a gentle reminder that someone else in the world is carrying something too.

---

## Project structure

```
youre-not-alone/
├── index.html                  # The full frontend
├── netlify.toml                # Netlify build config
├── netlify/
│   └── functions/
│       └── worry.js            # Serverless proxy for the Anthropic API
└── README.md
```

---

## Deploy to Netlify

### 1. Get an Anthropic API key
Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key.

### 2. Push to GitHub
Create a new GitHub repo and push this folder to it.

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/youre-not-alone.git
git push -u origin main
```

### 3. Connect to Netlify
1. Go to [netlify.com](https://netlify.com) and log in
2. Click **"Add new site" → "Import an existing project"**
3. Connect your GitHub repo
4. Build settings are already handled by `netlify.toml` — just click **Deploy**

### 4. Add your API key as an environment variable
In your Netlify dashboard:
1. Go to **Site configuration → Environment variables**
2. Click **Add a variable**
3. Set the key to `ANTHROPIC_API_KEY` and paste your key as the value
4. Click **Save**, then **Trigger a redeploy**

That's it — your site is live and the API key is safely server-side.

---

## How it works

- **`index.html`** handles all UI, theming (auto dark mode between 9pm–6am), and IP geolocation via `ipapi.co`
- **`netlify/functions/worry.js`** receives the user's worry, calls the Anthropic API with your secret key, and returns a generated worry phrase belonging to a different, anonymous person
- The user's worry is never stored — each request is stateless

---

## Optional: Set a spend limit
In the [Anthropic Console](https://console.anthropic.com), you can set a monthly spend cap to avoid unexpected costs. Each submission costs roughly $0.0006, so $5/month covers ~8,000 submissions.
