
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Question, Theme, ViewState, User, Test, TestResult } from './types';
import { generateQuestionsWithGemini, getAIStudyFeedback } from './services/geminiService';

const App: React.FC = () => {
  // Navigation & Auth
  const [view, setView] = useState<ViewState>('home');
  const [role, setRole] = useState<'teacher' | 'student' | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [theme, setTheme] = useState<Theme>(Theme.LIGHT);
  
  // Data Persistence
  const [tests, setTests] = useState<Test[]>([]);
  const [results, setResults] = useState<TestResult[]>([]);
  
  // Workflow State
  const [activeTest, setActiveTest] = useState<Test | null>(null);
  const [activeResult, setActiveResult] = useState<TestResult | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editTestId, setEditTestId] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);

  // Initialize Data
  useEffect(() => {
    const savedTests = localStorage.getItem('qs_tests');
    const savedResults = localStorage.getItem('qs_results');
    const savedTheme = localStorage.getItem('theme') as Theme;

    if (savedTests) setTests(JSON.parse(savedTests));
    if (savedResults) setResults(JSON.parse(savedResults));
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === Theme.DARK);
    }
  }, []);

  useEffect(() => localStorage.setItem('qs_tests', JSON.stringify(tests)), [tests]);
  useEffect(() => localStorage.setItem('qs_results', JSON.stringify(results)), [results]);

  // Timer logic
  useEffect(() => {
    if (view === 'test-taking' && timeLeft > 0) {
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
  }, [view, timeLeft]);

  // --- Helpers ---

  const groupedResults = useMemo(() => {
    const groups: Record<string, TestResult[]> = {};
    results.forEach(res => {
      const date = new Date(res.timestamp).toLocaleDateString(undefined, { dateStyle: 'long' });
      if (!groups[date]) groups[date] = [];
      groups[date].push(res);
    });
    return Object.entries(groups).sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime());
  }, [results]);

  const toggleTheme = () => {
    const newTheme = theme === Theme.LIGHT ? Theme.DARK : Theme.LIGHT;
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === Theme.DARK);
  };

  // --- Handlers ---

  const handleLogin = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const id = formData.get('id') as string;
    const password = formData.get('password') as string;

    if (role === 'teacher' && password !== '1996') {
      setError('Incorrect Teacher Password.');
      return;
    }

    setUser({ id, name, role: role! });
    setError(null);
    setView(role === 'teacher' ? 'teacher-dash' : 'student-dash');
  };

  const handleSaveTest = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = formData.get('text') as string;
    const count = Number(formData.get('count'));
    const time = Number(formData.get('timer'));
    const title = formData.get('title') as string;

    setIsGenerating(true);
    setError(null);

    try {
      if (editTestId) {
        // Edit existing
        setTests(prev => prev.map(t => t.id === editTestId ? { 
          ...t, 
          title, 
          timerMinutes: time, 
          lastModified: Date.now() 
        } : t));
        setEditTestId(null);
        setView('teacher-dash');
      } else {
        // Generate new
        const qs = await generateQuestionsWithGemini(text, count);
        const newTest: Test = {
          id: `t-${Date.now()}`,
          title,
          questions: qs,
          createdAt: Date.now(),
          timerMinutes: time,
          creatorId: user!.id
        };
        setTests([newTest, ...tests]);
        setView('teacher-dash');
      }
    } catch (err) {
      setError('Operation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const deleteTest = (id: string) => {
    if (confirm('Are you sure you want to delete this test? History will remain.')) {
      setTests(tests.filter(t => t.id !== id));
    }
  };

  const startTest = (test: Test) => {
    setActiveTest(test);
    setAnswers({});
    setTimeLeft(test.timerMinutes * 60);
    setView('test-taking');
  };

  const handleTestSubmit = async () => {
    if (!activeTest) return;

    let correct = 0;
    activeTest.questions.forEach(q => {
      if (answers[q.id] === q.correctAnswer) correct++;
    });

    const score = Math.round((correct / activeTest.questions.length) * 100);
    const feedback = await getAIStudyFeedback(score, activeTest.questions.filter(q => answers[q.id] !== q.correctAnswer).map(q => q.text).slice(0,3));

    const result: TestResult = {
      id: `r-${Date.now()}`,
      testId: activeTest.id,
      testTitle: activeTest.title,
      studentId: user!.id,
      studentName: user!.name,
      score,
      totalQuestions: activeTest.questions.length,
      correctCount: correct,
      timestamp: Date.now(),
      userAnswers: { ...answers },
      aiFeedback: feedback
    };

    setResults([result, ...results]);
    setActiveResult(result);
    setView('result-view');
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500 bg-green-50 dark:bg-green-900/20';
    if (score >= 50) return 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20';
    return 'text-red-500 bg-red-50 dark:bg-red-900/20';
  };

  // --- Components ---

  const QuestionLayout = ({ question, index, selected, onSelect, isReview = false, correctAnswer = '' }: any) => (
    <div className="q-card p-5 mb-4 border-none shadow-sm overflow-hidden">
      <div className="flex gap-4">
        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center font-bold text-sm">
          {index + 1}
        </span>
        <div className="flex-grow">
          <p className="text-lg font-medium mb-4 leading-snug">{question.text}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {question.options.map((opt: any) => {
              const isUserChoice = selected === opt.label;
              const isCorrect = opt.label === correctAnswer;
              
              let style = "border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800";
              if (isReview) {
                if (isCorrect) style = "bg-green-100 border-green-500 dark:bg-green-900/30 text-green-700 dark:text-green-300";
                else if (isUserChoice && !isCorrect) style = "bg-red-100 border-red-500 dark:bg-red-900/30 text-red-700 dark:text-red-300";
              } else if (isUserChoice) {
                style = "border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ring-2 ring-blue-500/20";
              }

              return (
                <button
                  key={opt.label}
                  disabled={isReview}
                  onClick={() => onSelect(opt.label)}
                  className={`flex items-start gap-3 p-3 text-left border rounded-xl transition-all duration-200 ${style}`}
                >
                  <span className="font-black text-xs opacity-40 mt-0.5">{opt.label}.</span>
                  <span className="text-sm font-medium">{opt.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  const ReviewDetailModal = () => {
    if (!activeResult) return null;
    const test = tests.find(t => t.id === activeResult.testId) || { questions: [] };
    
    return (
      <div className="animate-in fade-in zoom-in-95 max-w-4xl mx-auto py-6">
        <button onClick={() => setView(user?.role === 'teacher' ? 'teacher-dash' : 'student-dash')} className="mb-4 text-blue-500 font-bold flex items-center gap-1">
          ← Back to Dashboard
        </button>
        <div className="q-card p-6 mb-6">
          <div className="flex justify-between items-end">
            <div>
              <h2 className="text-2xl font-bold">{activeResult.studentName}'s Performance</h2>
              <p className="opacity-60 text-sm">{activeResult.testTitle} • {new Date(activeResult.timestamp).toLocaleString()}</p>
            </div>
            <div className={`px-4 py-2 rounded-xl font-black text-2xl ${getScoreColor(activeResult.score)}`}>
              {activeResult.score}%
            </div>
          </div>
        </div>
        <div className="space-y-4">
          {test.questions.map((q, i) => (
            <QuestionLayout 
              key={q.id} 
              question={q} 
              index={i} 
              selected={activeResult.userAnswers[q.id]} 
              isReview={true} 
              correctAnswer={q.correctAnswer} 
            />
          ))}
        </div>
      </div>
    );
  };

  const TeacherDash = () => (
    <div className="space-y-10 animate-in fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-black tracking-tight">Management Console</h2>
          <p className="opacity-50 text-sm">Create, edit and track exams</p>
        </div>
        <button onClick={() => { setEditTestId(null); setView('test-creator'); }} className="px-6 py-3 bg-[var(--primary)] text-white rounded-2xl font-bold shadow-lg shadow-blue-500/20 hover:scale-105 transition-transform">+ New Test</button>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-4">
          <h3 className="text-xs font-black uppercase tracking-widest opacity-40">Active Exams</h3>
          {tests.length === 0 ? <p className="opacity-30 italic text-sm py-8 border-2 border-dashed rounded-2xl text-center">Empty Repository</p> : tests.map(t => (
            <div key={t.id} className="q-card p-5 group">
              <div className="flex justify-between items-start mb-3">
                <h4 className="font-bold">{t.title}</h4>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditTestId(t.id); setView('test-creator'); }} title="Edit" className="p-2 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg text-blue-500">✎</button>
                  <button onClick={() => deleteTest(t.id)} title="Delete" className="p-2 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg text-red-500">✕</button>
                </div>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="opacity-50">{t.questions.length} Questions • {t.timerMinutes}m</span>
                <button onClick={() => { setActiveTest(t); setView('test-taking'); }} className="text-blue-500 font-bold hover:underline">Preview Exam</button>
              </div>
            </div>
          ))}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <h3 className="text-xs font-black uppercase tracking-widest opacity-40">Historical Attendee Grouping</h3>
          <div className="space-y-8">
            {groupedResults.length === 0 ? <p className="opacity-30 italic py-10 text-center">No student data yet.</p> : groupedResults.map(([date, items]) => (
              <section key={date}>
                <div className="sticky top-0 bg-[var(--bg)] py-2 z-10">
                  <h4 className="text-sm font-bold text-blue-600 dark:text-blue-400 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                    {date}
                    <span className="ml-auto text-[10px] bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 rounded-full">{items.length} Students</span>
                  </h4>
                </div>
                <div className="mt-4 grid gap-3">
                  {items.map(r => (
                    <div 
                      key={r.id} 
                      onClick={() => { setActiveResult(r); setView('review-detail'); }}
                      className="q-card p-4 flex items-center justify-between cursor-pointer hover:border-blue-500/30 transition-all border-l-4 border-l-blue-500"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center font-black text-sm uppercase">
                          {r.studentName.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-sm leading-none">{r.studentName}</p>
                          <p className="text-[10px] opacity-50 mt-1 uppercase tracking-tighter">{r.testTitle} • {new Date(r.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                        </div>
                      </div>
                      <div className={`px-3 py-1 rounded-lg text-xs font-black ${getScoreColor(r.score)}`}>
                        {r.correctCount}/{r.totalQuestions} ({r.score}%)
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const StudentDash = () => (
    <div className="space-y-8 animate-in fade-in">
      <div className="bg-gradient-to-br from-indigo-600 to-blue-700 p-10 rounded-[2.5rem] text-white shadow-2xl shadow-blue-500/20">
        <h2 className="text-4xl font-black mb-2">Hello, {user?.name.split(' ')[0]}!</h2>
        <p className="opacity-80 font-medium">Your learning journey continues. Choose a test below to start.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-10">
        <section>
          <h3 className="text-xs font-black uppercase tracking-widest opacity-40 mb-6">Your History</h3>
          <div className="space-y-3">
            {results.filter(r => r.studentId === user?.id).map(r => (
              <div 
                key={r.id} 
                onClick={() => { setActiveResult(r); setView('review-detail'); }}
                className="q-card p-5 flex justify-between items-center cursor-pointer border-l-4 border-l-green-500 hover:scale-[1.01] transition-transform"
              >
                <div>
                  <h4 className="font-bold">{r.testTitle}</h4>
                  <p className="text-[10px] opacity-50">{new Date(r.timestamp).toLocaleString()}</p>
                </div>
                <div className={`px-3 py-1 rounded-lg font-black ${getScoreColor(r.score)}`}>
                  {r.score}%
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-black uppercase tracking-widest opacity-40 mb-6">Open Exams</h3>
          <div className="grid gap-4">
            {tests.map(t => (
              <div key={t.id} className="q-card p-6 flex flex-col items-center text-center gap-4">
                <div>
                  <h4 className="text-xl font-bold">{t.title}</h4>
                  <p className="text-sm opacity-50 mt-1">{t.questions.length} questions • {t.timerMinutes} mins</p>
                </div>
                <button onClick={() => startTest(t)} className="w-full py-3 bg-[var(--primary)] text-white rounded-2xl font-bold shadow-lg shadow-blue-500/20">Take Exam</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );

  // --- Main Render ---

  return (
    <div className="min-h-screen pb-20">
      <nav className="max-w-6xl mx-auto p-6 flex justify-between items-center">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('home')}>
          <div className="w-10 h-10 bg-[var(--primary)] rounded-xl flex items-center justify-center text-white font-black shadow-lg shadow-blue-500/20">Q</div>
          <span className="font-black text-2xl tracking-tighter">QuickStudy</span>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <div className="text-right hidden sm:block mr-2">
              <p className="text-sm font-black leading-none">{user.name}</p>
              <p className="text-[10px] opacity-40 uppercase font-bold tracking-widest">{user.role}</p>
            </div>
          )}
          <button onClick={toggleTheme} className="w-10 h-10 rounded-xl bg-[var(--card)] shadow-sm flex items-center justify-center border">
            {theme === Theme.LIGHT ? '🌙' : '☀️'}
          </button>
          {user && <button onClick={() => window.location.reload()} className="text-xs font-bold opacity-40 hover:opacity-100">Logout</button>}
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 mt-6">
        {view === 'home' && (
          <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-12">
            <div className="space-y-6">
              <h1 className="text-7xl font-black tracking-tight leading-none bg-gradient-to-b from-[var(--text)] to-[var(--text)] opacity-90 bg-clip-text text-transparent">
                Adaptive Assessment.<br/><span className="text-blue-600">Perfect Results.</span>
              </h1>
              <p className="text-lg opacity-60 max-w-lg mx-auto font-medium">
                The world's first AI-powered LMS for rapid assessment and detailed performance tracking.
              </p>
            </div>
            <div className="flex gap-4 w-full max-w-lg">
              <button onClick={() => { setRole('teacher'); setView('login'); }} className="flex-1 h-16 bg-blue-600 text-white rounded-[1.25rem] font-black text-lg shadow-2xl shadow-blue-600/30 hover:scale-105 transition-all">Teacher Login</button>
              <button onClick={() => { setRole('student'); setView('login'); }} className="flex-1 h-16 bg-[var(--card)] border-2 rounded-[1.25rem] font-black text-lg hover:scale-105 transition-all">Student Portal</button>
            </div>
          </div>
        )}

        {view === 'login' && (
          <div className="max-w-md mx-auto py-12">
            <div className="q-card p-10">
              <h2 className="text-3xl font-black mb-2 leading-none">{role === 'teacher' ? 'Admin Access' : 'Student Access'}</h2>
              <p className="text-sm opacity-50 mb-8 font-medium">Please enter your credentials to continue</p>
              <form onSubmit={handleLogin} className="space-y-5">
                <input required name="name" type="text" className="w-full h-14 px-5 rounded-2xl bg-gray-50 dark:bg-gray-800 border outline-none focus:border-blue-500 font-medium" placeholder="Full Name" />
                <input required name="id" type="text" className="w-full h-14 px-5 rounded-2xl bg-gray-50 dark:bg-gray-800 border outline-none focus:border-blue-500 font-medium" placeholder="ID Number" />
                {role === 'teacher' && <input required name="password" type="password" className="w-full h-14 px-5 rounded-2xl bg-gray-50 dark:bg-gray-800 border outline-none focus:border-blue-500 font-medium" placeholder="Security Passphrase" />}
                {error && <p className="text-red-500 text-sm font-bold">{error}</p>}
                <button type="submit" className="w-full h-14 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-lg">Authenticate</button>
                <button type="button" onClick={() => setView('home')} className="w-full text-center text-sm font-bold opacity-40">Cancel</button>
              </form>
            </div>
          </div>
        )}

        {view === 'teacher-dash' && <TeacherDash />}
        {view === 'student-dash' && <StudentDash />}
        {view === 'review-detail' && <ReviewDetailModal />}

        {view === 'test-creator' && (
          <div className="max-w-3xl mx-auto py-8">
            <h2 className="text-4xl font-black mb-8">{editTestId ? 'Edit Exam Settings' : 'Draft New Exam'}</h2>
            <form onSubmit={handleSaveTest} className="q-card p-10 space-y-8">
              <div className="space-y-2">
                <label className="text-sm font-black uppercase tracking-widest opacity-40">Test Information</label>
                <input required name="title" defaultValue={tests.find(t => t.id === editTestId)?.title} className="w-full h-14 px-5 rounded-2xl bg-gray-50 dark:bg-gray-800 border outline-none focus:border-blue-500 font-bold text-xl" placeholder="E.g. Midterm Physics 2025" />
              </div>
              
              {!editTestId && (
                <div className="space-y-2">
                  <label className="text-sm font-black uppercase tracking-widest opacity-40">Learning Material</label>
                  <textarea required name="text" className="w-full h-64 p-5 rounded-2xl bg-gray-50 dark:bg-gray-800 border outline-none focus:border-blue-500 resize-none font-medium leading-relaxed" placeholder="Paste your study content here... AI will generate questions based on this." />
                </div>
              )}

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-black uppercase tracking-widest opacity-40">Questions</label>
                  <input required type="number" name="count" defaultValue={10} min={5} max={50} disabled={!!editTestId} className="w-full h-14 px-5 rounded-2xl bg-gray-50 dark:bg-gray-800 border outline-none focus:border-blue-500 font-bold" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-black uppercase tracking-widest opacity-40">Duration (Min)</label>
                  <input required type="number" name="timer" defaultValue={tests.find(t => t.id === editTestId)?.timerMinutes || 15} min={1} max={120} className="w-full h-14 px-5 rounded-2xl bg-gray-50 dark:bg-gray-800 border outline-none focus:border-blue-500 font-bold" />
                </div>
              </div>
              
              {error && <p className="text-red-500 font-bold">{error}</p>}

              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setView('teacher-dash')} className="flex-1 font-bold h-14">Discard</button>
                <button disabled={isGenerating} type="submit" className="flex-[2] h-14 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-500/20">
                  {isGenerating ? 'AI Working...' : editTestId ? 'Save Changes' : 'Generate & Publish'}
                </button>
              </div>
            </form>
          </div>
        )}

        {view === 'test-taking' && activeTest && (
          <div className="max-w-3xl mx-auto pb-32">
             <header className="sticky top-0 bg-[var(--bg)]/80 backdrop-blur-xl py-6 z-50 flex justify-between items-center mb-8 border-b">
                <div>
                  <h3 className="font-black text-2xl tracking-tight">{activeTest.title}</h3>
                  <p className="text-xs font-bold opacity-40 uppercase tracking-widest">Question {Object.keys(answers).length + 1} of {activeTest.questions.length}</p>
                </div>
                <div className={`px-6 py-3 rounded-2xl font-mono text-xl font-black ${timeLeft < 60 ? 'bg-red-500 text-white animate-pulse' : 'bg-[var(--card)] border shadow-sm'}`}>
                  {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
                </div>
             </header>
             <div className="space-y-6">
                {activeTest.questions.map((q, i) => (
                  <QuestionLayout 
                    key={q.id} 
                    question={q} 
                    index={i} 
                    selected={answers[q.id]} 
                    onSelect={(label: string) => setAnswers({...answers, [q.id]: label})} 
                  />
                ))}
             </div>
             <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[var(--bg)] to-transparent pointer-events-none">
                <div className="max-w-3xl mx-auto pointer-events-auto">
                  <button onClick={handleTestSubmit} className="w-full h-16 bg-blue-600 text-white rounded-[1.25rem] font-black text-xl shadow-2xl shadow-blue-600/40 transform hover:scale-[1.02] active:scale-95 transition-all">Submit Final Answers</button>
                </div>
             </div>
          </div>
        )}

        {view === 'result-view' && activeResult && (
          <div className="max-w-xl mx-auto py-20 text-center animate-in zoom-in-95">
             <div className="w-32 h-32 rounded-[2.5rem] bg-blue-600 text-white flex items-center justify-center text-4xl font-black mx-auto mb-8 shadow-2xl shadow-blue-600/30">
               {activeResult.score}%
             </div>
             <h2 className="text-4xl font-black tracking-tight mb-2">Well Done, {user?.name.split(' ')[0]}!</h2>
             <p className="opacity-50 font-medium mb-12">Your score has been successfully reported to the staff dashboard for review.</p>
             
             <div className="bg-blue-50 dark:bg-blue-900/20 p-8 rounded-3xl text-left border border-blue-100 dark:border-blue-800 mb-10">
               <h4 className="font-black text-blue-700 dark:text-blue-400 text-xs uppercase tracking-widest mb-4 flex items-center gap-2">
                 <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                 AI Mentor Feedback
               </h4>
               <p className="text-sm font-medium leading-relaxed opacity-80 whitespace-pre-line">{activeResult.aiFeedback}</p>
             </div>

             <div className="flex flex-col gap-3">
               <button onClick={() => setView('review-detail')} className="w-full h-14 border-2 rounded-2xl font-black">Review My Answers</button>
               <button onClick={() => setView('student-dash')} className="w-full h-14 bg-gray-900 text-white dark:bg-white dark:text-gray-900 rounded-2xl font-black shadow-lg">Back to Home</button>
             </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
