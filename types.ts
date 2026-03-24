
export enum QuestionType {
  MULTIPLE_CHOICE = 'multiple_choice',
  FILL_IN_THE_BLANK = 'fill_in_the_blank'
}

export interface Question {
  id: string;
  text: string;
  type: QuestionType;
  options?: {
    label: string;
    text: string;
  }[];
  correctAnswer: string;
}

export interface Test {
  id: string;
  title: string;
  questions: Question[];
  createdAt: number;
  lastModified?: number;
  timerMinutes: number;
  creatorId: string;
}

export interface TestResult {
  id: string;
  testId: string;
  testTitle: string;
  studentId: string;
  studentName: string;
  score: number;
  totalQuestions: number;
  correctCount: number;
  timestamp: number;
  userAnswers: Record<string, string>; // Maps questionId to label
  questionsSnapshot: Question[]; // Snapshot of questions at time of test
  aiFeedback?: string;
  timePerQuestion?: Record<string, number>; // Maps questionId to seconds spent
  teacherFeedback?: string;
}

export interface User {
  id: string;
  name: string;
  role: 'teacher' | 'student';
  password?: string;
}

export enum Theme {
  LIGHT = 'light',
  DARK = 'dark'
}

export type ViewState = 'home' | 'login' | 'teacher-dash' | 'student-dash' | 'test-creator' | 'test-taking' | 'result-view' | 'review-detail';
