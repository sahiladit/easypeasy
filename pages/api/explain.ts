import type { NextApiRequest, NextApiResponse } from "next";
import type { NodeExplainerContext } from "@/types";
import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_INSTRUCTION = `You are an explainer for a transaction risk analysis system. Your role is only to explain. You must NOT compute scores, infer missing data, or generalize beyond the provided inputs. Use only the metrics, thresholds, decision, and observations given. Every claim must trace back to the provided data. Be structured, factual, and precise. No marketing tone, no speculation, no filler.`;

function buildPrompt(ctx: NodeExplainerContext): string {
  const parts = [
    "## metrics",
    JSON.stringify(ctx.metrics, null, 2),
    "",
    "## thresholds (scoring rules – for reference only)",
    JSON.stringify(ctx.thresholds, null, 2),
    "",
    "## decision",
    JSON.stringify(ctx.decision, null, 2),
    "",
    "## observations (from the pipeline)",
    ctx.observations.length ? ctx.observations.join("\n") : "None.",
    "",
    "## instructions",
    "Explain only this node's risk score. Cover: (1) what the key metrics are, (2) what patterns were observed (e.g. spikes, consistency, anomalies), (3) why these patterns increased or decreased the risk score, (4) why the node was or was not flagged. Use only the data above. Do not infer, guess, or hallucinate.",
  ];
  return parts.join("\n");
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ explanation?: string; error?: string }>,
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  try {
    const body = req.body as { context?: NodeExplainerContext };
    const context = body?.context;

    if (!context || typeof context !== "object" || !context.nodeId) {
      res.status(400).json({
        error:
          "Missing or invalid context (expected { context: NodeExplainerContext }).",
      });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error:
          "LLM not configured. Set GEMINI_API_KEY for node explanations.",
      });
      return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: SYSTEM_INSTRUCTION,
    });

    const prompt = buildPrompt(context);
    const result = await model.generateContent(prompt);
    const explanation = result.response.text().trim();

    if (!explanation) {
      res.status(502).json({ error: "Empty or invalid Gemini response." });
      return;
    }

    res.status(200).json({ explanation });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown explain error.";
    res.status(500).json({ error: message });
  }
}
