import React, { useState, useRef, useEffect } from 'react';
import { Search, Download, Loader2, BookOpen, Languages, Quote, Image as ImageIcon, Sparkles, Upload, FileText, X, Plus, History, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { fetchWordDetails, generateWordImage, extractWordsFromMedia, type WordData } from './lib/gemini';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface FileProgress {
  id: string;
  name: string;
  status: 'pending' | 'extracting' | 'processing' | 'completed' | 'error';
  current: number;
  total: number;
}

export default function App() {
  const [word, setWord] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WordData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [fileQueue, setFileQueue] = useState<FileProgress[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load history from localStorage
  useEffect(() => {
    const savedHistory = localStorage.getItem('word_explorer_history');
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
  }, []);

  const addToHistory = (newWord: string) => {
    const updatedHistory = [newWord, ...history.filter(w => w !== newWord)].slice(0, 10);
    setHistory(updatedHistory);
    localStorage.setItem('word_explorer_history', JSON.stringify(updatedHistory));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('word_explorer_history');
  };

  const handleSearch = async (e?: React.FormEvent, searchWord?: string) => {
    if (e) e.preventDefault();
    const targetWord = (searchWord || word).trim();
    if (!targetWord) return;

    setWord(targetWord);
    setLoading(true);
    setError(null);
    setResults([]);
    setShowHistory(false);

    try {
      const [details, imageUrl] = await Promise.all([
        fetchWordDetails(targetWord),
        generateWordImage(targetWord)
      ]);

      setResults([{
        ...details,
        imageUrl
      }]);
      addToHistory(targetWord);
    } catch (err) {
      console.error(err);
      setError('Failed to fetch word details. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const processFile = async (file: File) => {
    const fileId = Math.random().toString(36).substr(2, 9);
    const newFileProgress: FileProgress = {
      id: fileId,
      name: file.name,
      status: 'extracting',
      current: 0,
      total: 0
    };

    setFileQueue(prev => [...prev, newFileProgress]);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      reader.readAsDataURL(file);
      const base64Data = await base64Promise;

      const extractedWords = await extractWordsFromMedia(base64Data, file.type);
      
      if (extractedWords.length === 0) {
        setFileQueue(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error' } : f));
        return [];
      }

      const uniqueWords = Array.from(new Set(extractedWords)).slice(0, 10);
      setFileQueue(prev => prev.map(f => f.id === fileId ? { ...f, status: 'processing', total: uniqueWords.length } : f));

      // Sequential processing for words within a file to avoid rate limits
      const processedResults: WordData[] = [];
      for (const currentWord of uniqueWords) {
        try {
          // Add a small delay between words to be extra safe with rate limits
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const [details, imageUrl] = await Promise.all([
            fetchWordDetails(currentWord),
            generateWordImage(currentWord)
          ]);
          processedResults.push({ ...details, imageUrl });
        } catch (err) {
          console.warn(`Failed to process word: ${currentWord}`, err);
        }
        setFileQueue(prev => prev.map(f => f.id === fileId ? { ...f, current: f.current + 1 } : f));
      }

      setFileQueue(prev => prev.map(f => f.id === fileId ? { ...f, status: 'completed' } : f));
      return processedResults;
    } catch (err) {
      console.error(err);
      setFileQueue(prev => prev.map(f => f.id === fileId ? { ...f, status: 'error' } : f));
      return [];
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    setLoading(true);
    setError(null);
    setResults([]);
    setFileQueue([]);

    try {
      const allProcessedResults: WordData[] = [];
      
      // Process files sequentially to avoid hitting rate limits
      for (const file of files) {
        const fileResults = await processFile(file);
        allProcessedResults.push(...fileResults);
      }

      setResults(allProcessedResults);
    } catch (err) {
      console.error(err);
      setError('An error occurred during bulk processing.');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const downloadPDF = async () => {
    if (!resultsRef.current || results.length === 0) return;

    try {
      const pdf = new jsPDF('p', 'mm', 'a4');
      const elements = resultsRef.current.children;
      
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i] as HTMLElement;
        const canvas = await html2canvas(element, {
          useCORS: true,
          scale: 2,
          backgroundColor: '#ffffff'
        });
        
        const imgData = canvas.toDataURL('image/png');
        const imgWidth = 190; // A4 width minus margins
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'PNG', 10, 10, imgWidth, imgHeight);
      }

      pdf.save(`word-explorer-collection.pdf`);
    } catch (err) {
      console.error('PDF generation failed:', err);
      alert('Failed to generate PDF. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100 pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <h1 className="font-bold text-xl tracking-tight text-slate-800">WordExplorer</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="p-2 text-slate-400 hover:text-indigo-600 transition-colors relative"
              title="Search History"
            >
              <History className="w-5 h-5" />
              {history.length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-indigo-500 rounded-full border-2 border-white" />
              )}
            </button>
            <button
              onClick={() => setBulkMode(!bulkMode)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                bulkMode ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {bulkMode ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {bulkMode ? 'Single Word' : 'Bulk Upload'}
            </button>
          </div>
        </div>

        {/* History Dropdown */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-16 right-4 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl p-4 z-40"
            >
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Recent Searches</h4>
                {history.length > 0 && (
                  <button onClick={clearHistory} className="text-xs text-red-500 hover:underline flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {history.length > 0 ? (
                  history.map((h, i) => (
                    <button
                      key={i}
                      onClick={() => handleSearch(undefined, h)}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition-colors capitalize"
                    >
                      {h}
                    </button>
                  ))
                ) : (
                  <p className="text-center py-4 text-slate-400 text-sm italic">No history yet</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Search Section */}
        <section className="mb-12">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-extrabold text-slate-900 mb-2">
              {bulkMode ? 'Bulk Word Extraction' : 'Discover the Depth of Words'}
            </h2>
            <p className="text-slate-500">
              {bulkMode 
                ? 'Upload a PDF or Image to extract and analyze multiple words at once.' 
                : 'Get synonyms, meanings, examples, and visual representations instantly.'}
            </p>
          </div>

          <AnimatePresence mode="wait">
            {!bulkMode ? (
              <motion.form
                key="single"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                onSubmit={handleSearch}
                className="relative max-w-2xl mx-auto"
              >
                <input
                  type="text"
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  placeholder="Enter a word (e.g., Serendipity, Resilience...)"
                  className="w-full h-14 pl-14 pr-32 bg-white border-2 border-slate-200 rounded-2xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50/50 outline-none transition-all text-lg font-medium shadow-sm"
                  disabled={loading}
                />
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 w-6 h-6" />
                <button
                  type="submit"
                  disabled={loading || !word.trim()}
                  className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl font-semibold transition-colors flex items-center gap-2"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Explore'}
                </button>
              </motion.form>
            ) : (
              <motion.div
                key="bulk"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-2xl mx-auto"
              >
                <div 
                  onClick={() => !loading && fileInputRef.current?.click()}
                  className={`group relative border-2 border-dashed rounded-3xl p-12 text-center transition-all ${
                    loading ? 'border-slate-200 bg-slate-50 cursor-not-allowed' : 'border-slate-300 hover:border-indigo-500 hover:bg-indigo-50/30 cursor-pointer'
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="application/pdf,image/*"
                    multiple
                    className="hidden"
                  />
                  <div className="bg-white w-16 h-16 rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                    <Upload className="w-8 h-8 text-indigo-600" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800 mb-1">Click to upload PDFs or Images</h3>
                  <p className="text-slate-500 text-sm">You can select multiple files at once.</p>
                </div>

                {fileQueue.length > 0 && (
                  <div className="mt-8 space-y-3">
                    <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Processing Queue</h4>
                    {fileQueue.map((file) => (
                      <div key={file.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <FileText className={`w-5 h-5 shrink-0 ${file.status === 'error' ? 'text-red-500' : 'text-indigo-500'}`} />
                            <span className="font-medium text-slate-700 truncate">{file.name}</span>
                          </div>
                          <span className={`text-xs font-bold px-2 py-1 rounded-full uppercase ${
                            file.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                            file.status === 'error' ? 'bg-red-100 text-red-700' :
                            'bg-indigo-100 text-indigo-700'
                          }`}>
                            {file.status}
                          </span>
                        </div>
                        {file.status === 'processing' && (
                          <div className="space-y-1">
                            <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                              <span>Processing Words</span>
                              <span>{file.current} / {file.total}</span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <motion.div 
                                className="h-full bg-indigo-500"
                                initial={{ width: 0 }}
                                animate={{ width: `${(file.current / file.total) * 100}%` }}
                              />
                            </div>
                          </div>
                        )}
                        {file.status === 'extracting' && (
                          <div className="flex items-center gap-2 text-xs text-slate-400 italic">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Extracting words...
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Results Section */}
        <AnimatePresence mode="wait">
          {loading && fileQueue.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center py-20 text-slate-400"
            >
              <div className="relative">
                <Loader2 className="w-12 h-12 animate-spin text-indigo-600" />
                <Sparkles className="w-6 h-6 absolute -top-2 -right-2 text-indigo-400 animate-pulse" />
              </div>
              <p className="mt-4 font-medium animate-pulse">Analyzing and generating visuals...</p>
            </motion.div>
          )}

          {error && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl text-center font-medium"
            >
              {error}
            </motion.div>
          )}

          {results.length > 0 && !loading && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8"
            >
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  {results.length} {results.length === 1 ? 'Result' : 'Results'} Found
                </h3>
                <button
                  onClick={downloadPDF}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all font-semibold shadow-lg shadow-indigo-200"
                >
                  <Download className="w-4 h-4" />
                  Download All as PDF
                </button>
              </div>

              <div ref={resultsRef} className="space-y-12">
                {results.map((result, idx) => (
                  <div 
                    key={idx}
                    className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden p-8 md:p-12"
                  >
                    <div className="grid md:grid-cols-2 gap-12">
                      {/* Text Content */}
                      <div className="space-y-8">
                        <div>
                          <span className="text-indigo-600 font-bold tracking-widest uppercase text-xs">Word Analysis</span>
                          <h3 className="text-5xl font-black text-slate-900 mt-2 capitalize">{result.word}</h3>
                        </div>

                        <div className="space-y-6">
                          <div className="flex gap-4">
                            <div className="mt-1 bg-indigo-50 p-2 rounded-lg shrink-0">
                              <Languages className="w-5 h-5 text-indigo-600" />
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-800 mb-1 text-sm">Bengali Meaning</h4>
                              <p className="text-xl text-slate-600 font-medium">{result.bengaliMeaning}</p>
                            </div>
                          </div>

                          <div className="flex gap-4">
                            <div className="mt-1 bg-amber-50 p-2 rounded-lg shrink-0">
                              <Sparkles className="w-5 h-5 text-amber-600" />
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-800 mb-1 text-sm">Synonyms</h4>
                              <p className="text-slate-600 leading-relaxed text-sm">{result.synonym}</p>
                            </div>
                          </div>

                          <div className="flex gap-4">
                            <div className="mt-1 bg-emerald-50 p-2 rounded-lg shrink-0">
                              <Quote className="w-5 h-5 text-emerald-600" />
                            </div>
                            <div>
                              <h4 className="font-bold text-slate-800 mb-1 text-sm">Example Usage</h4>
                              <p className="text-slate-600 italic leading-relaxed text-sm">"{result.example}"</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Image Content */}
                      <div className="relative group">
                        {result.imageUrl ? (
                          <div className="aspect-square rounded-2xl overflow-hidden shadow-2xl shadow-indigo-100 border-4 border-white">
                            <img 
                              src={result.imageUrl} 
                              alt={result.word} 
                              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        ) : (
                          <div className="aspect-square rounded-2xl bg-slate-100 flex flex-col items-center justify-center text-slate-400 gap-2 border-2 border-dashed border-slate-200">
                            <ImageIcon className="w-12 h-12" />
                            <p className="text-sm font-medium">Visual not available</p>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="mt-12 pt-8 border-t border-slate-100 flex justify-between items-center text-slate-400 text-xs font-medium uppercase tracking-widest">
                      <span>Generated by WordExplorer AI</span>
                      <span>{new Date().toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {results.length === 0 && !loading && (
          <div className="mt-20 flex flex-col items-center text-slate-300">
            <BookOpen className="w-20 h-20 mb-4 opacity-20" />
            <p className="text-lg font-medium">Your linguistic journey starts here.</p>
          </div>
        )}
      </main>

      <footer className="max-w-4xl mx-auto px-4 py-12 text-center text-slate-400 text-sm">
        <p>© {new Date().getFullYear()} WordExplorer. All rights reserved.</p>
      </footer>
    </div>
  );
}

