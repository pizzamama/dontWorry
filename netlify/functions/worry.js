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

  // Get client IP
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

  // Find a real worry from another user
  if (REDIS_AVAILABLE) {
    try {
      const range = await redisSingle('LRANGE', 'worries', '0', '99');
      const items = Array.isArray(range) ? range : [];

      const candidates = items
        .map(s => { try { return JSON.parse(s); } catch { return null; } })
        .filter(w => w && w.text && w.text !== worry);

      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        const location = [pick.city, pick.country].filter(Boolean).join(', ') || 'somewhere in the world';
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phrase: pick.text, location, source: 'real' }),
        };
      }
    } catch {
      // Fall through to 'none'
    }
  }

  // No real worries available yet
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phrase: null, location: null, source: 'none' }),
  };
};
