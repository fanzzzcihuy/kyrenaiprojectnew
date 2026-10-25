module.exports = (req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, keyLoaded: Boolean(process.env.GROQ_API_KEY) }));
};
