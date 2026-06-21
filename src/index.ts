import { logger } from './core/logger';
import { config } from './core/config';
import { AgentOrchestrator } from './core/agent-orchestrator';
import { DashboardServer } from './dashboard/server';
import { runRegistrationFlow } from './competition/register';

async function bootstrap() {
  logger.info('====================================================');
  logger.info('      LILA - Autonomous News Impact Trading Agent     ');
  logger.info('                Website: lilagent.xyz               ');
  logger.info('====================================================');

  try {
    // 1. Run Registration Flow (Wallet setup, competition, ERC-8004)
    logger.info('Running agent setup and registration check...');
    await runRegistrationFlow();

    // 2. Initialize orchestrator
    const orchestrator = new AgentOrchestrator();

    // 3. Initialize dashboard server
    const server = new DashboardServer(orchestrator);

    // 4. Wire orchestrator updates to broadcast via dashboard server
    orchestrator.onUpdate((data) => {
      server.broadcast(data);
    });

    // 5. Start servers
    await server.start();
    await orchestrator.start();

    logger.info('LILA Agent is fully operational and monitoring markets.');

    // Handle graceful shutdown
    const shutdown = async () => {
      logger.info('Shutdown signal received. Stopping orchestrator...');
      await orchestrator.stop();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error: any) {
    logger.error(`Fatal error during LILA agent bootstrap: ${error.message}`);
    process.exit(1);
  }
}

bootstrap();
