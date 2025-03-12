const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy for PVGIS API
  app.use(
    '/pvgis',
    createProxyMiddleware({
      target: 'https://re.jrc.ec.europa.eu',
      changeOrigin: true,
      pathRewrite: {
        '^/pvgis': '/api/v5_3'
      }
    })
  );
  
  // Proxy for Renewable Ninja API
  app.use(
    '/ninja',
    createProxyMiddleware({
      target: 'https://www.renewables.ninja',
      changeOrigin: true,
      pathRewrite: {
        '^/ninja': '/api/data'
      }
    })
  );
};