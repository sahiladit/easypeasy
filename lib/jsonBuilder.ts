import type {
  AnalysisResult,
  FraudRing,
  SuspiciousAccount,
} from "@/types";

export function buildJsonResult(
  suspiciousAccounts: SuspiciousAccount[],
  fraudRings: FraudRing[],
  totalAccountsAnalyzed: number,
  processingTimeSeconds: number,
): AnalysisResult {
  const sortedSuspicious = [...suspiciousAccounts].sort((a, b) => {
    if (b.suspicion_score !== a.suspicion_score) {
      return b.suspicion_score - a.suspicion_score;
    }
    return a.account_id.localeCompare(b.account_id);
  });

  const sortedRings = [...fraudRings].sort((a, b) => {
    if (b.risk_score !== a.risk_score) {
      return b.risk_score - a.risk_score;
    }
    return a.ring_id.localeCompare(b.ring_id);
  });

  return {
    suspicious_accounts: sortedSuspicious,
    fraud_rings: sortedRings,
    summary: {
      total_accounts_analyzed: totalAccountsAnalyzed,
      suspicious_accounts_flagged: sortedSuspicious.length,
      fraud_rings_detected: sortedRings.length,
      processing_time_seconds:
        Math.round(processingTimeSeconds * 10) / 10,
    },
  };
}

