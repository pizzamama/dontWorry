const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_AVAILABLE = !!(UPSTASH_URL && UPSTASH_TOKEN);

async function redisPipeline(commands) {
  const res = await fetch(`${UPSTASH_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  const json = await res.json();
  return json.map(r => r.result);
}

async function redisSingle(command, key, ...args) {
  const path = [command.toLowerCase(), encodeURIComponent(key), ...args].join('/');
  const res = await fetch(`${UPSTASH_URL}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  const json = await res.json();
  return json.result;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse and validate
  let worry;
  try {
    const parsed = JSON.parse(event.body || '{}');
    worry = parsed.worry;
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  if (!worry || worry.trim().length < 3) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Worry too short' }),
    };
  }

  worry = worry.trim().slice(0, 500);

  // Get client IP once
  const ip =
    event.headers['x-nf-client-connection-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown';

  // Rate limiting
  if (REDIS_AVAILABLE) {
    try {
      const count = parseInt(await redisSingle('INCR', `rate:${ip}`), 10);
      if (count === 1) {
        await redisSingle('EXPIRE', `rate:${ip}`, '600');
      }
      if (count > 5) {
        return {
          statusCode: 429,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Take a breath. You can share again in a few minutes.' }),
        };
      }
    } catch {
      // Rate limit check failed — allow through
    }
  }

  // Geolocate
  let geo = { city: '', country: '', lat: null, lng: null };
  try {
    const geoRes = await fetch(`https://ipapi.co/${ip}/json/`);
    const geoData = await geoRes.json();
    geo.city = geoData.city || '';
    geo.country = geoData.country_name || '';
    geo.lat = geoData.latitude || null;
    geo.lng = geoData.longitude || null;
  } catch {
    // geo stays empty
  }

  const timestamp = Date.now();

  // Store worry + heartbeat
  if (REDIS_AVAILABLE) {
    try {
      await redisPipeline([
        ['LPUSH', 'worries', JSON.stringify({ text: worry, city: geo.city, country: geo.country, lat: geo.lat, lng: geo.lng, timestamp })],
        ['LTRIM', 'worries', '0', '99'],
        ['LPUSH', 'heartbeats', JSON.stringify({ lat: geo.lat, lng: geo.lng, timestamp })],
        ['LTRIM', 'heartbeats', '0', '99'],
      ]);
    } catch {
      // Storage failed — continue to response
    }
  }

  // Try to return a real worry from another user
  let phrase, location, source;

  if (REDIS_AVAILABLE) {
    try {
      const [len, range] = await redisPipeline([
        ['LLEN', 'worries'],
        ['LRANGE', 'worries', '0', '99'],
      ]);

      if (parseInt(len, 10) >= 5) {
        const candidates = range
          .map(s => { try { return JSON.parse(s); } catch { return null; } })
          .filter(w => w && w.text && w.text !== worry);

        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          phrase = pick.text;
          location = [pick.city, pick.country].filter(Boolean).join(', ') || 'somewhere in the world';
          source = 'real';
        }
      }
    } catch {
      // Fall through to AI
    }
  }

  // AI fallback
  if (!phrase) {
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 60,
          system: `You write a single worry phrase for a compassionate website that reminds people they are not alone.

Complete this sentence fragment: "Right now, someone from [city] is worried about ___."

Rules:
- Output ONLY the worry phrase that fills the blank — nothing else, no quotes, no punctuation at the end.
- Generate a worry that is UNRELATED to the user's worry. It belongs to a completely different, anonymous person.
- It should feel like something a real person genuinely carries — tender and human.
- Examples: "whether their mother remembers them", "making rent this month", "a friendship that's gone quiet", "not being enough".
- Lowercase only. No period.`,
          messages: [{ role: 'user', content: `User's own worry (do not mirror this): "${worry.slice(0, 500)}"` }],
        }),
      });
      const aiData = await aiRes.json();
      phrase = aiData.content?.[0]?.text?.trim() || 'the weight of things left unsaid';
    } catch {
      phrase = 'the weight of things left unsaid';
    }
    location = [geo.city, geo.country].filter(Boolean).join(', ') || 'somewhere in the world';
    source = 'ai';
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phrase, location, source }),
  };
};
