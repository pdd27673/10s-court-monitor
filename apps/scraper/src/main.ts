/**
 * Court Scraper Service
 * Main entry point for the scraping service
 */

import * as http from 'http';
import { IncomingMessage, ServerResponse } from 'http';

console.log('🔍 Court Scraper Service starting...');

// Basic health check endpoint for Railway deployment
const PORT: number = parseInt(process.env.PORT || '3001', 10);

interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
}

// Simple HTTP server for health checks
const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const healthResponse: HealthResponse = { 
      status: 'healthy', 
      service: 'court-scraper',
      timestamp: new Date().toISOString() 
    };
    res.end(JSON.stringify(healthResponse));
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
