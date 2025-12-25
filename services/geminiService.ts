
import { GoogleGenAI, Type } from "@google/genai";
import { Question } from "../types";

export const generateQuestionsWithGemini = async (text: string, count: number): Promise<Question[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Based on the following study text, generate exactly ${count} multiple-choice questions. 
    Each question must have 4 options (A, B, C, D). 
    TEXT:
    ${text}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            options: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  text: { type: Type.STRING }
                },
                required: ["label", "text"]
              }
            },
            correctAnswer: { type: Type.STRING }
          },
          required: ["text", "options", "correctAnswer"]
        }
      }
    }
  });

  const rawQuestions = JSON.parse(response.text || "[]");
  return rawQuestions.map((q: any, index: number) => ({
    ...q,
    id: `q-${index + 1}`
  }));
};

export const getAIStudyFeedback = async (score: number, missedQuestions: string[]): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `A student scored ${score}% on a test. They missed questions related to these topics: ${missedQuestions.join(", ")}. 
    Provide encouraging, brief, and actionable study advice in 3 bullet points. Focus on what they should study next.`,
  });
  return response.text || "Keep studying and focus on the areas where you missed questions!";
};
