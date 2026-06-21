export interface MarketRiskBudget {
  stance: string;
  max_position_pct: number;
  leverage: string;
  not_for: string;
}

export interface MarketRead {
  regime: string;
  primary_driver: string;
  risk_bias: string;
  macro_regime: string;
  composite_score: number;
  risk_budget: MarketRiskBudget;
  primary_conflicts: string[];
  confirmation_triggers: string[];
  invalidation_triggers: string[];
}

export interface WatchlistCandidate {
  symbol: string;
  source_lane?: string;
  confidence: string;
  score: number;
  thesis: string;
  confirmation_gap: string;
  invalidation: string;
  confirmation_chain: string[];
}

export interface TraderReadout {
  symbol: string;
  setup_type: string;
  performance: string;
  narrative_support: string;
  technical_confirmation: string;
  trader_takeaway: string;
}

export interface ActionGuidance {
  bias: string;
  reference_action: string;
  monitor: string[];
  upgrade_conditions: string[];
  downgrade_conditions: string[];
}

export interface TraderAssessment {
  market_regime: string;
  risk_bias: string;
  decision_state: string;
  confidence: string;
  risk_flags: string[];
}

export interface DailyMarketOverviewData {
  type: string;
  skill_id: string;
  timestamp: string;
  status: string;
  confidence: string;
  summary: string;
  market_read: MarketRead;
  trader_assessment: TraderAssessment;
  watchlist: WatchlistCandidate[];
  trader_readouts: TraderReadout[];
  action_guidance: ActionGuidance;
}

export interface CmcSkillResponse {
  result: {
    ok: boolean;
    data: DailyMarketOverviewData;
  };
}
