// Vercel serverless: /api/ads-agent-llm
// Tek endpoint – "mode": "negatives" | "rsa"
// Env: OPENAI_API_KEY, optional INTERNAL_BEARER

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({error:"Method not allowed"});
    const auth = process.env.INTERNAL_BEARER;
    if (auth) {
      const hdr = req.headers.authorization || "";
      if (!hdr.startsWith("Bearer ") || hdr.slice(7) !== auth) {
        return res.status(401).json({error:"Unauthorized"});
      }
    }

    const body = req.body || {};
    const mode = body.mode;

    if (mode === "negatives") {
      const result = await negativesFlow(body);
      return res.status(200).json(result);
    } else if (mode === "rsa") {
      const result = await rsaFlow(body);
      return res.status(200).json(result);
    } else {
      return res.status(400).json({error:"Unknown mode"});
    }
  } catch (e) {
    return res.status(500).json({error: e.message});
  }
}

// ---- OpenAI helper ----
async function chatJSON(system, user) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini", // hafif ve hızlı; dilersen gpt-4.1/4o seçersin
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}`);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content || "{}";
  return JSON.parse(text);
}

// ---- negativesFlow ----
async function negativesFlow(body) {
  const brand = (body.brandProtected || body.brandTermsProtected || body.brandProtected) || "";
  const alwaysNeg = body.alwaysNeg || "";
  const data = body.data || {};
  const searchTerms = data.searchTerms || [];

  const system = `You are a senior Google Ads strategist. Output strict JSON: {"negatives":[...], "themes":[...]}`;
  const user = `
Kurallar:
- Marka terimlerini önermE (brandProtected: ${brand}).
- "alwaysNeg" ifadesiyle eşleşenleri kesinlikle öner.
- Sıfır dönüşüm + yüksek maliyet/tıklama ve/veya çok düşük CTR'ları NEGATIVE öner.
- Her öneri için: { "campaignId": "...", "adGroupId":"...", "term":"...", "match":"PHRASE|EXACT", "reason":"..." }
- Ayrıca "themes": [{"name":"...", "examples":["..."], "insight":"..."}] döndür.
Veri örnekleri (son 300 satır):
${JSON.stringify(searchTerms).slice(0, 15000)}
`;
  const out = await chatJSON(system, user);
  return {
    negatives: Array.isArray(out.negatives) ? out.negatives.slice(0, 200) : [],
    themes: Array.isArray(out.themes) ? out.themes.slice(0, 50) : []
  };
}

// ---- rsaFlow ----
async function rsaFlow(body) {
  const data = body.data || {};
  const urls = data.landingUrls || [];
  const usps = data.usps || [];
  const brand = data.brand || "Marka";

  const system = `You write high-performing Responsive Search Ads (Turkish). Output JSON strictly.`;
  const user = `
Marka: ${brand}
USP'ler: ${usps.join(" | ")}
Landing URL'ler: ${urls.join(", ")}

Her URL için JSON nesnesi üret:
{
  "url":"...",
  "theme":"...", 
  "headlines":["<=30 karakter", ... (10 adet)],
  "descriptions":["<=90 karakter", ... (4 adet)],
  "pinHints":"(opsiyonel) H1/H2 pin önerileri"
}
Yanıt: {"items":[...]}
`;

  const out = await chatJSON(system, user);
  return {
    items: Array.isArray(out.items) ? out.items.map(trimRSAItem).slice(0, 30) : []
  };
}

function trimRSAItem(x) {
  const h = (x.headlines||[]).map(s => s?.toString().slice(0, 30));
  const d = (x.descriptions||[]).map(s => s?.toString().slice(0, 90));
  return {
    url: x.url || "",
    theme: x.theme || "",
    headlines: h.slice(0, 10),
    descriptions: d.slice(0, 4),
    pinHints: x.pinHints || ""
  };
}
