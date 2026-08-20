import React, { useState } from 'react';
import { 
  Lock, LogOut, ArrowLeft, Moon, Share2, Bell, 
  BookOpen, Calculator, Globe, FlaskConical, 
  Rocket, Send, MessageCircle, Youtube, PlayCircle,
  FileText, Medal, Compass, ShieldCheck, Key
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

let app, auth, db, appId;
try {
  const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
} catch (e) {
  console.error("Firebase init error", e);
}

async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function App() {
  // नेविगेशन स्टेट्स: 'login', 'dashboard', 'batch_detail', 'external_batch_detail', 'admin_login', 'admin_panel'
  const [currentScreen, setCurrentScreen] = useState('login');
  const [isChecking, setIsChecking] = useState(true);
  const [validHash, setValidHash] = useState('');
  const [adminHash, setAdminHash] = useState('');
  const [user, setUser] = useState(null);

  React.useEffect(() => {
    if (!auth) {
       setIsChecking(false);
       return;
    }
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error", error);
        setIsChecking(false);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  React.useEffect(() => {
    if (!user || !db) return;

    const configDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'config', 'security');
    
    const setupSecurity = async () => {
       try {
         // Default Fallback Hashes
         const defaultWebHash = await hashString("PrinceVidya2.0");
         const defaultAdminHash = await hashString("admin123"); 
         
         // Optimistically set the default hashes so offline mode still works
         setValidHash(defaultWebHash);
         setAdminHash(defaultAdminHash);
         
         const docSnap = await getDoc(configDocRef);
         if (!docSnap.exists()) {
            // First time setup: Save defaults to Firestore
            await setDoc(configDocRef, {
               websitePasswordHash: defaultWebHash,
               adminPasswordHash: defaultAdminHash
            });
         }
       } catch (e) {
         console.error("Firestore setup error", e);
         // Unblock the UI if Firestore is completely offline or times out
         setIsChecking(false);
       }
    };
    
    setupSecurity();

    // Listen for password changes dynamically
    const unsubscribe = onSnapshot(configDocRef, (docSnap) => {
       if (docSnap.exists()) {
          const data = docSnap.data();
          setValidHash(data.websitePasswordHash);
          setAdminHash(data.adminPasswordHash);
          
          // Verify current session
          const sessionToken = sessionStorage.getItem('site_access_token');
          if (sessionToken && sessionToken !== data.websitePasswordHash) {
             // Password was changed by admin, force logout everyone except active admin panel
             setCurrentScreen(prev => (prev === 'admin_panel' || prev === 'admin_login') ? prev : 'login');
          } else if (sessionToken === data.websitePasswordHash && currentScreen === 'login') {
             setCurrentScreen('dashboard');
          }
       }
       setIsChecking(false);
    }, (error) => {
       console.error("Snapshot error", error);
       setIsChecking(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleUnlock = (hash) => {
    sessionStorage.setItem('site_access_token', hash);
    setCurrentScreen('dashboard');
  };

  const handleLogout = () => {
    sessionStorage.removeItem('site_access_token');
    setCurrentScreen('login');
  };

  if (isChecking) return <div className="w-full h-screen bg-[#131722]" />;

  return (
    <div className="w-full h-screen bg-gray-100 font-sans sm:flex sm:items-center sm:justify-center">
      {/* मोबाइल व्यू कंटेनर */}
      <div className="w-full h-full sm:max-w-md sm:h-[850px] sm:rounded-3xl sm:shadow-2xl overflow-hidden relative bg-black">
        {currentScreen === 'login' && (
          <LoginScreen onUnlock={handleUnlock} validHash={validHash} />
        )}
        
        {currentScreen === 'dashboard' && (
          <DashboardScreen 
            onLogout={handleLogout} 
            onOpenBatch={() => setCurrentScreen('batch_detail')} 
            onOpenExternalBatch={() => setCurrentScreen('external_batch_detail')}
            onOpenAdmin={() => setCurrentScreen('admin_login')}
          />
        )}
        
        {currentScreen === 'batch_detail' && (
          <BatchDetailScreen onBack={() => setCurrentScreen('dashboard')} />
        )}

        {currentScreen === 'external_batch_detail' && (
          <ExternalBatchDetailScreen 
            onBack={() => setCurrentScreen('dashboard')} 
            onOpenIframe={() => setCurrentScreen('iframe_view')}
          />
        )}

        {currentScreen === 'iframe_view' && (
          <IframeViewScreen 
            url="https://pwthor.live/study/batches/6958da951f4f3345aa9cbc35"
            onBack={() => setCurrentScreen('external_batch_detail')} 
          />
        )}

        {currentScreen === 'admin_login' && (
           <AdminLoginScreen 
             onBack={() => setCurrentScreen('dashboard')}
             onLoginSuccess={() => setCurrentScreen('admin_panel')}
             adminHash={adminHash}
           />
        )}

        {currentScreen === 'admin_panel' && (
           <AdminPanelScreen 
             onBack={() => setCurrentScreen('dashboard')}
           />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// 1. Login Screen Component
// ---------------------------------------------------------
function LoginScreen({ onUnlock, validHash }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    setIsLoading(true);
    setError('');
    try {
      const hashHex = await hashString(password);

      // Verify hash against the secure valid hash
      if (hashHex === validHash) {
        onUnlock(hashHex);
      } else {
        setError('गलत पासवर्ड। कृपया पुनः प्रयास करें।');
      }
    } catch (err) {
      setError('सिस्टम त्रुटि।');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-full w-full bg-[#131722] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative Background */}
      <div className="absolute top-[-10%] left-[-10%] w-64 h-64 bg-blue-600/10 rounded-full blur-[80px]"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-64 h-64 bg-purple-600/10 rounded-full blur-[80px]"></div>

      <div className="w-full max-w-sm space-y-8 relative z-10">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-blue-500/20 mb-2">
            <BookOpen size={40} className="text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-300 tracking-wide">Vidya Learning</h1>
          <p className="text-gray-400 text-sm font-medium tracking-wide">Enter Password</p>
        </div>

        <div className="space-y-6">
          <div className="space-y-2 relative">
            <input 
              type="password" 
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••"
              className={`w-full bg-[#1E2330]/80 backdrop-blur-sm border ${error ? 'border-red-500' : 'border-blue-500/30'} rounded-xl px-5 py-4 text-white focus:outline-none focus:border-blue-500 transition-all tracking-[0.3em] text-center text-xl shadow-inner`}
            />
            {error && <p className="text-red-400 text-[12px] font-medium text-center mt-2 absolute -bottom-6 left-0 right-0">{error}</p>}
          </div>

          <button 
            onClick={handleLogin}
            disabled={isLoading || !password}
            className="w-full mt-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl py-4 font-bold flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(59,130,246,0.2)] transition-all active:scale-[0.98]"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Lock size={18} className="text-blue-100" />
                Unlock Website
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// 2. Dashboard Screen Component
// ---------------------------------------------------------
function DashboardScreen({ onLogout, onOpenBatch, onOpenExternalBatch, onOpenAdmin }) {
  return (
    <div className="h-full w-full bg-[#0F131A] text-white overflow-y-auto pb-8">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center">
            <BookOpen size={16} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400">
            विद्या लर्निंग
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onOpenAdmin} className="w-8 h-8 flex items-center justify-center bg-gray-800 text-gray-400 rounded-full hover:text-white border border-gray-700 transition-colors">
            <ShieldCheck size={14} />
          </button>
          <button onClick={onLogout} className="flex items-center gap-1.5 text-xs bg-red-500/10 text-red-400 px-3 py-1.5 rounded-full font-medium border border-red-500/20 hover:bg-red-500/20 transition-colors">
            <Lock size={12} /> Lock
          </button>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Hero Section */}
        <div className="text-center space-y-4 py-6">
          <div className="inline-block border border-green-500/30 bg-green-500/10 text-green-400 text-xs px-3 py-1 rounded-full font-medium">
            ● 100% मुफ्त • प्रीमियम कोर्सेज उपलब्ध
          </div>
          <h1 className="text-4xl font-extrabold leading-tight">
            <span className="text-gray-200">स्मार्ट</span> <span className="text-blue-500">पढ़ाई,</span><br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-blue-500">बिल्कुल मुफ्त।</span>
          </h1>
          <p className="text-gray-400 text-sm px-2">
            विद्या लर्निंग के साथ भारत के सर्वश्रेष्ठ शिक्षकों से प्रीमियम कोर्सेज प्राप्त करें - वो भी बिना किसी शुल्क के। एक ही जगह पर सब कुछ।
          </p>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <ActionButton icon={<Rocket size={20} className="text-purple-400" />} text="ऐप्स एक्सप्लोर करें" />
          <ActionButton icon={<Send size={20} className="text-blue-400" />} text="टेलीग्राम चैनल से जुड़ें" />
          <ActionButton icon={<MessageCircle size={20} className="text-green-400" />} text="व्हाट्सएप चैनल से जुड़ें" />
          <ActionButton icon={<Youtube size={20} className="text-red-400" />} text="यूट्यूब सब्सक्राइब करें" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 pt-4">
          <StatBox value="100+" label="बैचेस" />
          <StatBox value="1" label="प्लेटफॉर्म" />
          <StatBox value="₹0" label="कीमत" />
          <StatBox value="24/7" label="एक्सेस" />
        </div>

        {/* External Premium Batch Integration */}
        <div className="pt-6">
          <h3 className="text-xs text-indigo-400 font-bold tracking-widest uppercase mb-1">प्रीमियम इंटीग्रेशन</h3>
          <h2 className="text-2xl font-bold mb-4">एक्सटर्नल बैचेस</h2>
          
          <div 
            onClick={onOpenExternalBatch}
            className="bg-gradient-to-br from-indigo-900 to-[#1A202C] border border-indigo-500/30 rounded-2xl p-4 cursor-pointer active:scale-[0.98] transition-transform shadow-lg relative overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full -mr-10 -mt-10 blur-2xl"></div>
            <div className="flex gap-4 relative z-10">
              <div className="w-14 h-14 bg-gradient-to-tr from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md">
                <Rocket size={24} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white leading-tight">उड़ान Class 10th</h3>
                <p className="text-indigo-200 text-xs mt-1.5 leading-relaxed line-clamp-2">
                  प्रोफेशनल क्लास 10 बैच। ओरिजिनल प्लेटफॉर्म पर सम्पूर्ण कोर्सेज और क्लास एक्सेस करें।
                </p>
                <div className="mt-3 inline-flex items-center gap-1.5 bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-[10px] px-2.5 py-1 rounded-full font-medium">
                  एक्सटर्नल लिंक
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon, text }) {
  return (
    <button className="w-full bg-[#1A202C] border border-gray-700 hover:border-gray-500 text-white rounded-xl py-3.5 px-4 flex items-center justify-center gap-3 transition-colors shadow-sm">
      {icon}
      <span className="font-medium text-sm">{text}</span>
    </button>
  );
}

function StatBox({ value, label }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold text-white">{value}</div>
      <div className="text-[10px] text-gray-400 font-medium uppercase mt-0.5">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------
// 3. Batch Detail Screen Component
// ---------------------------------------------------------
function BatchDetailScreen({ onBack }) {
  return (
    <div className="h-full w-full bg-[#F3F4F6] text-gray-900 overflow-y-auto flex flex-col relative">
      
      {/* Top App Bar */}
      <div className="sticky top-0 bg-white/80 backdrop-blur-md z-10 flex items-center justify-between p-3 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 hover:bg-gray-100 rounded-full">
            <ArrowLeft size={22} className="text-gray-700" />
          </button>
          <span className="font-medium text-lg">पीछे जाएँ</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full text-xs font-bold border border-yellow-200">
            ⭐ 0 XP
          </div>
          <button className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-full">
            <Moon size={20} />
          </button>
          <div className="w-8 h-8 bg-purple-100 border border-purple-200 rounded-full flex items-center justify-center text-purple-700 font-bold text-sm">
            VM
          </div>
        </div>
      </div>

      <div className="p-4 space-y-5">
        
        {/* Course Banner */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-5 text-white shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mt-10 blur-xl"></div>
          <h2 className="text-2xl font-bold leading-tight relative z-10">
            उड़ान बिहार बोर्ड 2027<br/>
            (हिन्दी माध्यम)
          </h2>
          <p className="mt-2 text-indigo-100 font-medium text-sm relative z-10">Class 10th</p>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto hide-scrollbar gap-6 border-b border-gray-200 pb-2">
          <TabItem icon={<FileText size={18} />} label="विवरण" active={true} />
          <TabItem icon={<PlayCircle size={18} />} label="सभी कक्षाएं" />
          <TabItem icon={<FileText size={18} />} label="टेस्ट्स" />
          <TabItem icon={<Compass size={18} />} label="इन्फिनिटी लर्निंग" />
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button className="bg-white border border-gray-200 rounded-xl p-2.5 flex items-center justify-center gap-2 shadow-sm font-medium text-sm text-gray-700">
            <Share2 size={16} /> बैच शेयर करें
          </button>
          <button className="bg-white border border-gray-200 rounded-xl p-2.5 flex items-center justify-center gap-2 shadow-sm font-medium text-sm text-gray-700">
            <Bell size={16} className="text-red-500" /> घोषणाएं
          </button>
        </div>

        {/* Today's Class */}
        <div className="space-y-3">
          <h3 className="font-bold text-lg">आज की कक्षाएं</h3>
          
          {/* Horizontal Scroll for Classes */}
          <div className="flex overflow-x-auto hide-scrollbar gap-4 pb-2">
            <ClassCard 
              teacher="निधि पांडेय मैम" 
              status="UPCOMING" 
              time="04:00 PM" 
              topic="हमारा पर्यावरण 02 : आहार श्रृंखला, ऊर्जा प्रवाह..." 
            />
            {/* If no classes, it would look like this:
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-500 text-sm font-medium shadow-sm w-full">
              अभी कोई क्लास शेड्यूल नहीं है
            </div>
            */}
          </div>
        </div>

        {/* Subjects List */}
        <div className="space-y-3 pb-6">
          <h3 className="font-bold text-lg">विषय</h3>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
            <SubjectItem icon={<Bell className="text-blue-500" size={24} />} title="सूचनाएं (Notices)" subtitle="12 चैप्टर्स" />
            <SubjectItem icon={<FlaskConical className="text-purple-500" size={24} />} title="विज्ञान (Science)" subtitle="11 चैप्टर्स" />
            <SubjectItem icon={<Calculator className="text-teal-500" size={24} />} title="गणित (Maths)" subtitle="12 चैप्टर्स" />
            <SubjectItem icon={<BookOpen className="text-indigo-500" size={24} />} title="अंग्रेज़ी (English)" subtitle="24 चैप्टर्स" />
            <SubjectItem icon={<BookOpen className="text-orange-500" size={24} />} title="हिंदी (Hindi)" subtitle="25 चैप्टर्स" />
            <SubjectItem icon={<Globe className="text-red-400" 
