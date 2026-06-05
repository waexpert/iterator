const https = require("https");
const http = require("http");

const DELAY_MS = parseInt(process.env.DELAY_MS || "500", 10);

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
      },
    };

    const req = lib.request(options, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode }));
    });

    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Timed out after 10s"));
    });
    req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const { webhookUrl, items } = req.body;

  if (!webhookUrl || typeof webhookUrl !== "string") {
    return res.status(400).json({ error: "Missing 'webhookUrl'" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "'items' must be a non-empty array" });
  }

  const results = [];

  for (let i = 0; i < items.length; i++) {
    try {
      const result = await postItem(webhookUrl, items[i], i);
      results.push({ index: i, status: result.status, ok: result.status < 400 });
      console.log(`[${i + 1}/${items.length}] HTTP ${result.status}`);
    } catch (err) {
      results.push({ index: i, error: err.message, ok: false });
      console.error(`[${i + 1}/${items.length}] ERROR: ${err.message}`);
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