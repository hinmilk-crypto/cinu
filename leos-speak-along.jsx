import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Volume2, Mic, Square, Star } from 'lucide-react';

const PRESET_SENTENCES = [
  { emoji: '🐱', text: 'I like cats.' },
  { emoji: '☀️', text: 'The sun is hot.' },
  { emoji: '🎒', text: 'She has a red bag.' },
  { emoji: '🍎', text: 'I eat an apple every day.' },
  { emoji: '🐶', text: 'My dog can run fast.' },
  { emoji: '📚', text: 'He reads a book at night.' },
  { emoji: '🌧️', text: 'It is raining outside.' },
  { emoji: '🏫', text: 'We go to school by bus.' },
  { emoji: '🍕', text: 'I want to eat pizza.' },
  { emoji: '⚽', text: 'They play soccer after school.' },
];

const WORD_COLORS = ['#FF6B6B', '#4ECDC4', '#6C5CE7', '#FFA62B', '#2EC4B6', '#F45B69'];

export default function LeosSpeakAlong() {
  const [sentence, setSentence] = useState(PRESET_SENTENCES[0].text);
  const [customText, setCustomText] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeWordIdx, setActiveWordIdx] = useState(-1);
  const [isRecording, setIsRecording] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [wordMatches, setWordMatches] = useState([]);
  const [score, setScore] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [loadingAI, setLoadingAI] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const [micError, setMicError] = useState('');

  const recognitionRef = useRef(null);
  const fallbackTimerRef = useRef(null);
  const boundaryReceivedRef = useRef(false);

  const words = useMemo(() => sentence.trim().split(/\s+/).filter(Boolean), [sentence]);

  const wordBounds = useMemo(() => {
    const bounds = [];
    let from = 0;
    for (const w of words) {
      const idx = sentence.indexOf(w, from);
      const start = idx === -1 ? from : idx;
      bounds.push({ start, end: start + w.length });
      from = start + w.length;
    }
    return bounds;
  }, [sentence, words]);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) setMicSupported(false);
  }, []);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      if (recognitionRef.current) recognitionRef.current.stop();
      clearTimeout(fallbackTimerRef.current);
    };
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
    setActiveWordIdx(-1);
    clearTimeout(fallbackTimerRef.current);
  }, []);

  const runFallbackHighlight = useCallback((speakRate, wordCount) => {
    const perWord = Math.max(280, 420 / speakRate);
    let i = 0;
    const step = () => {
      setActiveWordIdx(i);
      i++;
      if (i < wordCount) {
        fallbackTimerRef.current = setTimeout(step, perWord);
      }
    };
    step();
  }, []);

  const speak = useCallback((speakRate) => {
    if (!('speechSynthesis' in window)) {
      alert('이 브라우저에서는 소리 듣기를 지원하지 않아요.');
      return;
    }
    window.speechSynthesis.cancel();
    setScore(null);
    setFeedback('');
    setWordMatches([]);
    setRecognizedText('');

    const utter = new SpeechSynthesisUtterance(sentence);
    utter.lang = 'en-US';
    utter.rate = speakRate;
    utter.pitch = 1.05;
    boundaryReceivedRef.current = false;

    utter.onstart = () => {
      setIsSpeaking(true);
      setActiveWordIdx(0);
      fallbackTimerRef.current = setTimeout(() => {
        if (!boundaryReceivedRef.current) {
          runFallbackHighlight(speakRate, words.length);
        }
      }, 350);
    };

    utter.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      boundaryReceivedRef.current = true;
      clearTimeout(fallbackTimerRef.current);
      const ci = e.charIndex;
      let idx = wordBounds.findIndex((b) => ci >= b.start && ci < b.end);
      if (idx === -1) {
        idx = wordBounds.findIndex((b) => ci <= b.start);
        if (idx === -1) idx = words.length - 1;
      }
      setActiveWordIdx(idx);
    };

    utter.onend = () => {
      setIsSpeaking(false);
      setActiveWordIdx(-1);
      clearTimeout(fallbackTimerRef.current);
    };
    utter.onerror = () => {
      setIsSpeaking(false);
      setActiveWordIdx(-1);
    };

    window.speechSynthesis.speak(utter);
  }, [sentence, wordBounds, words.length, runFallbackHighlight]);

  const normalize = (w) => w.toLowerCase().replace(/[^a-z']/g, '');

  const computeMatches = useCallback((spokenText) => {
    const target = words.map(normalize);
    const spoken = spokenText.trim().split(/\s+/).map(normalize).filter(Boolean);
    return target.map((tw, i) => spoken[i] === tw || spoken.includes(tw));
  }, [words]);

  const getLocalScore = (matches) => {
    if (matches.length === 0) return 0;
    const correct = matches.filter(Boolean).length;
    return Math.round((correct / matches.length) * 100);
  };

  const askAIForScore = async (spokenText) => {
    setLoadingAI(true);
    try {
      const prompt = `You are a kind, patient English teacher for a Korean middle school student who reads at an elementary level and learns slowly.
Target sentence: "${sentence}"
Student's speech-to-text result: "${spokenText}"
Compare how closely the student's spoken words match the target sentence (word choice and completeness). Give a whole-number score from 0 to 100. Then write ONE short, warm, encouraging sentence of feedback IN KOREAN using very simple, friendly words appropriate for a struggling middle schooler. Never sound negative or critical even if the score is low; always encourage trying again.
Respond with ONLY valid JSON and nothing else, no markdown fences: {"score": <number>, "feedback": "<Korean sentence>"}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await response.json();
      const text = data.content?.map((b) => b.text || '').join('') || '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      const s = Math.max(0, Math.min(100, Math.round(parsed.score)));
      setScore(s);
      setFeedback(parsed.feedback || '');
    } catch (err) {
      const matches = computeMatches(spokenText);
      const local = getLocalScore(matches);
      setScore(local);
      setFeedback(local >= 70 ? '아주 잘했어요! 계속 연습해요 😊' : '괜찮아요! 한 번 더 해볼까요? 💪');
    } finally {
      setLoadingAI(false);
    }
  };

  const startRecording = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setMicSupported(false);
      return;
    }
    setScore(null);
    setFeedback('');
    setWordMatches([]);
    setRecognizedText('');
    setMicError('');

    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsRecording(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setRecognizedText(transcript);
      const matches = computeMatches(transcript);
      setWordMatches(matches);
      askAIForScore(transcript);
    };
    recognition.onerror = (e) => {
      setMicError(e.error === 'not-allowed' ? '마이크 권한을 허용해주세요 🎤' : '다시 시도해봐요!');
      setIsRecording(false);
    };
    recognition.onend = () => setIsRecording(false);

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  };

  const handleSelectPreset = (text) => {
    stopSpeaking();
    setSentence(text);
    setScore(null);
    setFeedback('');
    setWordMatches([]);
    setRecognizedText('');
  };

  const handleCustomSubmit = () => {
    if (!customText.trim()) return;
    stopSpeaking();
    setSentence(customText.trim());
    setCustomText('');
    setScore(null);
    setFeedback('');
    setWordMatches([]);
    setRecognizedText('');
  };

  const scoreTier = (s) => {
    if (s === null) return null;
    if (s >= 90) return { stars: 3, label: '완벽해요!', emoji: '🏆' };
    if (s >= 70) return { stars: 2, label: '잘했어요!', emoji: '🎉' };
    if (s >= 50) return { stars: 1, label: '조금 더 연습해요!', emoji: '💪' };
    return { stars: 0, label: '다시 해볼까요?', emoji: '🌱' };
  };
  const tier = scoreTier(score);

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: 'linear-gradient(180deg, #FFE99A 0%, #FFC685 35%, #FF9F68 65%, #6FCF97 100%)',
        fontFamily: "'Nunito', sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Nunito:wght@400;700;800;900&display=swap');
        @keyframes bounce-word { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-8px) scale(1.08); } }
        @keyframes pop-in { 0% { transform: scale(0.4); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes wiggle { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
        .word-active { animation: bounce-word 0.55s ease-in-out infinite; }
        .mascot-wiggle { animation: wiggle 1.4s ease-in-out infinite; display: inline-block; }
        .star-pop { animation: pop-in 0.4s ease-out backwards; }
      `}</style>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-7xl mb-2 mascot-wiggle">🦁</div>
          <h1
            className="text-4xl sm:text-5xl font-extrabold"
            style={{ fontFamily: "'Fredoka', sans-serif", color: '#7A3E00', textShadow: '2px 2px 0px #FFF3D6' }}
          >
            Leo's Speak Along
          </h1>
          <p className="mt-2 text-lg font-bold" style={{ color: '#7A3E00' }}>
            문장을 고르고, 듣고, 따라 읽어봐요! 🎶
          </p>
        </div>

        {/* Sentence Picker */}
        <div className="rounded-3xl bg-white/90 p-4 mb-5 shadow-lg" style={{ border: '5px solid #FF6B6B' }}>
          <p className="font-extrabold text-xl mb-3" style={{ fontFamily: "'Fredoka', sans-serif", color: '#FF6B6B' }}>
            📖 문장 고르기
          </p>
          <div className="flex flex-wrap gap-2">
            {PRESET_SENTENCES.map((p) => (
              <button
                key={p.text}
                onClick={() => handleSelectPreset(p.text)}
                className="px-4 py-3 rounded-2xl font-bold text-base sm:text-lg transition-transform active:scale-95"
                style={{
                  background: sentence === p.text ? '#FF6B6B' : '#FFF1F1',
                  color: sentence === p.text ? 'white' : '#7A3E00',
                  border: '3px solid #FF6B6B',
                }}
              >
                {p.emoji} {p.text}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-3">
            <input
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCustomSubmit()}
              placeholder="내 문장을 써보세요 (영어)"
              className="flex-1 rounded-2xl px-4 py-3 text-lg font-bold outline-none"
              style={{ border: '3px solid #FFA62B', color: '#7A3E00' }}
            />
            <button
              onClick={handleCustomSubmit}
              className="px-4 py-3 rounded-2xl font-extrabold text-white active:scale-95"
              style={{ background: '#FFA62B', border: '3px solid #FF8C00' }}
            >
              추가
            </button>
          </div>
        </div>

        {/* Karaoke Display */}
        <div className="rounded-3xl bg-white/95 p-6 mb-5 shadow-lg" style={{ border: '5px solid #4ECDC4', minHeight: '160px' }}>
          <p className="font-extrabold text-xl mb-4" style={{ fontFamily: "'Fredoka', sans-serif", color: '#2A9D93' }}>
            🎤 노래방 자막
          </p>
          <div className="flex flex-wrap gap-3 justify-center items-center py-4">
            {words.map((w, i) => {
              const isActive = i === activeWordIdx;
              const hasResult = wordMatches.length === words.length;
              const isCorrect = hasResult ? wordMatches[i] : null;
              const color = WORD_COLORS[i % WORD_COLORS.length];
              return (
                <span
                  key={i}
                  className={`inline-block px-3 py-2 rounded-2xl font-extrabold text-3xl sm:text-4xl transition-all duration-200 ${isActive ? 'word-active' : ''}`}
                  style={{
                    fontFamily: "'Fredoka', sans-serif",
                    background: isActive ? color : hasResult ? (isCorrect ? '#D6FFEA' : '#FFE1E1') : '#F7F7F7',
                    color: isActive ? 'white' : hasResult ? (isCorrect ? '#1B9C6E' : '#E85555') : '#555',
                    border: `3px solid ${isActive ? color : hasResult ? (isCorrect ? '#4ECDC4' : '#FF9494') : '#DDD'}`,
                    boxShadow: isActive ? `0 6px 0 ${color}88` : 'none',
                  }}
                >
                  {w}
                </span>
              );
            })}
          </div>
        </div>

        {/* Controls */}
        <div className="rounded-3xl bg-white/90 p-5 mb-5 shadow-lg" style={{ border: '5px solid #6C5CE7' }}>
          <div className="flex flex-wrap gap-3 justify-center mb-3">
            <button
              onClick={() => (isSpeaking ? stopSpeaking() : speak(0.85))}
              className="flex items-center gap-2 px-6 py-4 rounded-full font-extrabold text-xl text-white active:scale-95"
              style={{
                background: isSpeaking ? '#999' : 'linear-gradient(135deg, #4ECDC4, #2A9D93)',
                boxShadow: '0 5px 0 #1B7A72',
              }}
            >
              {isSpeaking ? <Square size={24} /> : <Volume2 size={24} />} {isSpeaking ? '멈추기' : '들어보기'}
            </button>
            <button
              onClick={() => speak(0.5)}
              disabled={isSpeaking}
              className="flex items-center gap-2 px-6 py-4 rounded-full font-extrabold text-xl text-white active:scale-95 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #FFA62B, #FF8C00)', boxShadow: '0 5px 0 #C96A00' }}
            >
              🐢 천천히
            </button>
          </div>
          <div className="flex justify-center">
            {!isRecording ? (
              <button
                onClick={startRecording}
                disabled={!micSupported}
                className="flex items-center gap-2 px-8 py-4 rounded-full font-extrabold text-2xl text-white active:scale-95 disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #FF6B6B, #E84855)', boxShadow: '0 5px 0 #B8262F' }}
              >
                <Mic size={28} /> 따라 읽기
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-8 py-4 rounded-full font-extrabold text-2xl text-white active:scale-95 animate-pulse"
                style={{ background: 'linear-gradient(135deg, #E84855, #B8262F)', boxShadow: '0 5px 0 #7A1620' }}
              >
                <Square size={28} /> 그만할게요
              </button>
            )}
          </div>
          {!micSupported && (
            <p className="text-center mt-3 font-bold" style={{ color: '#B8262F' }}>
              이 브라우저에서는 마이크 기능을 지원하지 않아요 😢
            </p>
          )}
          {micError && (
            <p className="text-center mt-3 font-bold" style={{ color: '#B8262F' }}>
              {micError}
            </p>
          )}
          {isRecording && (
            <p className="text-center mt-3 font-bold text-lg" style={{ color: '#E84855' }}>
              🎙️ 듣고 있어요... 천천히 또박또박 말해봐요!
            </p>
          )}
        </div>

        {/* Score */}
        {(loadingAI || score !== null) && (
          <div className="rounded-3xl bg-white/95 p-6 mb-5 shadow-lg text-center" style={{ border: '5px solid #FFD166' }}>
            {loadingAI ? (
              <p className="font-extrabold text-xl" style={{ color: '#FF8C00' }}>
                🦁 잠깐만요... 확인하고 있어요!
              </p>
            ) : (
              <>
                <div className="text-6xl mb-2">{tier.emoji}</div>
                <p className="font-extrabold text-3xl mb-2" style={{ fontFamily: "'Fredoka', sans-serif", color: '#FF8C00' }}>
                  {tier.label}
                </p>
                <div className="flex justify-center gap-1 mb-3">
                  {[0, 1, 2].map((i) => (
                    <Star
                      key={i}
                      size={40}
                      className="star-pop"
                      style={{ animationDelay: `${i * 0.15}s` }}
                      fill={i < tier.stars ? '#FFD166' : 'none'}
                      color="#FFD166"
                    />
                  ))}
                </div>
                <p className="text-2xl font-black mb-2" style={{ color: '#2A9D93' }}>
                  {score}점
                </p>
                <p className="font-bold text-lg" style={{ color: '#7A3E00' }}>
                  {feedback}
                </p>
                {recognizedText && (
                  <p className="mt-3 text-base" style={{ color: '#999' }}>
                    내가 말한 것: "{recognizedText}"
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
