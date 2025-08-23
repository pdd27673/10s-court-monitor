/**
 * Court Scraper Service
 * Main entry point for the scraping service
 */

console.log('🔍 Court Scraper Service starting...');

// Basic health check endpoint for Railway deployment
const PORT = process.env.PORT || 3001;

// Simple HTTP server for health checks
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'healthy', 
      service: 'court-scraper',
      timestamp: new Date().toISOString() 
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`🚀 Scraper service health endpoint running on port ${PORT}`);
  console.log(`📊 Health check available at: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('💀 Received SIGTERM, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Process terminated');
    process.exit(0);
  });
});
