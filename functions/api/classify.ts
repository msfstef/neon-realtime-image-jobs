import { neon } from "@neon/ai-sdk-provider";
import { Output, streamText } from "ai";
import { z } from "zod";

import { CATEGORIES } from "../../shared/types.js";
import { env } from "./env.js";

// The "particular way" we classify: a fixed taxonomy plus a short caption and
// keyword tags, returned as structured output so it can be stored as columns.
export const classificationSchema = z.object({
  category: z.enum(CATEGORIES).describe("The single best-fitting category for the main subject."),
  confidence: z.number().min(0).max(1).describe("How confident you are in the category, 0 to 1."),
  caption: z.string().describe("One plain sentence (max 20 words) describing the image, suitable as alt text."),
  tags: z.array(z.string()).describe("3 to 6 lowercase single-word or two-word keywords."),
  containsText: z.boolean().describe("Whether the image contains legible text."),
});

export type Classification = z.infer<typeof classificationSchema>;
export type PartialClassification = Partial<Omit<Classification, "tags">> & { tags?: (string | undefined)[] };

const SYSTEM = `You classify user-uploaded photos for an image library.
Pick exactly one category from: ${CATEGORIES.join(", ")}.
Use "other" only when nothing else fits. Be concise and factual; never guess identities of people.`;

/**
 * Streams a structured classification for an image. `onPartial` receives the
 * progressively parsed object so callers can persist it while the model is
 * still generating.
 */
export async function classifyImage(
  image: Uint8Array,
  mediaType: string,
  onPartial: (partial: PartialClassification) => Promise<void> | void,
): Promise<Classification> {
  // streamText reports provider failures through onError and then only rejects
  // `output` with a generic NoOutputGeneratedError, so keep the real cause.
  let streamError: unknown;
  const result = streamText({
    model: neon(env.classifierModel),
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Classify this image." },
          { type: "image", image, mediaType },
        ],
      },
    ],
    output: Output.object({ schema: classificationSchema }),
    // Reasoning tokens dominated the cost of this task. Minimal effort cut it
    // ~5x on gpt-5-nano with the same answers. Only the Responses route (gpt-*)
    // reads the `openai` namespace; other models ignore it.
    providerOptions: { openai: { reasoningEffort: "minimal" } },
    maxRetries: 2,
    // The Functions runtime's tracing conflicts with the AI SDK's streaming spans.
    experimental_telemetry: { isEnabled: false },
    onError: ({ error }) => {
      streamError = error;
    },
  });

  for await (const partial of result.partialOutputStream) {
    await onPartial(partial as PartialClassification);
  }
  try {
    return await result.output;
  } catch (error) {
    throw streamError ?? error;
  }
}
