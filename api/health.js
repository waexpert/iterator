module.exports = function handler(req, res) {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    endpoints: ["POST /api/send", "GET /api/health"],
  });
};