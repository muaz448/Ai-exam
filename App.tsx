import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BookOpen, 
  GraduationCap, 
  Plus, 
  FileText, 
  Clock, 
  ChevronRight, 
  LogOut, 
  User as UserIcon,
  CheckCircle2,
  XCircle,
  BarChart3,
  ArrowLeft,
  Upload,
  Loader2,
  Trash2,
  Eye,
  Download,
  BrainCircuit,
  AlertTriangle,
  Menu,
  X,
  Lock,
  Bell
} from 'lucide-react';
import { Question, Theme, ViewState, User, Test, TestResult, QuestionType } from './types';
import { generateQuestionsWithGemini, getAIStudyFeedback, expandQuestionsWithGemini, getAIExplanation } from './services/geminiService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { db, handleFirestoreError, OperationType } from './firebase';
import { collection, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, addDoc } from 'firebase/firestore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const App: React.FC = () => {
  const [view, setView] = useState<ViewState>('home');
  const [role, setRole] = useState<'teacher' | 'student' | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [tests, setTests] = useState<Test[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  const [activeTest, setActiveTest] = useState<Test | null>(null);
  const [activeResult, setActiveResult] = useState<TestResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editTestId, setEditTestId] = useState<string | null>(null);
  const [showEditConfirm, setShowEditConfirm] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<any>(null);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [extractedText, setExtractedText] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);

  const [creationMode, setCreationMode] = useState<'ai' | 'manual'>('ai');
  const [manualQuestions, setManualQuestions] = useState<Question[]>([
    {
      id: `q-manual-${Date.now()}`,
      text: '',
      type: QuestionType.MULTIPLE_CHOICE,
      options: [
        { label: 'A', text: '' },
        { label: 'B', text: '' },
        { label: 'C', text: '' },
        { label: 'D', text: '' },
      ],
      correctAnswer: 'A'
    }
  ]);
  const [isExpanding, setIsExpanding] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [timePerQuestion, setTimePerQuestion] = useState<Record<string, number>>({});
  const [lastQuestionChangeTime, setLastQuestionChangeTime] = useState<number>(0);
  const [isExplaining, setIsExplaining] = useState<string | null>(null); // questionId being explained
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [showAnalytics, setShowAnalytics] = useState<string | null>(null); // testId for analytics
  const [feedbackText, setFeedbackText] = useState("");
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [notifications, setNotifications] = useState<TestResult[]>([]);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const addManualQuestion = () => {
    setManualQuestions([...manualQuestions, {
      id: `q-manual-${Date.now()}`,
      text: '',
      type: QuestionType.MULTIPLE_CHOICE,
      options: [
        { label: 'A', text: '' },
        { label: 'B', text: '' },
        { label: 'C', text: '' },
        { label: 'D', text: '' },
      ],
      correctAnswer: 'A'
    }]);
  };

  const removeManualQuestion = (id: string) => {
    if (manualQuestions.length > 1) {
      setManualQuestions(manualQuestions.filter(q => q.id !== id));
    }
  };

  const updateManualQuestion = (id: string, updates: Partial<Question>) => {
    setManualQuestions(manualQuestions.map(q => q.id === id ? { ...q, ...updates } : q));
  };

  const handleExpandQuestions = async () => {
    if (manualQuestions.some(q => !q.text.trim())) {
      setError('Please fill in existing questions before expanding.');
      return;
    }
    setIsExpanding(true);
    setError(null);
    try {
      const expanded = await expandQuestionsWithGemini(manualQuestions, 5);
      setManualQuestions([...manualQuestions, ...expanded]);
    } catch (err) {
      setError('AI Expansion failed. Try again.');
    } finally {
      setIsExpanding(false);
    }
  };

  const handleSaveManualTest = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const title = formData.get('title') as string;
    const time = Number(formData.get('timer'));

    if (manualQuestions.some(q => !q.text.trim() || (q.type === QuestionType.MULTIPLE_CHOICE && q.options?.some(o => !o.text.trim())))) {
      setError('Please fill in all questions and options.');
      return;
    }

    const newTest: Test = {
      id: editTestId || `t-${Date.now()}`,
      title,
      questions: manualQuestions,
      createdAt: editTestId ? (tests.find(t => t.id === editTestId)?.createdAt || Date.now()) : Date.now(),
      lastModified: Date.now(),
      timerMinutes: time,
      creatorId: user!.id
    };

    if (editTestId) {
      setPendingSaveData(newTest);
      setShowEditConfirm(true);
    } else {
      performSave(newTest);
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('qs_user');
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      // Verify user still exists in DB
      getDoc(doc(db, 'users', parsedUser.id)).then(docSnap => {
        if (docSnap.exists()) {
          setUser(docSnap.data() as User);
        } else {
          localStorage.removeItem('qs_user');
          setUser(null);
        }
        setIsAuthReady(true);
      }).catch(() => {
        setIsAuthReady(true);
      });
    } else {
      setIsAuthReady(true);
    }

    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    if (!isAuthReady || !user) return;

    const testsQuery = query(collection(db, 'tests'), orderBy('createdAt', 'desc'));
    const unsubscribeTests = onSnapshot(testsQuery, (snapshot) => {
      const testsData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Test));
      setTests(testsData);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'tests'));

    let resultsQuery;
    if (user.role === 'teacher') {
      resultsQuery = query(collection(db, 'results'), orderBy('timestamp', 'desc'));
    } else {
      resultsQuery = query(collection(db, 'results'), where('studentId', '==', user.id), orderBy('timestamp', 'desc'));
    }

    const unsubscribeResults = onSnapshot(resultsQuery, (snapshot) => {
      const resultsData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as TestResult));
      setResults(resultsData);
      
      if (user.role === 'student') {
        const unread = resultsData.filter(r => r.teacherFeedback && !r.feedbackRead);
        setNotifications(unread);
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'results'));

    return () => {
      unsubscribeTests();
      unsubscribeResults();
    };
  }, [isAuthReady, user]);

  useEffect(() => {
    if (view === 'test-taking' && !isPreviewMode && timeLeft > 0) {
      timerRef.current = window.setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) { handleTestSubmit(); return 0; }
          return prev - 1;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [view, timeLeft, isPreviewMode]);

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    // @ts-ignore
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      // @ts-ignore
      fullText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
    }
    return fullText;
  };

  const extractTextFromDocx = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    // @ts-ignore
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  const extractTextFromPptx = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    // @ts-ignore
    const zip = await window.JSZip.loadAsync(arrayBuffer);
    let fullText = '';
    const slideEntries = Object.keys(zip.files).filter(name => name.startsWith('ppt/slides/slide') && name.endsWith('.xml'));
    for (const entryName of slideEntries) {
      const content = await zip.files[entryName].async('text');
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, 'text/xml');
      const textNodes = xmlDoc.getElementsByTagName('a:t');
      for (let i = 0; i < textNodes.length; i++) {
        fullText += (textNodes[i].textContent || '') + ' ';
      }
      fullText += '\n';
    }
    return fullText;
  };

  const extractTextFromGeneric = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    setIsExtracting(true);
    setError(null);
    try {
      let text = '';
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'pdf') text = await extractTextFromPDF(file);
      else if (ext === 'docx') text = await extractTextFromDocx(file);
      else if (ext === 'pptx') text = await extractTextFromPptx(file);
      else if (['txt', 'md', 'csv', 'json'].includes(ext || '')) text = await extractTextFromGeneric(file);
      else text = await extractTextFromGeneric(file);
      setExtractedText(text);
    } catch (err) {
      setError("Failed to process document. Please try a different format.");
      setUploadedFile(null);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = (formData.get('name') as string || '').trim();
    const id = (formData.get('id') as string || '').trim();
    const password = formData.get('password') as string;

    if (!role) {
      setError('Please select a role first.');
      return;
    }

    if (!name || !id) {
      setError('Name and ID are required.');
      return;
    }

    try {
      const userDocRef = doc(db, 'users', id);
      const userDoc = await getDoc(userDocRef);
      
      let userData: User;
      if (!userDoc.exists()) {
        // Create new user
        if (role === 'teacher' && password !== '1996') {
          setError('Incorrect Teacher Password for new account.');
          return;
        }
        
        userData = {
          id,
          name,
          role: role,
        };
        
        if (role === 'teacher') {
          userData.password = password;
        }

        await setDoc(userDocRef, userData);
      } else {
        userData = userDoc.data() as User;
        if (userData.role !== role) {
          setError(`This ID is registered as a ${userData.role}. Please select the correct role.`);
          return;
        }
        if (role === 'teacher') {
          if (userData.password !== password) {
            setError('Incorrect Password.');
            return;
          }
        }
      }
      
      setUser(userData);
      localStorage.setItem('qs_user', JSON.stringify(userData));
      setError(null);
      setView(userData.role === 'teacher' ? 'teacher-dash' : 'student-dash');
    } catch (err) {
      console.error('Login error:', err);
      if (err instanceof Error) {
        setError(`Login failed: ${err.message}`);
      } else {
        setError('Login failed. Please try again.');
      }
    }
  };

  const handleChangePassword = async () => {
    if (!user || user.role !== 'teacher' || !newPassword) return;
    try {
      await updateDoc(doc(db, 'users', user.id), { password: newPassword });
      const updatedUser = { ...user, password: newPassword };
      setUser(updatedUser);
      localStorage.setItem('qs_user', JSON.stringify(updatedUser));
      setNewPassword("");
      setShowChangePassword(false);
      alert("Password updated successfully!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.id}`);
    }
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('qs_user');
    setView('home');
  };

  const performSave = async (newTest: Test) => {
    try {
      if (editTestId) {
        await updateDoc(doc(db, 'tests', editTestId), { ...newTest });
      } else {
        await addDoc(collection(db, 'tests'), { ...newTest });
      }
      setEditTestId(null);
      setShowEditConfirm(false);
      setPendingSaveData(null);
      setUploadedFile(null);
      setExtractedText('');
      setManualQuestions([{
        id: `q-manual-${Date.now()}`,
        text: '',
        type: QuestionType.MULTIPLE_CHOICE,
        options: [
          { label: 'A', text: '' },
          { label: 'B', text: '' },
          { label: 'C', text: '' },
          { label: 'D', text: '' },
        ],
        correctAnswer: 'A'
      }]);
      setView('teacher-dash');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'tests');
    }
  };

  const handleSaveTest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const pastedText = formData.get('text') as string;
    const mcCount = Number(formData.get('mcCount') || 0);
    const fibCount = Number(formData.get('fibCount') || 0);
    const time = Number(formData.get('timer'));
    const title = formData.get('title') as string;
    const choiceCount = Number(formData.get('choiceCount') || 4);
    const sourceText = extractedText || pastedText;

    if (!sourceText || sourceText.trim().length < 50) {
      setError('Please provide more content material.');
      return;
    }

    if (mcCount + fibCount === 0) {
      setError('Please specify at least one question to generate.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    try {
      const qs = await generateQuestionsWithGemini(sourceText, mcCount, fibCount, choiceCount);
      const newTest: Test = {
        id: editTestId || `t-${Date.now()}`,
        title,
        questions: qs,
        createdAt: editTestId ? (tests.find(t => t.id === editTestId)?.createdAt || Date.now()) : Date.now(),
        lastModified: Date.now(),
        timerMinutes: time,
        creatorId: user!.id
      };

      if (editTestId) {
        setPendingSaveData(newTest);
        setShowEditConfirm(true);
      } else {
        performSave(newTest);
      }
    } catch (err) {
      setError('Generation failed. Try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const startTest = (test: Test, preview: boolean = false) => {
    const hasTaken = results.some(r => r.testId === test.id && r.studentId === user?.id);
    if (hasTaken && !preview) {
      const result = results.find(r => r.testId === test.id && r.studentId === user?.id);
      if (result) {
        setActiveResult(result);
        setView('result-view');
      }
      return;
    }
    setActiveTest(test);
    setAnswers({});
    setIsPreviewMode(preview);
    setTimeLeft(test.timerMinutes * 60);
    setCurrentQuestionIndex(0);
    setTimePerQuestion({});
    setLastQuestionChangeTime(Date.now());
    setView('test-taking');
  };

  const handleTestSubmit = async () => {
    if (!activeTest || isPreviewMode) { setView('teacher-dash'); return; }
    
    // Finalize time for the last question
    const now = Date.now();
    const timeSpent = Math.round((now - lastQuestionChangeTime) / 1000);
    const finalTimePerQuestion = { ...timePerQuestion };
    const currentQ = activeTest.questions[currentQuestionIndex];
    finalTimePerQuestion[currentQ.id] = (finalTimePerQuestion[currentQ.id] || 0) + timeSpent;

    let correct = 0;
    activeTest.questions.forEach(q => { if (answers[q.id] === q.correctAnswer) correct++; });
    const score = Math.round((correct / activeTest.questions.length) * 100);
    const feedback = await getAIStudyFeedback(score, activeTest.questions.filter(q => answers[q.id] !== q.correctAnswer).map(q => q.text).slice(0,3));
    
    const resultData = {
      testId: activeTest.id, testTitle: activeTest.title,
      studentId: user!.id, studentName: user!.name, score, totalQuestions: activeTest.questions.length,
      correctCount: correct, timestamp: Date.now(), userAnswers: { ...answers },
      questionsSnapshot: [...activeTest.questions], aiFeedback: feedback,
      timePerQuestion: finalTimePerQuestion,
      feedbackRead: false
    };

    try {
      const docRef = await addDoc(collection(db, 'results'), resultData);
      const result: TestResult = { ...resultData, id: docRef.id };
      setActiveResult(result);
      setView('result-view');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'results');
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-emerald-500';
    if (score >= 50) return 'text-amber-500';
    return 'text-rose-500';
  };

  const handleExplain = async (question: Question, userAnswer: string) => {
    if (explanations[question.id]) return;
    setIsExplaining(question.id);
    try {
      const explanation = await getAIExplanation(question, userAnswer);
      setExplanations(prev => ({ ...prev, [question.id]: explanation }));
    } catch (err) {
      setError('Failed to get explanation.');
    } finally {
      setIsExplaining(null);
    }
  };

  const handleSaveFeedback = async (resultId: string) => {
    try {
      await updateDoc(doc(db, 'results', resultId), { 
        teacherFeedback: feedbackText,
        feedbackRead: false 
      });
      setFeedbackText("");
      const updatedResult = results.find(r => r.id === resultId);
      if (updatedResult) {
        setActiveResult({ ...updatedResult, teacherFeedback: feedbackText, feedbackRead: false });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `results/${resultId}`);
    }
  };

  const getTestAnalytics = (testId: string) => {
    const testResults = results.filter(r => r.testId === testId);
    if (testResults.length === 0) return null;

    const test = tests.find(t => t.id === testId);
    if (!test) return null;

    const questionStats = test.questions.map(q => {
      const attempts = testResults.filter(r => r.userAnswers[q.id] !== undefined).length;
      const correct = testResults.filter(r => r.userAnswers[q.id] === q.correctAnswer).length;
      const totalTime = testResults.reduce((acc, r) => acc + (r.timePerQuestion?.[q.id] || 0), 0);
      const avgTime = attempts > 0 ? Math.round(totalTime / attempts) : 0;
      
      return {
        id: q.id,
        text: q.text,
        attempts,
        correct,
        accuracy: attempts > 0 ? Math.round((correct / attempts) * 100) : 0,
        avgTime
      };
    });

    const avgScore = Math.round(testResults.reduce((acc, r) => acc + r.score, 0) / testResults.length);
    const mostDifficult = [...questionStats].sort((a, b) => a.accuracy - b.accuracy)[0];
    const longestTime = [...questionStats].sort((a, b) => b.avgTime - a.avgTime)[0];

    return {
      avgScore,
      totalSubmissions: testResults.length,
      questionStats,
      mostDifficult,
      longestTime
    };
  };
  const handleQuestionChange = (newIndex: number) => {
    if (!activeTest) return;
    const now = Date.now();
    const timeSpent = Math.round((now - lastQuestionChangeTime) / 1000);
    const currentQ = activeTest.questions[currentQuestionIndex];
    
    setTimePerQuestion(prev => ({
      ...prev,
      [currentQ.id]: (prev[currentQ.id] || 0) + timeSpent
    }));
    
    setLastQuestionChangeTime(now);
    setCurrentQuestionIndex(newIndex);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const pageVariants = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 }
  };

  const Nav = () => (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-b border-white/10">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView(user ? (user.role === 'teacher' ? 'teacher-dash' : 'student-dash') : 'home')}>
          <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
            <BrainCircuit className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-xl tracking-tight hidden sm:block">QuickStudy</span>
        </div>

        {user && (
          <div className="flex items-center gap-4">
            {user.role === 'student' && notifications.length > 0 && (
              <div className="relative">
                <Bell className="w-5 h-5 text-red-500 animate-pulse" />
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
              </div>
            )}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full border border-white/10">
              <UserIcon className="w-4 h-4 text-red-500" />
              <span className="text-sm font-medium">{user.name}</span>
              <span className="text-[10px] uppercase tracking-wider opacity-50 px-1.5 py-0.5 bg-white/10 rounded">
                {user.role}
              </span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-white/10 rounded-full transition-colors text-red-500"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-black text-white selection:bg-red-500/30">
      <Nav />
      
      <main className="pt-24 pb-12 px-4 max-w-7xl mx-auto">
        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="flex flex-col items-center justify-center text-center py-12 md:py-24"
            >
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.5 }}
                className="mb-8"
              >
                <div className="w-20 h-20 bg-red-600 rounded-2xl flex items-center justify-center mx-auto shadow-2xl shadow-red-600/20">
                  <BrainCircuit className="w-12 h-12 text-white" />
                </div>
              </motion.div>
              
              <h1 className="text-5xl md:text-7xl font-black tracking-tighter mb-6">
                STUDY <span className="text-red-600 italic">SMARTER</span>
              </h1>
              <p className="text-zinc-400 text-lg md:text-xl max-w-2xl mb-12 leading-relaxed">
                Transform any document or text into professional multiple-choice tests in seconds. 
                Powered by Gemini AI for precision learning.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md">
                <button 
                  onClick={() => { setRole('teacher'); setView('login'); }}
                  className="group relative flex items-center justify-center gap-3 bg-white text-black font-bold py-4 px-8 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  <GraduationCap className="w-5 h-5" />
                  I'm a Teacher
                  <ChevronRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                </button>
                <button 
                  onClick={() => { setRole('student'); setView('login'); }}
                  className="group relative flex items-center justify-center gap-3 bg-zinc-900 border border-white/10 text-white font-bold py-4 px-8 rounded-xl transition-all hover:bg-zinc-800 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <BookOpen className="w-5 h-5" />
                  I'm a Student
                  <ChevronRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                </button>
              </div>
            </motion.div>
          )}

          {view === 'login' && (
            <motion.div 
              key="login"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="max-w-md mx-auto"
            >
              <div className="q-card p-8">
                <button onClick={() => setView('home')} className="mb-6 flex items-center gap-2 text-zinc-500 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <div className="w-16 h-16 bg-red-600/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  {role === 'teacher' ? <GraduationCap className="w-8 h-8 text-red-500" /> : <BookOpen className="w-8 h-8 text-red-500" />}
                </div>
                <h2 className="text-3xl font-bold mb-2">Welcome {role === 'teacher' ? 'Teacher' : 'Student'}</h2>
                <p className="text-zinc-500 mb-8">Enter your details to access your dashboard.</p>
                
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Full Name</label>
                    <input required name="name" type="text" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors" placeholder="John Doe" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">User ID</label>
                    <input required name="id" type="text" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors" placeholder="ID-12345" />
                  </div>
                  {role === 'teacher' && (
                    <div className="text-left">
                      <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Password</label>
                      <input required name="password" type="password" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors" placeholder="••••" />
                      <p className="text-[10px] text-zinc-600 mt-1">Initial password is 1996</p>
                    </div>
                  )}
                  {error && <p className="text-red-500 text-sm font-medium mb-4">{error}</p>}
                  <button type="submit" className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-red-600/20 mt-4">
                    Continue to Dashboard
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {view === 'teacher-dash' && (
            <motion.div 
              key="teacher-dash"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                  <h2 className="text-4xl font-black tracking-tight">Teacher Dashboard</h2>
                  <p className="text-zinc-500">Manage your tests and view student performance.</p>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowChangePassword(true)}
                    className="flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-white font-bold px-6 py-3 rounded-xl transition-all border border-white/10"
                  >
                    <Lock className="w-5 h-5" /> Change Password
                  </button>
                  <button 
                    onClick={() => setView('test-creator')}
                    className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white font-bold px-6 py-3 rounded-xl transition-all"
                  >
                    <Plus className="w-5 h-5" /> Create New Test
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {showChangePassword && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
                  >
                    <div className="q-card p-8 max-w-md w-full">
                      <div className="flex justify-between items-center mb-6">
                        <h3 className="text-2xl font-bold">Change Password</h3>
                        <button onClick={() => setShowChangePassword(false)} className="p-2 hover:bg-white/10 rounded-full">
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">New Password</label>
                          <input 
                            type="password" 
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors" 
                            placeholder="••••" 
                          />
                        </div>
                        <button 
                          onClick={handleChangePassword}
                          className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-xl transition-all"
                        >
                          Update Password
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <FileText className="w-5 h-5 text-red-500" /> Your Tests
                  </h3>
                  {tests.length === 0 ? (
                    <div className="q-card p-12 text-center border-dashed">
                      <FileText className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
                      <p className="text-zinc-500">No tests created yet. Start by creating your first AI-powered test.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {tests.map(test => (
                        <div key={test.id} className="q-card p-6 group hover:border-red-500/50 transition-all">
                          <div className="flex justify-between items-start mb-4">
                            <h4 className="font-bold text-lg line-clamp-1">{test.title}</h4>
                            <div className="flex gap-2">
                              <button onClick={() => setShowAnalytics(test.id)} className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-red-500" title="Analytics">
                                <BarChart3 className="w-4 h-4" />
                              </button>
                              <button onClick={() => startTest(test, true)} className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-white" title="Preview">
                                <Eye className="w-4 h-4" />
                              </button>
                              <button onClick={() => setTests(tests.filter(t => t.id !== test.id))} className="p-2 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-red-500" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-zinc-500 mb-6">
                            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {test.timerMinutes}m</span>
                            <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> {test.questions.length} Qs</span>
                          </div>
                          <div className="flex items-center justify-between pt-4 border-t border-white/5">
                            <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">
                              {new Date(test.createdAt).toLocaleDateString()}
                            </span>
                            <button onClick={() => startTest(test, true)} className="text-xs font-bold text-red-500 hover:underline">
                              View Details
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <BarChart3 className="w-5 h-5 text-red-500" /> Recent Activity
                  </h3>
                  <div className="q-card overflow-hidden">
                    {results.length === 0 ? (
                      <div className="p-8 text-center">
                        <p className="text-zinc-500 text-sm">No student submissions yet.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/5">
                        {results.slice(0, 5).map(res => (
                          <div key={res.id} className="p-4 hover:bg-white/5 transition-colors cursor-pointer" onClick={() => { setActiveResult(res); setView('result-view'); }}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-bold text-sm">{res.studentName}</span>
                              <span className={cn("font-black text-sm", getScoreColor(res.score))}>{res.score}%</span>
                            </div>
                            <p className="text-xs text-zinc-500 truncate">{res.testTitle}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'student-dash' && (
            <motion.div 
              key="student-dash"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="space-y-8"
            >
              <div>
                <h2 className="text-4xl font-black tracking-tight">Student Dashboard</h2>
                <p className="text-zinc-500">Select a test to begin or review your previous results.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-red-500" /> Available Tests
                  </h3>
                  {tests.length === 0 ? (
                    <div className="q-card p-12 text-center border-dashed">
                      <p className="text-zinc-500">No tests available at the moment. Check back later!</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {tests.map(test => {
                        const hasTaken = results.some(r => r.testId === test.id && r.studentId === user?.id);
                        return (
                          <div key={test.id} className="q-card p-6 group hover:border-red-500/50 transition-all">
                            <div className="flex justify-between items-start mb-2">
                              <h4 className="font-bold text-lg">{test.title}</h4>
                              {hasTaken && <Lock className="w-4 h-4 text-zinc-600" />}
                            </div>
                            <div className="flex items-center gap-4 text-sm text-zinc-500 mb-6">
                              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {test.timerMinutes}m</span>
                              <span className="flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" /> {test.questions.length} Qs</span>
                            </div>
                            <button 
                              onClick={() => startTest(test)}
                              className={cn(
                                "w-full font-bold py-2.5 rounded-lg transition-all flex items-center justify-center gap-2",
                                hasTaken 
                                  ? "bg-zinc-800 text-zinc-500 cursor-default" 
                                  : "bg-white text-black hover:bg-red-600 hover:text-white"
                              )}
                            >
                              {hasTaken ? 'Test Completed' : 'Start Test'} {!hasTaken && <ChevronRight className="w-4 h-4" />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-red-500" /> Your Progress
                  </h3>
                  <div className="q-card p-6">
                    {results.filter(r => r.studentId === user?.id).length === 0 ? (
                      <p className="text-zinc-500 text-sm text-center">You haven't taken any tests yet.</p>
                    ) : (
                      <div className="space-y-4">
                        {results.filter(r => r.studentId === user?.id).slice(0, 5).map(res => (
                          <div 
                            key={res.id} 
                            className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer relative"
                            onClick={async () => {
                              if (res.teacherFeedback && !res.feedbackRead) {
                                try {
                                  await updateDoc(doc(db, 'results', res.id), { feedbackRead: true });
                                } catch (err) {
                                  console.error("Failed to mark feedback as read", err);
                                }
                              }
                              setActiveResult(res);
                              setView('result-view');
                            }}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-sm truncate">{res.testTitle}</p>
                                {res.teacherFeedback && !res.feedbackRead && (
                                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                )}
                              </div>
                              <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{new Date(res.timestamp).toLocaleDateString()}</p>
                            </div>
                            <span className={cn("font-black text-lg", getScoreColor(res.score))}>{res.score}%</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'test-creator' && (
            <motion.div 
              key="test-creator"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="max-w-4xl mx-auto"
            >
              <div className="q-card p-8">
                <button onClick={() => setView('teacher-dash')} className="mb-6 flex items-center gap-2 text-zinc-500 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" /> Back to Dashboard
                </button>
                
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
                  <div>
                    <h2 className="text-3xl font-bold mb-1">Create New Test</h2>
                    <p className="text-zinc-500">Choose how you want to build your assessment.</p>
                  </div>
                  <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                    <button 
                      onClick={() => setCreationMode('ai')}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                        creationMode === 'ai' ? "bg-red-600 text-white shadow-lg" : "text-zinc-500 hover:text-white"
                      )}
                    >
                      AI Generation
                    </button>
                    <button 
                      onClick={() => setCreationMode('manual')}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-bold transition-all",
                        creationMode === 'manual' ? "bg-red-600 text-white shadow-lg" : "text-zinc-500 hover:text-white"
                      )}
                    >
                      Manual Creation
                    </button>
                  </div>
                </div>

                {creationMode === 'ai' ? (
                  <form onSubmit={handleSaveTest} className="space-y-6">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Test Title</label>
                      <input required name="title" type="text" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors" placeholder="e.g. Biology Midterm Review" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Multiple Choice Questions</label>
                        <select name="mcCount" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors">
                          {[0, 5, 10, 15, 20, 30, 40, 50, 60].map(n => <option key={n} value={n}>{n} Questions</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Fill in the Blank Questions</label>
                        <select name="fibCount" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors">
                          {[0, 5, 10, 15, 20, 30, 40, 50, 60].map(n => <option key={n} value={n}>{n} Questions</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Number of Choices (for MC)</label>
                        <select name="choiceCount" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors">
                          {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} Choices</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Timer (Minutes)</label>
                        <select name="timer" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors">
                          {[5, 10, 15, 20, 30, 45, 60].map(n => <option key={n} value={n}>{n} Minutes</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Study Material</label>
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all",
                          uploadedFile ? "border-emerald-500/50 bg-emerald-500/5" : "border-white/10 hover:border-red-500/50 hover:bg-white/5"
                        )}
                      >
                        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".pdf,.docx,.pptx,.txt,.md" />
                        {isExtracting ? (
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
                            <p className="text-sm font-medium">Extracting text...</p>
                          </div>
                        ) : uploadedFile ? (
                          <div className="flex flex-col items-center gap-2">
                            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                            <p className="text-sm font-medium">{uploadedFile.name}</p>
                            <button type="button" onClick={(e) => { e.stopPropagation(); setUploadedFile(null); setExtractedText(''); }} className="text-xs text-rose-500 hover:underline">Remove file</button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2">
                            <Upload className="w-8 h-8 text-zinc-500" />
                            <p className="text-sm font-medium">Click to upload document</p>
                            <p className="text-xs text-zinc-600">PDF, DOCX, PPTX, TXT</p>
                          </div>
                        )}
                      </div>

                      <div className="relative">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-white/5"></span></div>
                        <div className="relative flex justify-center text-xs uppercase"><span className="bg-black px-2 text-zinc-600 font-bold">Or Paste Text</span></div>
                      </div>

                      <textarea 
                        name="text" 
                        rows={6} 
                        className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors resize-none" 
                        placeholder="Paste your study notes here..."
                        disabled={!!uploadedFile}
                      ></textarea>
                    </div>

                    {error && <p className="text-red-500 text-sm font-medium">{error}</p>}

                    <button 
                      type="submit" 
                      disabled={isGenerating}
                      className="w-full bg-red-600 hover:bg-red-500 disabled:bg-zinc-800 text-white font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-3"
                    >
                      {isGenerating ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          AI is generating questions...
                        </>
                      ) : (
                        <>
                          <BrainCircuit className="w-5 h-5" />
                          Generate Test with AI
                        </>
                      )}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleSaveManualTest} className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Test Title</label>
                        <input required name="title" type="text" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors" placeholder="e.g. Custom Quiz" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-widest text-zinc-500 mb-2">Timer (Minutes)</label>
                        <select name="timer" className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors">
                          {[5, 10, 15, 20, 30, 45, 60].map(n => <option key={n} value={n}>{n} Minutes</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xl font-bold">Questions</h3>
                        <button 
                          type="button"
                          onClick={handleExpandQuestions}
                          disabled={isExpanding}
                          className="flex items-center gap-2 px-4 py-2 bg-red-600/10 border border-red-600/20 text-red-500 rounded-lg text-sm font-bold hover:bg-red-600/20 transition-all disabled:opacity-50"
                        >
                          {isExpanding ? <Loader2 className="w-4 h-4 animate-spin" /> : <BrainCircuit className="w-4 h-4" />}
                          AI Expand (+5 Qs)
                        </button>
                      </div>

                      <div className="space-y-6">
                        {manualQuestions.map((q, qIdx) => (
                          <div key={q.id} className="p-6 bg-white/5 rounded-2xl border border-white/10 relative group">
                            <button 
                              type="button"
                              onClick={() => removeManualQuestion(q.id)}
                              className="absolute top-4 right-4 p-2 text-zinc-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                            
                            <div className="mb-4">
                              <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Question {qIdx + 1}</label>
                              <input 
                                required
                                value={q.text}
                                onChange={(e) => updateManualQuestion(q.id, { text: e.target.value })}
                                className="w-full bg-transparent border-b border-white/10 py-2 text-lg focus:border-red-500 outline-none transition-colors"
                                placeholder="Enter your question here..."
                              />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Question Type</label>
                                <select 
                                  value={q.type}
                                  onChange={(e) => {
                                    const newType = e.target.value as QuestionType;
                                    const updates: Partial<Question> = { type: newType };
                                    if (newType === QuestionType.FILL_IN_THE_BLANK) {
                                      updates.options = undefined;
                                      updates.correctAnswer = '';
                                    } else {
                                      updates.options = [
                                        { label: 'A', text: '' },
                                        { label: 'B', text: '' },
                                        { label: 'C', text: '' },
                                        { label: 'D', text: '' },
                                      ];
                                      updates.correctAnswer = 'A';
                                    }
                                    updateManualQuestion(q.id, updates);
                                  }}
                                  className="w-full bg-black border border-white/10 rounded-lg px-4 py-2 text-sm focus:border-red-500 outline-none transition-colors"
                                >
                                  <option value={QuestionType.MULTIPLE_CHOICE}>Multiple Choice</option>
                                  <option value={QuestionType.FILL_IN_THE_BLANK}>Fill in the Blank</option>
                                </select>
                              </div>
                              {q.type === QuestionType.MULTIPLE_CHOICE && (
                                <div>
                                  <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Number of Choices</label>
                                  <select 
                                    value={q.options?.length || 4}
                                    onChange={(e) => {
                                      const count = Number(e.target.value);
                                      const currentOptions = q.options || [];
                                      let newOptions = [...currentOptions];
                                      if (count > currentOptions.length) {
                                        for (let i = currentOptions.length; i < count; i++) {
                                          newOptions.push({ label: String.fromCharCode(65 + i), text: '' });
                                        }
                                      } else {
                                        newOptions = currentOptions.slice(0, count);
                                      }
                                      updateManualQuestion(q.id, { options: newOptions });
                                    }}
                                    className="w-full bg-black border border-white/10 rounded-lg px-4 py-2 text-sm focus:border-red-500 outline-none transition-colors"
                                  >
                                    {[2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n} Choices</option>)}
                                  </select>
                                </div>
                              )}
                            </div>

                            {q.type === QuestionType.MULTIPLE_CHOICE ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {q.options?.map((opt, oIdx) => (
                                  <div key={opt.label} className="flex items-center gap-3">
                                    <button
                                      type="button"
                                      onClick={() => updateManualQuestion(q.id, { correctAnswer: opt.label })}
                                      className={cn(
                                        "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs transition-all",
                                        q.correctAnswer === opt.label ? "bg-emerald-500 text-white" : "bg-white/10 text-zinc-500 hover:bg-white/20"
                                      )}
                                    >
                                      {opt.label}
                                    </button>
                                    <input 
                                      required
                                      value={opt.text}
                                      onChange={(e) => {
                                        const newOptions = [...(q.options || [])];
                                        newOptions[oIdx] = { ...opt, text: e.target.value };
                                        updateManualQuestion(q.id, { options: newOptions });
                                      }}
                                      className="flex-1 bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-sm focus:border-red-500 outline-none transition-colors"
                                      placeholder={`Option ${opt.label}`}
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div>
                                <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Correct Answer</label>
                                <input 
                                  required
                                  value={q.correctAnswer}
                                  onChange={(e) => updateManualQuestion(q.id, { correctAnswer: e.target.value })}
                                  className="w-full bg-black border border-white/10 rounded-lg px-4 py-3 focus:border-red-500 outline-none transition-colors"
                                  placeholder="Enter the correct answer..."
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <button 
                        type="button"
                        onClick={addManualQuestion}
                        className="w-full py-4 border-2 border-dashed border-white/10 rounded-2xl text-zinc-500 hover:border-red-500/50 hover:text-white transition-all flex items-center justify-center gap-2"
                      >
                        <Plus className="w-5 h-5" /> Add Question
                      </button>
                    </div>

                    {error && <p className="text-red-500 text-sm font-medium">{error}</p>}

                    <button 
                      type="submit" 
                      className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-red-600/20"
                    >
                      Save Manual Test
                    </button>
                  </form>
                )}
              </div>
            </motion.div>
          )}

          {view === 'test-taking' && activeTest && (
            <motion.div 
              key="test-taking"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="max-w-4xl mx-auto"
            >
              <div className="sticky top-20 z-40 bg-black/80 backdrop-blur-md p-4 mb-8 rounded-xl border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-red-600/20 rounded-lg flex items-center justify-center font-bold text-red-500">
                    {currentQuestionIndex + 1}
                  </div>
                  <div>
                    <h2 className="font-bold text-lg leading-tight">{activeTest.title}</h2>
                    <p className="text-xs text-zinc-500">Question {currentQuestionIndex + 1} of {activeTest.questions.length}</p>
                  </div>
                </div>
                {!isPreviewMode && (
                  <div className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg font-mono font-bold",
                    timeLeft < 60 ? "bg-rose-500/20 text-rose-500 animate-pulse" : "bg-white/5 text-white"
                  )}>
                    <Clock className="w-4 h-4" />
                    {formatTime(timeLeft)}
                  </div>
                )}
                {isPreviewMode && (
                  <span className="px-3 py-1 bg-amber-500/20 text-amber-500 text-xs font-bold rounded-full uppercase tracking-wider">Preview Mode</span>
                )}
              </div>

              <div className="space-y-8">
                <div className="q-card p-8 min-h-[400px] flex flex-col">
                  <div className="flex-grow">
                    <h3 className="text-2xl font-medium leading-relaxed mb-8">
                      {activeTest.questions[currentQuestionIndex].text}
                    </h3>
                    
                    {activeTest.questions[currentQuestionIndex].type === QuestionType.MULTIPLE_CHOICE ? (
                      <div className="grid grid-cols-1 gap-3">
                        {activeTest.questions[currentQuestionIndex].options?.map(opt => (
                          <button
                            key={opt.label}
                            onClick={() => setAnswers({ ...answers, [activeTest.questions[currentQuestionIndex].id]: opt.label })}
                            className={cn(
                              "flex items-center gap-4 p-5 rounded-xl border transition-all text-left",
                              answers[activeTest.questions[currentQuestionIndex].id] === opt.label 
                                ? "bg-red-600/10 border-red-600 text-white" 
                                : "bg-white/5 border-white/5 text-zinc-400 hover:border-white/20 hover:bg-white/10"
                            )}
                          >
                            <span className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold",
                              answers[activeTest.questions[currentQuestionIndex].id] === opt.label ? "bg-red-600 text-white" : "bg-white/10 text-zinc-500"
                            )}>
                              {opt.label}
                            </span>
                            <span className="font-medium text-lg">{opt.text}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4">
                        <input 
                          type="text"
                          value={answers[activeTest.questions[currentQuestionIndex].id] || ''}
                          onChange={(e) => setAnswers({ ...answers, [activeTest.questions[currentQuestionIndex].id]: e.target.value })}
                          className="w-full bg-black border border-white/10 rounded-xl px-6 py-4 text-xl focus:border-red-500 outline-none transition-colors"
                          placeholder="Type your answer here..."
                          autoFocus
                        />
                      </div>
                    )}
                  </div>

                  <div className="mt-12 flex items-center justify-between pt-8 border-t border-white/5">
                    <button
                      disabled={currentQuestionIndex === 0}
                      onClick={() => handleQuestionChange(currentQuestionIndex - 1)}
                      className="px-6 py-3 rounded-xl font-bold text-zinc-400 hover:text-white hover:bg-white/5 transition-all disabled:opacity-0"
                    >
                      Previous
                    </button>
                    
                    {currentQuestionIndex === activeTest.questions.length - 1 ? (
                      <button 
                        onClick={handleTestSubmit}
                        className="bg-red-600 hover:bg-red-500 text-white font-bold px-10 py-3 rounded-xl transition-all shadow-xl shadow-red-600/20"
                      >
                        {isPreviewMode ? 'Close Preview' : 'Submit Test'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleQuestionChange(currentQuestionIndex + 1)}
                        className="bg-white text-black hover:bg-zinc-200 font-bold px-10 py-3 rounded-xl transition-all"
                      >
                        Next Question
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap justify-center gap-2">
                  {activeTest.questions.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleQuestionChange(idx)}
                      className={cn(
                        "w-10 h-10 rounded-lg font-bold text-xs transition-all border",
                        currentQuestionIndex === idx 
                          ? "bg-red-600 border-red-600 text-white scale-110 shadow-lg shadow-red-600/20" 
                          : answers[activeTest.questions[idx].id]
                            ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-500"
                            : "bg-white/5 border-white/10 text-zinc-500 hover:border-white/30"
                      )}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {view === 'result-view' && activeResult && (
            <motion.div 
              key="result-view"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="max-w-4xl mx-auto"
            >
              <div className="q-card p-12 text-center mb-8 bg-gradient-to-b from-white/5 to-transparent">
                <div className="mb-6">
                  {activeResult.score >= 80 ? (
                    <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                    </div>
                  ) : activeResult.score >= 50 ? (
                    <div className="w-20 h-20 bg-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                      <BarChart3 className="w-12 h-12 text-amber-500" />
                    </div>
                  ) : (
                    <div className="w-20 h-20 bg-rose-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                      <XCircle className="w-12 h-12 text-rose-500" />
                    </div>
                  )}
                </div>
                <h2 className="text-5xl font-black mb-2">{activeResult.score}%</h2>
                <p className="text-zinc-500 mb-8 uppercase tracking-widest font-bold">Test Completed</p>
                
                <div className="grid grid-cols-3 gap-4 max-w-md mx-auto mb-12">
                  <div className="p-4 bg-white/5 rounded-xl">
                    <p className="text-xs text-zinc-500 mb-1">Correct</p>
                    <p className="text-xl font-bold text-emerald-500">{activeResult.correctCount}</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-xl">
                    <p className="text-xs text-zinc-500 mb-1">Incorrect</p>
                    <p className="text-xl font-bold text-rose-500">{activeResult.totalQuestions - activeResult.correctCount}</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-xl">
                    <p className="text-xs text-zinc-500 mb-1">Total</p>
                    <p className="text-xl font-bold">{activeResult.totalQuestions}</p>
                  </div>
                </div>

                {activeResult.aiFeedback && (
                  <div className="bg-red-600/5 border border-red-600/20 rounded-2xl p-8 text-left mb-8">
                    <h3 className="flex items-center gap-2 font-bold text-red-500 mb-4">
                      <BrainCircuit className="w-5 h-5" /> AI Study Insight
                    </h3>
                    <p className="text-zinc-300 leading-relaxed italic">"{activeResult.aiFeedback}"</p>
                  </div>
                )}

                {activeResult.teacherFeedback && (
                  <div className="bg-emerald-600/5 border border-emerald-600/20 rounded-2xl p-8 text-left mb-8">
                    <h3 className="flex items-center gap-2 font-bold text-emerald-500 mb-4">
                      <GraduationCap className="w-5 h-5" /> Teacher's Advice
                    </h3>
                    <p className="text-zinc-300 leading-relaxed">"{activeResult.teacherFeedback}"</p>
                  </div>
                )}

                {user?.role === 'teacher' && (
                  <div className="q-card p-8 text-left mb-8">
                    <h3 className="font-bold mb-4">Provide Feedback to Student</h3>
                    <textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-xl p-4 mb-4 focus:border-red-500 outline-none transition-colors"
                      placeholder="Write your advice here..."
                      rows={3}
                    />
                    <button
                      onClick={() => handleSaveFeedback(activeResult.id)}
                      className="bg-red-600 hover:bg-red-500 text-white font-bold px-6 py-2 rounded-lg transition-all"
                    >
                      Save Feedback
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap justify-center gap-4">
                  <button 
                    onClick={() => setView(user?.role === 'teacher' ? 'teacher-dash' : 'student-dash')}
                    className="bg-white text-black font-bold px-8 py-3 rounded-xl hover:bg-zinc-200 transition-all"
                  >
                    Back to Dashboard
                  </button>
                  <button 
                    onClick={() => window.print()}
                    className="flex items-center gap-2 bg-zinc-900 border border-white/10 text-white font-bold px-8 py-3 rounded-xl hover:bg-zinc-800 transition-all"
                  >
                    <Download className="w-4 h-4" /> Export PDF
                  </button>
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="text-xl font-bold px-4">Review Answers</h3>
                {activeResult.questionsSnapshot.map((q, idx) => (
                  <div key={q.id} className="q-card p-8">
                    <div className="flex justify-between items-start mb-6">
                      <div className="flex gap-4">
                        <span className="flex-shrink-0 w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center font-bold text-zinc-500">{idx + 1}</span>
                        <h3 className="text-xl font-medium leading-relaxed">{q.text}</h3>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-zinc-500 bg-white/5 px-3 py-1 rounded-full">
                        <Clock className="w-3 h-3" /> {activeResult.timePerQuestion?.[q.id] || 0}s
                      </div>
                    </div>

                    {q.type === QuestionType.MULTIPLE_CHOICE ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-12 mb-6">
                        {q.options?.map(opt => {
                          const isUserAnswer = activeResult.userAnswers[q.id] === opt.label;
                          const isCorrect = q.correctAnswer === opt.label;
                          return (
                            <div
                              key={opt.label}
                              className={cn(
                                "flex items-center gap-4 p-4 rounded-xl border transition-all",
                                isCorrect ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" :
                                isUserAnswer ? "bg-rose-500/10 border-rose-500 text-rose-500" :
                                "bg-white/5 border-white/5 text-zinc-500"
                              )}
                            >
                              <span className={cn(
                                "w-6 h-6 rounded flex items-center justify-center text-xs font-bold",
                                isCorrect ? "bg-emerald-500 text-white" :
                                isUserAnswer ? "bg-rose-500 text-white" :
                                "bg-white/10 text-zinc-600"
                              )}>
                                {opt.label}
                              </span>
                              <span className="font-medium">{opt.text}</span>
                              {isCorrect && <CheckCircle2 className="w-4 h-4 ml-auto" />}
                              {isUserAnswer && !isCorrect && <XCircle className="w-4 h-4 ml-auto" />}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="ml-12 mb-6 space-y-3">
                        <div className={cn(
                          "p-4 rounded-xl border flex items-center justify-between",
                          activeResult.userAnswers[q.id] === q.correctAnswer 
                            ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" 
                            : "bg-rose-500/10 border-rose-500 text-rose-500"
                        )}>
                          <div>
                            <p className="text-xs opacity-50 mb-1">Your Answer</p>
                            <p className="font-bold">{activeResult.userAnswers[q.id] || '(No Answer)'}</p>
                          </div>
                          {activeResult.userAnswers[q.id] === q.correctAnswer ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                        </div>
                        {activeResult.userAnswers[q.id] !== q.correctAnswer && (
                          <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-500">
                            <p className="text-xs opacity-50 mb-1">Correct Answer</p>
                            <p className="font-bold">{q.correctAnswer}</p>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="ml-12">
                      {explanations[q.id] ? (
                        <div className="bg-white/5 rounded-xl p-6 border border-white/10">
                          <p className="text-sm text-zinc-400 leading-relaxed italic">
                            <span className="text-red-500 font-bold not-italic mr-2">AI Explanation:</span>
                            {explanations[q.id]}
                          </p>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleExplain(q, activeResult.userAnswers[q.id] || '')}
                          disabled={isExplaining === q.id}
                          className="flex items-center gap-2 text-xs font-bold text-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
                        >
                          {isExplaining === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <BrainCircuit className="w-3 h-3" />}
                          Explain this question
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Edit Confirmation Modal */}
        <AnimatePresence>
          {showEditConfirm && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="q-card max-w-md w-full p-8 border-red-500/50"
              >
                <div className="w-16 h-16 bg-red-600/20 rounded-2xl flex items-center justify-center mb-6">
                  <AlertTriangle className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-2xl font-bold mb-4">Confirm Test Changes</h3>
                <p className="text-zinc-400 mb-8 leading-relaxed">
                  Warning: Modifying an existing test will affect how historical student results are displayed. 
                  Previous submissions might not align perfectly with the new version of the test.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button 
                    onClick={() => pendingSaveData && performSave(pendingSaveData)}
                    className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-xl transition-all"
                  >
                    Confirm & Save
                  </button>
                  <button 
                    onClick={() => { setShowEditConfirm(false); setPendingSaveData(null); }}
                    className="flex-1 bg-white/5 hover:bg-white/10 text-white font-bold py-3 rounded-xl transition-all border border-white/10"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}

          {showAnalytics && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
              >
                <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
                  <div>
                    <h3 className="text-2xl font-bold">Test Analytics</h3>
                    <p className="text-sm text-zinc-500">{tests.find(t => t.id === showAnalytics)?.title}</p>
                  </div>
                  <button onClick={() => setShowAnalytics(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="flex-grow overflow-y-auto p-8">
                  {(() => {
                    const stats = getTestAnalytics(showAnalytics);
                    if (!stats) return <p className="text-center text-zinc-500 py-12">No data available for this test yet.</p>;

                    return (
                      <div className="space-y-12">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                          <div className="q-card p-6 bg-white/5 border-white/10">
                            <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold mb-2">Avg. Score</p>
                            <p className={cn("text-3xl font-black", getScoreColor(stats.avgScore))}>{stats.avgScore}%</p>
                          </div>
                          <div className="q-card p-6 bg-white/5 border-white/10">
                            <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold mb-2">Submissions</p>
                            <p className="text-3xl font-black text-white">{stats.totalSubmissions}</p>
                          </div>
                          <div className="q-card p-6 bg-white/5 border-white/10">
                            <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold mb-2">Most Difficult</p>
                            <p className="text-sm font-bold text-rose-500 line-clamp-2">{stats.mostDifficult.text}</p>
                            <p className="text-xs text-zinc-500 mt-1">{stats.mostDifficult.accuracy}% Accuracy</p>
                          </div>
                          <div className="q-card p-6 bg-white/5 border-white/10">
                            <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold mb-2">Longest Time</p>
                            <p className="text-sm font-bold text-amber-500 line-clamp-2">{stats.longestTime.text}</p>
                            <p className="text-xs text-zinc-500 mt-1">{stats.longestTime.avgTime}s Average</p>
                          </div>
                        </div>

                        <div className="space-y-6">
                          <h4 className="text-xl font-bold flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-red-500" /> Question Performance
                          </h4>
                          <div className="space-y-4">
                            {stats.questionStats.map((q, idx) => (
                              <div key={q.id} className="q-card p-6 bg-white/5 border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-6">
                                <div className="flex gap-4 min-w-0">
                                  <span className="flex-shrink-0 w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center font-bold text-zinc-500">{idx + 1}</span>
                                  <p className="font-medium text-zinc-300 line-clamp-2">{q.text}</p>
                                </div>
                                <div className="flex items-center gap-8 flex-shrink-0">
                                  <div className="text-center">
                                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Accuracy</p>
                                    <p className={cn("font-black", getScoreColor(q.accuracy))}>{q.accuracy}%</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Avg Time</p>
                                    <p className="font-black text-white">{q.avgTime}s</p>
                                  </div>
                                  <div className="text-center">
                                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-1">Attempts</p>
                                    <p className="font-black text-white">{q.attempts}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      <footer className="border-t border-white/5 py-12 px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2 opacity-50">
            <BrainCircuit className="w-5 h-5" />
            <span className="font-bold tracking-tight">QuickStudy AI</span>
          </div>
          <p className="text-zinc-600 text-sm">© 2026 QuickStudy LMS. All rights reserved.</p>
          <div className="flex gap-6 text-zinc-600 text-sm font-medium">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
