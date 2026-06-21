import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { logger } from '../core/logger';
import { config } from '../core/config';
import { AgentOrchestrator } from '../core/agent-orchestrator';

export class DashboardServer {
  private app: express.Express;
  private server: http.Server;
  private wss: WebSocketServer;
  private orchestrator: AgentOrchestrator;
  private clients: Set<WebSocket> = new Set();

  constructor(orchestrator: AgentOrchestrator) {
    this.orchestrator = orchestrator;
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Create WebSocket server on top of HTTP server or separate port
    // We can use the same server to simplify deployment
    this.wss = new WebSocketServer({ noServer: true });

    this.setupRoutes();
    this.setupWebSockets();
  }

  /**
   * Configure Express routes and static files
   */
  private setupRoutes(): void {
    // Serve dashboard static assets
    this.app.use(express.static(path.join(__dirname, '..', '..', 'public')));

    // API endpoints
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        uptime: process.uptime(),
        mode: config.agentMode,
        timestamp: new Date().toISOString()
      });
    });

    this.app.get('/api/stats', async (req, res) => {
      try {
        const data = await this.orchestrator.getDashboardData();
        res.json(data);
      } catch (error: any) {
        logger.error(`Error fetching dashboard stats: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });

    // Verifiable track record (ERC-8004 reputation backbone).
    // Anyone can recompute the hash chain from this and check it against the on-chain anchor.
    this.app.get('/api/proof', (req, res) => {
      res.json(this.orchestrator.getProof());
    });

    // Alpha-as-a-Service: LILA's intelligence behind an x402 paywall.
    // No X-PAYMENT header -> 402 with payment requirements; valid payment -> 200 + alpha.
    this.app.get('/skill/market-read', async (req, res) => {
      const resourcePath = '/skill/market-read';

      if (!this.orchestrator.isSellEnabled()) {
        res.status(404).json({ error: 'Alpha-as-a-Service is disabled.' });
        return;
      }

      const paymentHeader = req.header('X-PAYMENT');
      if (!paymentHeader) {
        const { status, body } = this.orchestrator.buildAlphaPaymentRequired(resourcePath);
        res.status(status).json(body);
        return;
      }

      try {
        const settlement = await this.orchestrator.settleAlphaPayment(paymentHeader, resourcePath);
        if (!settlement.ok) {
          res.status(402).json({ x402Version: 1, error: settlement.error || 'Payment verification failed.' });
          return;
        }
        res.setHeader('X-PAYMENT-RESPONSE', Buffer.from(JSON.stringify({
          success: true,
          transaction: settlement.txHash,
          network: settlement.network,
          payer: settlement.payer
        })).toString('base64'));
        res.json({
          x402Version: 1,
          paid: true,
          settlement,
          data: this.orchestrator.getAlphaForSale()
        });
      } catch (error: any) {
        logger.error(`Error serving paid alpha: ${error.message}`);
        res.status(500).json({ error: error.message });
      }
    });

    // Fallback to index.html for SPA routing
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'));
    });
  }

  /**
   * Set up WebSocket connection handling
   */
  private setupWebSockets(): void {
    // Integrate upgrade handler
    this.server.on('upgrade', (request, socket, head) => {
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.wss.on('connection', async (ws) => {
      logger.info('Dashboard WebSocket client connected.');
      this.clients.add(ws);

      // Send initial data to client on connect
      try {
        const initialData = await this.orchestrator.getDashboardData();
        ws.send(JSON.stringify({ type: 'INIT', data: initialData }));
      } catch (error: any) {
        logger.error(`Error sending initial WS data: ${error.message}`);
      }

      ws.on('close', () => {
        logger.info('Dashboard WebSocket client disconnected.');
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        logger.error(`WebSocket client error: ${err.message}`);
      });
    });
  }

  /**
   * Broadcast an update message to all connected clients
   */
  public broadcast(data: any): void {
    const message = JSON.stringify({ type: 'UPDATE', data });
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  /**
   * Start the dashboard server
   */
  public start(): Promise<void> {
    return new Promise((resolve) => {
      const port = config.port || 3000;
      this.server.listen(port, () => {
        logger.info(`Dashboard server running at http://localhost:${port}`);
        resolve();
      });
    });
  }
}
