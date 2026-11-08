const { createProxyMiddleware } = require('http-proxy-middleware');

// The integrated `/games/` build is copied into the main site at production
// time. In development, forward that same path to the nested Vite app so the
// Games tab is usable while the CRA site remains on localhost:3000.
module.exports = function setupProxy(app) {
  app.use('/games', createProxyMiddleware({
    target: process.env.GAMES_DEV_SERVER || 'http://127.0.0.1:3001',
    changeOrigin: true,
    ws: true,
  }));
};
