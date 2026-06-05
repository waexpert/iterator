const https = require("https");
const http = require("http");
const crypto = require("crypto");

const SECRET_KEY = process.env.SECRET_KEY || "myS3cr3tKey!2026";
const DELAY_MS = parseInt(process.env.DELAY_MS || "500", 10);

// ─── Verify HMAC hash and return the URL if valid ────────────────────────────
function verifyAndExtractUrl(webhookUrl, hash) {
  const expected = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(webhookUrl)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  let receivedBuf;
  try {
    receivedBuf = Buffer.from(hash, "hex");
  } catch {
    return null;
  }

  if (
    expectedBuf.length !== receivedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return null;
  }
  return webhookUrl;
}

// ─── POST a single item to the target webhook ────────────────────────────────
function postItem(targetUrl, item, index) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ index, item });
    const parsedUrl = new URL(targetUrl);
    const isHttps = parsedUrl.protocol === "https:";
    const lib = isHttps ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "X-Sender": "automatisch-iterator",
      },
    };

    const req = lib.request(options, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timed out after 10s"));
    });
    req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Vercel handler ──────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed — use POST" });
  }

  const { webhookUrl, hash, items } = req.body;

  // ── Validate fields ────────────────────────────────────────────────────────
  if (!webhookUrl || typeof webhookUrl !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'webhookUrl'" });
  }
  if (!hash || typeof hash !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'hash'" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "'items' must be a non-empty array" });
  }

  // ── Verify HMAC ────────────────────────────────────────────────────────────
  const verifiedUrl = verifyAndExtractUrl(webhookUrl, hash);
  if (!verifiedUrl) {
    return res.status(401).json({
      error: "HMAC verification failed — hash does not match URL or wrong secret key",
    });
  }

  // ── Iterate and send each item ─────────────────────────────────────────────
  const results = [];

  for (let i = 0; i < items.length; i++) {
    try {
      const result = await postItem(verifiedUrl, items[i], i);
      results.push({ index: i, status: result.status, ok: result.status < 400 });
      console.log(`[${i + 1}/${items.length}] → HTTP ${result.status}`);
    } catch (err) {
      results.push({ index: i, error: err.message, ok: false });
      console.error(`[${i + 1}/${items.length}] → ERROR: ${err.message}`);
    }

    if (i < items.length - 1) await sleep(DELAY_MS);
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return res.status(200).json({
    message: "Done",
    total: items.length,
    succeeded,
    failed,
    results,
  });
};