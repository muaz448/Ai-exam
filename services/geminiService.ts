
import { Question, QuestionType } from "../types";

const OPENROUTER_API_KEY = "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";
// Using the standard OpenRouter chat completions URL.
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "minimax/minimax-m2.5:free";

async function callOpenRouter(prompt: string): Promise<string> {
  const response = await fetch(OPENROUTER_BASE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "QuickStudy"
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenRouter API Error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

export const generateQuestionsWithGemini = async (text: string, mcCount: number, fibCount: number, choiceCount: number = 4): Promise<Question[]> => {
  const optimizedContext = text.slice(0, 15000);

  const prompt = `Generate exactly ${mcCount} multiple-choice questions (with ${choiceCount} options each) AND exactly ${fibCount} fill-in-the-blank questions from the text. 
  Output ONLY valid JSON containing an object with a "questions" array.
  
  JSON Schema format to follow:
  {
    "questions": [
      {
        "text": "Question text",
        "type": "MULTIPLE_CHOICE", // or "FILL_IN_THE_BLANK"
        "options": [ { "label": "A", "text": "Option text" } ], // options ONLY if multiple choice
        "correctAnswer": "A" // For fill-in-the-blank, the exact correct string
      }
    ]
  }
  
  TEXT:
  ${optimizedContext}`;

  const responseText = await callOpenRouter(prompt);

  try {
    const match = responseText.match(/\{[\s\S]*\}/);
    const jsonStr = match ? match[0] : responseText;
    const parsed = JSON.parse(jsonStr);
    const rawQuestions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    return rawQuestions.map((q: any, index: number) => ({
      ...q,
      id: `q-${Date.now()}-${index}`
    }));
  } catch (e) {
    console.error("Failed to parse JSON response form OpenRouter API", responseText, e);
    return [];
  }
};

export const expandQuestionsWithGemini = async (existingQuestions: Question[], targetCount: number): Promise<Question[]> => {
  const prompt = `Based on these existing questions, generate ${targetCount} MORE unique questions that follow the same style, difficulty, and topic.
  
  EXISTING QUESTIONS:
  ${JSON.stringify(existingQuestions)}
  
  Output ONLY valid JSON containing an object with a "questions" array.
  JSON Schema format to follow:
  {
    "questions": [
      {
        "text": "Question text",
        "type": "MULTIPLE_CHOICE", // or "FILL_IN_THE_BLANK"
        "options": [ { "label": "A", "text": "Option text" } ], // options ONLY if multiple choice
        "correctAnswer": "A" // For fill-in-the-blank, the exact correct string
      }
    ]
  }`;

  const responseText = await callOpenRouter(prompt);

  try {
    const match = responseText.match(/\{[\s\S]*\}/);
    const jsonStr = match ? match[0] : responseText;
    const parsed = JSON.parse(jsonStr);
    const rawQuestions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    return rawQuestions.map((q: any, index: number) => ({
      ...q,
      id: `q-expanded-${Date.now()}-${index}`
    }));
  } catch (e) {
    console.error("Failed to parse JSON response form OpenRouter API", responseText, e);
    return [];
  }
};

export const getAIStudyFeedback = async (score: number, missedQuestions: string[]): Promise<string> => {
  const prompt = `Score: ${score}%. Missed: ${missedQuestions.join(", ")}. 
  Provide 3 tiny study tips. Keep it extremely brief and encouraging.`;
  const responseText = await callOpenRouter(prompt);
  return responseText || "Focus on the missed concepts!";
};

export const getAIExplanation = async (question: Question, userAnswer: string): Promise<string> => {
  const prompt = `Explain why the correct answer for this question is "${question.correctAnswer}".
  Question: ${question.text}
  ${question.options ? `Options: ${question.options.map(o => `${o.label}: ${o.text}`).join(", ")}` : ""}
  Student's Answer: ${userAnswer}
  
  Keep it short, direct, and helpful.`;
  
  const responseText = await callOpenRouter(prompt);
  return responseText || "No explanation available.";
};
