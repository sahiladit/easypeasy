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

export type FraudRing = {
  ring_id: string;
  member_accounts: string[];
  pattern_type: "cycle" | "smurfing" | "layered_shell";
  risk_score: number;
};

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

export type AnalyzeApiResponse = {
  analysis: AnalysisResult;
  graphNodes: GraphNodeInfo[];
  graphEdges: GraphEdgeInfo[];
};

