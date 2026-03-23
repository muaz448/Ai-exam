
import { GoogleGenAI, Type } from "@google/genai";
import { Question, QuestionType } from "../types";

export const generateQuestionsWithGemini = async (text: string, mcCount: number, fibCount: number, choiceCount: number = 4): Promise<Question[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const optimizedContext = text.slice(0, 15000);

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Generate exactly ${mcCount} multiple-choice questions (with ${choiceCount} options each) AND exactly ${fibCount} fill-in-the-blank questions from the text. 
    Prioritize speed. Be concise. Output ONLY valid JSON.
    
    TEXT:
    ${optimizedContext}`,
    config: {
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            type: { type: Type.STRING, enum: [QuestionType.MULTIPLE_CHOICE, QuestionType.FILL_IN_THE_BLANK] },
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
          required: ["text", "type", "correctAnswer"]
        }
      }
    }
  });

  const rawQuestions = JSON.parse(response.text || "[]");
  return rawQuestions.map((q: any, index: number) => ({
    ...q,
    id: `q-${Date.now()}-${index}`
  }));
};

export const expandQuestionsWithGemini = async (existingQuestions: Question[], targetCount: number): Promise<Question[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Based on these existing questions, generate ${targetCount} MORE unique questions that follow the same style, difficulty, and topic.
    
    EXISTING QUESTIONS:
    ${JSON.stringify(existingQuestions)}
    
    Output ONLY valid JSON.`,
    config: {
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            type: { type: Type.STRING, enum: [QuestionType.MULTIPLE_CHOICE, QuestionType.FILL_IN_THE_BLANK] },
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
          required: ["text", "type", "correctAnswer"]
        }
      }
    }
  });

  const rawQuestions = JSON.parse(response.text || "[]");
  return rawQuestions.map((q: any, index: number) => ({
    ...q,
    id: `q-expanded-${Date.now()}-${index}`
  }));
};

export const getAIStudyFeedback = async (score: number, missedQuestions: string[]): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    config: { thinkingConfig: { thinkingBudget: 0 } },
    contents: `Score: ${score}%. Missed: ${missedQuestions.join(", ")}. 
    3 tiny study tips.`,
  });
  return response.text || "Focus on the missed concepts!";
};
