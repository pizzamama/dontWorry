exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { worry } = JSON.parse(event.body || "{}");

  if (!worry || worry.trim().length < 3) {
    return { statusCode: 400, body: JSON.stringify({ error: "Worry too short" }) };
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 60,
      system: `You write a single worry phrase for a compassionate website that reminds people they are not alone.

Complete this sentence fragment: "Right now, someone from [city] is worried about ___."

Rules:
- Output ONLY the worry phrase that fills the blank — nothing else, no quotes, no punctuation at the end.
- Generate a worry that is UNRELATED to the user's worry. It belongs to a completely different, anonymous person.
- It should feel like something a real person genuinely carries — tender and human.
- Examples: "whether their mother remembers them", "making rent this month", "a friendship that's gone quiet", "not being enough".
- Lowercase only. No period.`,
      messages: [{ role: "user", content: `User's own worry (do not mirror this): "${worry.slice(0, 500)}"` }],
    }),
  });

  const data = await response.json();
  const phrase = data.content?.[0]?.text?.trim() || "the weight of things left unsaid";

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phrase }),
  };
};
