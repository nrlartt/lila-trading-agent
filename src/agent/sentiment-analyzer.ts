import { logger } from '../core/logger';
import { config } from '../core/config';
import { DailyMarketOverviewData } from '../services/cmc/types';
import { MarketSentiment } from './types';
import { isEligible } from '../config/eligible-tokens';

export class SentimentAnalyzer {
  /**
   * Analyze market data and news using Groq LLM to determine sentiment scores
   */
  public async analyze(marketData: DailyMarketOverviewData): Promise<MarketSentiment> {
    if (!config.groqApiKey || config.groqApiKey === 'demo_groq_key') {
      logger.warn('GROQ_API_KEY is not set or is demo key. Generating offline sentiment analysis.');
      return this.generateOfflineSentiment(marketData);
    }

    try {
      logger.info('Querying Groq LLM for market sentiment analysis...');
      
      const systemPrompt = `You are LILA, an expert AI crypto trading agent. 
Analyze the provided CoinMarketCap Daily Market Overview JSON and extract structured sentiment scores.
You must return a valid JSON object matching the following structure:
{
  "overallScore": 0.5, // Float between -1.0 (extremely bearish) and 1.0 (extremely bullish)
  "narrativeSummary": "Short explanation of the dominant market narratives.",
  "tokens": [
    {
      "symbol": "BTC",
      "score": 0.8, // Float between -1.0 and 1.0
      "impact": 0.9, // Float between 0.0 (no impact) and 1.0 (extremely high impact)
      "rationale": "Why this token is bullish or bearish based on the data."
    }
  ]
}
Note: Ensure you ONLY rate tokens that are relevant to the watchlist and candidate queues.
Keep responses completely objective and factual.`;

      const userMessage = `Here is the current CoinMarketCap Daily Market Overview:
${JSON.stringify(marketData, null, 2)}`;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.groqModel || 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2
        })
      });

      if (!response.ok) {
        throw new Error(`Groq API returned HTTP ${response.status}: ${await response.text()}`);
      }

      const resData = (await response.json()) as any;
      const rawJson = resData.choices[0].message.content;
      const parsed = JSON.parse(rawJson.trim()) as MarketSentiment;

      // Ensure all returned tokens are in the eligible allowlist
      if (parsed.tokens && Array.isArray(parsed.tokens)) {
        parsed.tokens = parsed.tokens.filter(token => {
          const eligible = isEligible(token.symbol);
          if (!eligible) {
            logger.warn(`Sentiment analyzer returned ineligible token ${token.symbol}. Filtering out.`);
          }
          return eligible;
        });
      }

      logger.info(`Groq sentiment analysis complete. Overall Score: ${parsed.overallScore}`);
      return parsed;
    } catch (error: any) {
      logger.error(`Error in Groq sentiment analysis: ${error.message}. Falling back to offline sentiment.`);
      return this.generateOfflineSentiment(marketData);
    }
  }

  /**
   * Generates deterministic offline sentiment based on the CMC composite score and watchlist
   */
  private generateOfflineSentiment(marketData: DailyMarketOverviewData): MarketSentiment {
    const composite = marketData.market_read?.composite_score || 50;
    // Map composite score (0-100) to overall score (-1.0 to 1.0)
    const overallScore = (composite - 50) / 50;
    
    const tokens = (marketData.watchlist || [])
      .filter(w => isEligible(w.symbol))
      .map(w => {
        // Map confidence + score to a sentiment score
        let score = 0.0;
        if (w.confidence === 'high') score = 0.6;
        else if (w.confidence === 'medium') score = 0.3;
        
        if (marketData.trader_assessment?.risk_bias?.includes('defensive')) {
          score -= 0.2; // Apply defensive penalty
        }
        
        return {
          symbol: w.symbol,
          score: Math.max(-1, Math.min(1, score)),
          impact: w.score ? w.score / 100 : 0.5,
          rationale: w.thesis
        };
      });

    return {
      overallScore,
      narrativeSummary: marketData.summary || 'Consolidation phase. Selective trades only.',
      tokens
    };
  }
}
