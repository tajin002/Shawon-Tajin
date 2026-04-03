import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 1000): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      const isRateLimit = error?.message?.includes('429') || error?.status === 'RESOURCE_EXHAUSTED' || error?.code === 429;
      if (isRateLimit && retries < maxRetries) {
        const delay = initialDelay * Math.pow(2, retries);
        console.warn(`Rate limit hit. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
        continue;
      }
      throw error;
    }
  }
}

export interface WordData {
  word: string;
  synonym: string;
  bengaliMeaning: string;
  example: string;
  imageUrl?: string;
}

export async function fetchWordDetails(word: string): Promise<Omit<WordData, 'imageUrl'>> {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Provide the synonym, Bengali meaning, and an example sentence for the word: "${word}".`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            synonym: { type: Type.STRING, description: "A few synonyms for the word" },
            bengaliMeaning: { type: Type.STRING, description: "The Bengali meaning of the word" },
            example: { type: Type.STRING, description: "An example sentence using the word" },
          },
          required: ["synonym", "bengaliMeaning", "example"],
        },
      },
    });

    const data = JSON.parse(response.text || "{}");
    return {
      word,
      synonym: data.synonym || "N/A",
      bengaliMeaning: data.bengaliMeaning || "N/A",
      example: data.example || "N/A",
    };
  });
}

export async function generateWordImage(word: string): Promise<string | undefined> {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [
          {
            text: `A high-quality, realistic, and meaningful photographic image that clearly represents the concept or object of the word: "${word}". The image should be visually striking and contextually accurate.`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
        }
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return undefined;
  });
}

export async function extractWordsFromMedia(base64Data: string, mimeType: string): Promise<string[]> {
  return withRetry(async () => {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        },
        {
          text: "Extract all the unique meaningful words from this document or image. Return them as a simple JSON array of strings. Only return the array, nothing else.",
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
    });

    try {
      return JSON.parse(response.text || "[]");
    } catch (e) {
      console.error("Failed to parse extracted words:", e);
      return [];
    }
  });
}
