export type Transaction = {
  transactionId: string;
  senderId: string;
  receiverId: string;
  amount: number;
  timestamp: Date;
};

export type RawCsvRow = {
  transaction_id: string;
  sender_id: string;
  receiver_id: string;
  amount: string;
  timestamp: string;
};

export type DetectionPattern =
  | "cycle_length_3"
  | "cycle_length_4"
  | "cycle_length_5"
  | "smurfing_in"
  | "smurfing_out"
  | "layered_shell"
  | "high_velocity";

export type AccountPatternSummary = {
  accountId: string;
  cycleLength: 0 | 3 | 4 | 5;
  smurfingInCount: number;
  smurfingOutCount: number;
  hasLayeredShell: boolean;
  highVelocity: boolean;
  inDegree: number;
  outDegree: number;
  totalTransactions: number;
  firstTimestamp: Date | null;
  lastTimestamp: Date | null;
  detectedPatterns: DetectionPattern[];
  suspicionScore: number;
  ringId?: string;
};

export type GraphAdjacency = Map<string, Set<string>>;

export type AccountTimeSeriesEntry = {
  counterpartyId: string;
  timestamp: Date;
};

export type AccountTimeSeries = {
  inbound: AccountTimeSeriesEntry[];
  outbound: AccountTimeSeriesEntry[];
};

export type GraphEdgeWithMeta = {
  source: string;
  target: string;
  amount: number;
  timestamp: Date;
};

export type GraphData = {
  adjacencyOut: GraphAdjacency;
  adjacencyIn: GraphAdjacency;
  inDegree: Map<string, number>;
  outDegree: Map<string, number>;
  transactionCounts: Map<string, number>;
  timestamps: Map<string, Date[]>;
  timeSeries: Map<string, AccountTimeSeries>;
  edges: GraphEdgeWithMeta[];
};

export type SuspiciousAccount = {
  account_id: string;
  suspicion_score: number;
  detected_patterns: DetectionPattern[];
  ring_id: string;
};

// @/types.ts (or wherever FraudRing is defined)
export interface FraudRing {
  ring_id: string;
  member_accounts: string[];
  pattern_type: "cycle" | "layered_shell" | "smurfing";
  risk_score: number;
}

export type AnalysisSummary = {
  total_accounts_analyzed: number;
  suspicious_accounts_flagged: number;
  fraud_rings_detected: number;
  processing_time_seconds: number;
};

export type AnalysisResult = {
  suspicious_accounts: SuspiciousAccount[];
  fraud_rings: FraudRing[];
  summary: AnalysisSummary;
};

export type GraphNodeInfo = {
  id: string;
  suspicion_score: number;
  detected_patterns: DetectionPattern[];
  ring_id?: string;
};

export type GraphEdgeInfo = {
  source: string;
  target: string;
};

/** Per-stage timing from the analysis pipeline (real measured times). */
export type PipelineStageTiming = {
  stageName: string;
  timeMs: number;
  /** Percentage of total pipeline time (0–100). */
  percentOfTotal?: number;
};

/** End-to-end pipeline timing breakdown for the Processing Time panel hover. */
export type TimingBreakdown = {
  totalMs: number;
  stages: PipelineStageTiming[];
};

/** Metrics and rules for the explainer LLM (data-grounded only). */
export type NodeExplainerContext = {
  nodeId: string;
  metrics: {
    inDegree: number;
    outDegree: number;
    totalTransactions: number;
    cycleLength: 0 | 3 | 4 | 5;
    smurfingInCount: number;
    smurfingOutCount: number;
    hasLayeredShell: boolean;
    highVelocity: boolean;
    detectedPatterns: DetectionPattern[];
    suspicionScore: number;
    ringId: string;
  };
  /** Thresholds and rules used by the scoring system (for LLM to reference only). */
  thresholds: {
    smurfingInOut: { minToFlag: number; tiers: string };
    highVelocity: { maxTxIn72h: number };
    layeredShell: { contributes: number };
    cycleScores: string;
    multiPatternBonus: string;
    degreeMitigation: string;
    longSpanMitigation: string;
  };
  /** Decision from the pipeline: flagged or not. */
  decision: {
    flagged: boolean;
    reason: string;
  };
  /** Observations from the pipeline (not from LLM). */
  observations: string[];
};

export type AnalyzeApiResponse = {
  analysis: AnalysisResult;
  graphNodes: GraphNodeInfo[];
  graphEdges: GraphEdgeInfo[];
  /** Transaction timestamps per node (ms) for 72h moving average chart. */
  nodeTimestamps?: Record<string, number[]>;
  /** Per-stage timing for Processing Time hover breakdown. */
  timingBreakdown?: TimingBreakdown;
  /** Per-node context for the explainer LLM. */
  nodeExplainerContext?: Record<string, NodeExplainerContext>;
};

