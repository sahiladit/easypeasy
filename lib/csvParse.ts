import type { Transaction } from "@/types";

/**
 * Parse CSV text into Transaction[].
 * Matches the format expected by the analyze API:
 * transaction_id,sender_id,receiver_id,amount,timestamp
 * Timestamp: YYYY-MM-DD HH:MM:SS
 */
export function parseCsvToTransactions(text: string): Transaction[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0]!.trim();
  if (
    header !== "transaction_id,sender_id,receiver_id,amount,timestamp"
  ) {
    return [];
  }

  const transactions: Transaction[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i]!.split(",");
    if (cols.length < 5) continue;
    const [transactionId, senderId, receiverId, amountStr, timestampStr] =
      cols;
    const amount = Number.parseFloat(amountStr?.trim() ?? "");
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const ts = timestampStr?.trim()?.replace(" ", "T");
    const date = ts ? new Date(ts) : null;
    if (!date || Number.isNaN(date.getTime())) continue;

    transactions.push({
      transactionId: (transactionId ?? "").trim(),
      senderId: (senderId ?? "").trim(),
      receiverId: (receiverId ?? "").trim(),
      amount,
      timestamp: date,
    });
  }
  return transactions;
}
