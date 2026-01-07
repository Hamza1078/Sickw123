import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// --- TYPES ---

interface Device {
  id: string;
  imei: string;
  imei2?: string;
  modelDesc: string;
  serial?: string;
  warrantyStatus?: string;
  icloudLock?: string; // "ON" | "OFF"
  carrier?: string; // Raw carrier string
  simLock?: string; // "Locked" | "Unlocked"
  estPurchaseDate?: string;
  activationStatus?: string; 
  rawText: string;
  group: 'Unlocked' | 'AT&T' | 'T-Mobile/Sprint' | 'Verizon' | 'Other';
  isActive: boolean;
}

interface CarrierGroup {
  name: string;
  devices: Device[];
  count: number;
}

interface FailedImage {
  id: string;
  file: File;
  previewUrl: string;
  suggestedImei?: string; // Added to store what AI read if it wasn't found in list
}

// --- STYLING CONSTANTS (iOS Liquid Glass) ---

const GLASS_CARD = "glass-panel bg-white/60 dark:bg-gray-900/60 border border-white/40 dark:border-white/10 shadow-xl rounded-3xl";
const GLASS_INPUT = "bg-white/50 dark:bg-black/30 backdrop-blur-md border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500/50 outline-none transition-all";
const GLASS_BUTTON_PRIMARY = "bg-blue-600/90 hover:bg-blue-600 text-white backdrop-blur-md shadow-lg shadow-blue-500/30 rounded-xl transition-all active:scale-95";
const GLASS_BUTTON_SECONDARY = "bg-white/50 dark:bg-white/10 hover:bg-white/80 dark:hover:bg-white/20 text-gray-800 dark:text-white border border-gray-200 dark:border-gray-700 backdrop-blur-md rounded-xl transition-all active:scale-95";

// --- PARSING LOGIC ---

const parseSickwHtml = (html: string): Device[] => {
  const devices: Device[] = [];
  const chunks = html.split('<b>IMEI: </b>');

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const imeiMatch = chunk.match(/^(\d{15})/);
    const imei = imeiMatch ? imeiMatch[1] : '';

    if (!imei) continue;

    const preMatch = chunk.match(/<pre>([\s\S]*?)<\/pre>/);
    if (!preMatch) continue;

    const preContent = preMatch[1];
    
    const getValue = (key: string): string => {
      const searchKey = key + ':';
      const idx = preContent.indexOf(searchKey);
      if (idx === -1) return '';

      const start = idx + searchKey.length;
      let end = preContent.indexOf('<br', start);
      if (end === -1) end = preContent.indexOf('\n', start);
      if (end === -1) end = preContent.length;

      let rawValue = preContent.substring(start, end);
      let cleanValue = rawValue.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      return cleanValue;
    };

    const modelDesc = getValue('Model Description');
    const imei2 = getValue('IMEI2');
    const serial = getValue('Serial Number');
    const warrantyStatus = getValue('Warranty Status');
    const icloudLock = getValue('iCloud Lock');
    const carrierRaw = getValue('Locked Carrier');
    const simLock = getValue('Sim-Lock Status');
    const estPurchaseDate = getValue('Estimated Purchase Date');
    const activationStatus = getValue('Activation Status');

    let group: Device['group'] = 'Other';
    const c = carrierRaw.toLowerCase();
    const s = simLock.toLowerCase();

    if (s.includes('unlocked') || c.includes('unlock') || c.includes('open policy')) {
        group = 'Unlocked';
    } else if (c.includes('t-mobile') || c.includes('sprint')) {
        group = 'T-Mobile/Sprint';
    } else if (c.includes('at&t')) {
        group = 'AT&T';
    } else if (c.includes('verizon')) {
        group = 'Verizon';
    }

    let isActive = false;
    if (activationStatus) {
      if (activationStatus.toLowerCase().includes('not activated')) {
        isActive = false;
      } else {
        isActive = true;
      }
    } else {
      if (estPurchaseDate) {
        const lowerDate = estPurchaseDate.toLowerCase();
        if (lowerDate.includes('not activated')) {
          isActive = false;
        } else if (/\b(19|20)\d{2}\b/.test(estPurchaseDate)) {
          isActive = true;
        }
      }
    }

    devices.push({
      id: `${imei}-${i}`,
      imei,
      imei2,
      modelDesc,
      serial,
      warrantyStatus,
      icloudLock: icloudLock.toUpperCase(),
      carrier: carrierRaw,
      simLock,
      estPurchaseDate,
      activationStatus,
      rawText: preContent,
      group,
      isActive
    });
  }
  return devices;
};

const generateExportText = (devices: Device[]): string => {
  const cleanModel = (name: string) => name.replace(/-USA/g, '').trim();
  const separator = "===============================";
  
  const formatList = (devs: Device[]) => {
    return devs.map(d => `${cleanModel(d.modelDesc)}\n${d.imei}\n${separator}`).join('\n');
  };

  let output = "";

  const icloud = devices.filter(d => d.icloudLock === 'ON');
  if (icloud.length > 0) {
    output += "*ICLOUD*\n\n" + formatList(icloud) + "\n\n";
  }

  const tmobileNonActive = devices.filter(d => d.icloudLock !== 'ON' && d.group === 'T-Mobile/Sprint' && !d.isActive);
  if (tmobileNonActive.length > 0) {
    output += "locked and non active tmoblie with network phone are like this with the device detetils,\n\n*LOCKED N NON ACTIVE T-MOBILE*\n\n" + formatList(tmobileNonActive) + "\n\n";
  }

  const tmobileActive = devices.filter(d => d.icloudLock !== 'ON' && d.group === 'T-Mobile/Sprint' && d.isActive);
  if (tmobileActive.length > 0) {
    output += "*LOCKED N ACTIVE T-MOBILE*\n\n" + formatList(tmobileActive) + "\n\n";
  }

  const lockedOtherNonActive = devices.filter(d => d.icloudLock !== 'ON' && d.group !== 'T-Mobile/Sprint' && d.group !== 'Unlocked' && !d.isActive);
  if (lockedOtherNonActive.length > 0) {
    output += "locked and non active other network phone are like this with the device detetils,\n\n*LOCKED N NON ACTIVE*\n\n" + formatList(lockedOtherNonActive) + "\n\n";
  }

  const lockedOtherActive = devices.filter(d => d.icloudLock !== 'ON' && d.group !== 'T-Mobile/Sprint' && d.group !== 'Unlocked' && d.isActive);
  if (lockedOtherActive.length > 0) {
    output += "*LOCKED N ACTIVE*\n\n" + formatList(lockedOtherActive) + "\n\n";
  }

  const unlockedNonActive = devices.filter(d => d.icloudLock !== 'ON' && d.group === 'Unlocked' && !d.isActive);
  if (unlockedNonActive.length > 0) {
    output += "unlocked and non active phone are like this with the device detetils,\n\nUNLOCKED N NON ACTIVE\n\n" + formatList(unlockedNonActive) + "\n\n";
  }

  const unlockedActive = devices.filter(d => d.icloudLock !== 'ON' && d.group === 'Unlocked' && d.isActive);
  if (unlockedActive.length > 0) {
    output += "unlocked and active phone like this device detetils,\n\nUNLOCKED N ACTIVE\n\n" + formatList(unlockedActive) + "\n\n";
  }

  return output.trim();
};

const getCleanDeviceDetails = (rawHtml: string): string => {
  return rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
};

// --- HELPER FUNCTIONS ---

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

// --- COMPONENTS ---

const FileUpload = ({ onUpload }: { onUpload: (devices: Device[]) => void }) => {
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        const parsed = parseSickwHtml(text);
        onUpload(parsed);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className={`flex flex-col items-center justify-center h-48 border-2 border-dashed border-blue-400/50 rounded-3xl ${GLASS_INPUT} hover:bg-blue-50/50 dark:hover:bg-blue-900/20 transition-all cursor-pointer relative group`}>
      <div className="text-center z-10 p-4">
        <svg className="mx-auto h-12 w-12 text-blue-500 group-hover:scale-110 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">
          Upload Sickw HTML
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Tap or Drag File Here</p>
      </div>
      <input type="file" accept=".html" onChange={handleFile} className="opacity-0 absolute w-full h-full cursor-pointer z-20" />
    </div>
  );
};

interface DeviceCardProps {
  device: Device; 
  onCopy: (text: string) => void;
  onViewDetails: (device: Device) => void;
}

const DeviceCard: React.FC<DeviceCardProps> = ({ device, onCopy, onViewDetails }) => {
  const statusColor = device.isActive 
    ? "bg-green-100/80 text-green-800 dark:bg-green-900/50 dark:text-green-300 border border-green-200/50" 
    : "bg-red-100/80 text-red-800 dark:bg-red-900/50 dark:text-red-300 border border-red-200/50";

  const icloudColor = device.icloudLock === "OFF"
    ? "bg-emerald-100/50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    : "bg-rose-100/50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 font-bold";

  return (
    <div className={`${GLASS_CARD} p-5 hover:scale-[1.02] transition-transform duration-300`}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1 pr-3">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white line-clamp-2 leading-tight">{device.modelDesc}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1 select-all">{device.imei}</p>
        </div>
        <div className="flex flex-col gap-2">
           <button 
            onClick={() => onCopy(`${device.modelDesc} ${device.imei}`)}
            className="p-2 rounded-xl bg-blue-100/50 hover:bg-blue-200/50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 transition-colors"
            title="Copy Info"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
          </button>
           <button 
            onClick={() => onViewDetails(device)}
            className="p-2 rounded-xl bg-gray-100/50 hover:bg-gray-200/50 dark:bg-gray-700/30 text-gray-600 dark:text-gray-300 transition-colors"
            title="Details"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          </button>
        </div>
      </div>
      
      <div className="flex flex-wrap gap-2 text-[10px] sm:text-xs items-center">
        <span className={`px-2.5 py-1 rounded-lg font-bold backdrop-blur-sm ${statusColor}`}>
          {device.isActive ? "ACTIVE" : "INACTIVE"}
        </span>
        <span className={`px-2.5 py-1 rounded-lg backdrop-blur-sm ${icloudColor}`}>
          iCloud: {device.icloudLock}
        </span>
        <span className="px-2.5 py-1 rounded-lg bg-gray-100/50 dark:bg-gray-700/30 text-gray-700 dark:text-gray-300 border border-gray-200/20 backdrop-blur-sm">
          {device.group}
        </span>
      </div>
    </div>
  );
};

const Modal = ({ isOpen, onClose, title, children }: any) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-fade-in">
      <div className={`${GLASS_CARD} w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden animate-slide-up`}>
        <div className="p-5 border-b border-gray-200/20 flex justify-between items-center bg-white/40 dark:bg-black/20 z-10">
          <h3 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            {title}
          </h3>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            <svg className="w-6 h-6 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

// --- IMAGE FIX MODAL ---
const ManualFixModal = ({ 
  failedImage, 
  onFix, 
  onSkip 
}: { 
  failedImage: FailedImage, 
  onFix: (imei: string) => void, 
  onSkip: () => void 
}) => {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [inputImei, setInputImei] = useState('');

  // Update input and zoom when the image changes
  useEffect(() => {
    setInputImei(failedImage.suggestedImei || '');
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [failedImage]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    const touch = e.touches[0];
    setDragStart({ x: touch.clientX - pan.x, y: touch.clientY - pan.y });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    setPan({ x: touch.clientX - dragStart.x, y: touch.clientY - dragStart.y });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  return (
    <Modal isOpen={true} onClose={onSkip} title={failedImage.suggestedImei ? "❓ Verification Needed" : "⚠️ AI Couldn't Read IMEI"}>
      <div className="flex flex-col gap-6">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {failedImage.suggestedImei 
            ? `AI read ${failedImage.suggestedImei}, but it wasn't found in the HTML file. Please verify the image.`
            : "The image was blurry or the AI wasn't sure. Please check the photo and enter the IMEI manually."
          }
        </p>
        
        <div 
          className="relative w-full h-80 bg-gray-100 dark:bg-gray-900 rounded-xl overflow-hidden flex items-center justify-center border border-gray-200 dark:border-gray-700 select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <img 
            src={failedImage.previewUrl} 
            alt="Failed scan" 
            className="transition-transform duration-75 object-contain h-full w-full"
            style={{ 
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              cursor: isDragging ? 'grabbing' : zoom > 1 ? 'grab' : 'default'
            }}
            draggable={false}
          />
          <div className="absolute bottom-4 right-4 flex gap-2 z-20" onMouseDown={(e) => e.stopPropagation()}>
             <button 
              onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(1, z - 0.5)); }} 
              className="bg-black/50 text-white w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md hover:bg-black/70 active:scale-90 transition-transform font-bold text-xl"
            >
              -
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(5, z + 0.5)); }} 
              className="bg-black/50 text-white w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md hover:bg-black/70 active:scale-90 transition-transform font-bold text-xl"
            >
              +
            </button>
          </div>
          <div className="absolute top-4 left-4 bg-black/40 text-white px-2 py-1 rounded-md text-xs backdrop-blur-md pointer-events-none">
             {zoom > 1 ? 'Drag to move' : 'Zoom to inspect'}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">Manual Entry</label>
          <input 
            type="text" 
            value={inputImei}
            onChange={(e) => setInputImei(e.target.value)}
            placeholder="Enter 15-digit IMEI"
            className={`w-full p-4 ${GLASS_INPUT} text-lg font-mono tracking-widest text-center`}
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onSkip} className={`flex-1 py-3 ${GLASS_BUTTON_SECONDARY}`}>Skip</button>
          <button 
            onClick={() => onFix(inputImei)} 
            disabled={inputImei.length < 15}
            className={`flex-1 py-3 ${GLASS_BUTTON_PRIMARY} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            Add IMEI
          </button>
        </div>
      </div>
    </Modal>
  );
};

// --- MAIN APP ---

const App = () => {
  // Data State
  const [devices, setDevices] = useState<Device[]>([]);
  const [view, setView] = useState<'upload' | 'dashboard'>('upload');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [bulkQuery, setBulkQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Device[] | null>(null);
  const [icloudAlertDevices, setIcloudAlertDevices] = useState<Device[]>([]);
  const [notFoundQueries, setNotFoundQueries] = useState<string[]>([]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  
  // Modals & UI State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportText, setExportText] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  
  // AI Image Processing State
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [manualFixQueue, setManualFixQueue] = useState<FailedImage[]>([]);

  // Theme Handling (System Sync)
  useEffect(() => {
    // Check local storage or system preference
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setIsDarkMode(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark');
      document.body.classList.remove('light');
    } else {
      document.body.classList.add('light');
      document.body.classList.remove('dark');
    }
  }, [isDarkMode]);

  // Derived Stats
  const stats = useMemo(() => {
    const total = devices.length;
    const activeCount = devices.filter(d => d.isActive).length;
    const inactiveCount = total - activeCount;
    return { total, activeCount, inactiveCount };
  }, [devices]);

  const handleUpload = (parsedDevices: Device[]) => {
    setDevices(parsedDevices);
    setView('dashboard');
  };

  // --- AI IMAGE LOGIC ---
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setIsProcessingImages(true);
    const files = Array.from(e.target.files);
    
    // Initialize Gemini
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const newImeis: string[] = [];
    const failed: FailedImage[] = [];

    for (const file of files) {
      try {
        const base64 = await fileToBase64(file);
        
        // Use gemini-3-pro-preview as requested for image analysis
        const response = await ai.models.generateContent({
          model: 'gemini-3-pro-preview',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64
                }
              },
              {
                text: "Extract the primary IMEI (15 digit number) from this image. It is usually labeled IMEI or IMEI 1. Return ONLY the 15 digit number. If you cannot clearly see a 15-digit IMEI, return the word 'FAILED'."
              }
            ]
          }
        });

        const text = response.text?.trim() || "FAILED";
        // Clean up response (remove markdown if any)
        const cleanText = text.replace(/[^0-9]/g, '');

        if (cleanText.length === 15) {
          // Check if IMEI exists in the loaded devices list
          const existsInHtml = devices.some(d => d.imei === cleanText);

          if (existsInHtml) {
             newImeis.push(cleanText);
          } else {
            // Push to manual fix queue if found but NOT in list
            failed.push({
              id: Math.random().toString(36).substr(2, 9),
              file: file,
              previewUrl: URL.createObjectURL(file),
              suggestedImei: cleanText // Pass what AI found
            });
          }
        } else {
          // Push to manual fix queue if invalid format
          failed.push({
            id: Math.random().toString(36).substr(2, 9),
            file: file,
            previewUrl: URL.createObjectURL(file)
          });
        }
      } catch (error) {
        console.error("AI Error:", error);
        failed.push({
          id: Math.random().toString(36).substr(2, 9),
          file: file,
          previewUrl: URL.createObjectURL(file)
        });
      }
    }

    // Add found IMEIs to the bulk query box
    if (newImeis.length > 0) {
      setBulkQuery(prev => {
        const existing = prev ? prev + '\n' : '';
        return existing + newImeis.join('\n');
      });
    }

    // Trigger Manual Fix Modal if needed
    if (failed.length > 0) {
      setManualFixQueue(prev => [...prev, ...failed]);
    }
    
    setIsProcessingImages(false);
    // Reset file input
    e.target.value = '';
  };

  const handleManualFix = (imei: string) => {
    setBulkQuery(prev => {
      const existing = prev ? prev + '\n' : '';
      return existing + imei;
    });
    // Remove current from queue
    setManualFixQueue(prev => prev.slice(1));
  };

  const handleSkipFix = () => {
    setManualFixQueue(prev => prev.slice(1));
  };

  // --- SEARCH LOGIC ---

  const handleBulkSearch = () => {
    if (!bulkQuery.trim()) {
      setSearchResults(null);
      setNotFoundQueries([]);
      setIcloudAlertDevices([]);
      return;
    }

    const rawQueries = bulkQuery.split(/[\n, \t]+/).map(s => s.trim()).filter(Boolean);
    const uniqueQueries = Array.from(new Set(rawQueries));
    
    const foundDevicesMap = new Map<string, Device>();
    const missing: string[] = [];

    uniqueQueries.forEach(q => {
      const matches = devices.filter(d => d.imei.includes(q) || (d.serial && d.serial.includes(q)));
      if (matches.length > 0) {
        matches.forEach(d => foundDevicesMap.set(d.id, d));
      } else {
        missing.push(q);
      }
    });

    const results = Array.from(foundDevicesMap.values());
    setSearchResults(results);
    setNotFoundQueries(missing);

    const locked = results.filter(d => d.icloudLock === "ON");
    if (locked.length > 0) setIcloudAlertDevices(locked);
  };

  const clearSearch = () => {
    setBulkQuery('');
    setSearchResults(null);
    setNotFoundQueries([]);
    setIcloudAlertDevices([]);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const copyGroup = (groupName: string) => {
    const groupDevices = devices.filter(d => d.group === groupName);
    const text = groupDevices.map(d => `${d.modelDesc} ${d.imei}`).join('\n');
    copyToClipboard(text);
  };

  const handleExport = () => {
    const text = generateExportText(searchResults || devices);
    setExportText(text);
    setShowExportModal(true);
  };

  const toggleGroup = (group: string) => {
    setOpenGroups(prev => ({...prev, [group]: !prev[group]}));
  };

  const groups: CarrierGroup[] = useMemo(() => {
    const gMap: Record<string, Device[]> = { 'Unlocked': [], 'T-Mobile/Sprint': [], 'AT&T': [], 'Verizon': [], 'Other': [] };
    devices.forEach(d => {
      if (gMap[d.group]) gMap[d.group].push(d);
      else { if (!gMap['Other']) gMap['Other'] = []; gMap['Other'].push(d); }
    });
    const sortOrder = ['Unlocked', 'T-Mobile/Sprint', 'AT&T', 'Verizon', 'Other'];
    return sortOrder.map(name => ({ name, devices: gMap[name] || [], count: (gMap[name] || []).length })).filter(g => g.count > 0);
  }, [devices]);

  // --- VIEWS ---

  if (view === 'upload') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
        {/* Decorative Blobs */}
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-purple-400/30 rounded-full blur-3xl mix-blend-multiply filter animate-blob"></div>
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-blue-400/30 rounded-full blur-3xl mix-blend-multiply filter animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-32 left-20 w-96 h-96 bg-pink-400/30 rounded-full blur-3xl mix-blend-multiply filter animate-blob animation-delay-4000"></div>

        <div className={`${GLASS_CARD} w-full max-w-lg p-8 relative z-10 text-center`}>
          <div className="mb-6">
            <h1 className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-400 dark:to-purple-400">
              Sickw Orders
            </h1>
            <p className="text-gray-500 dark:text-gray-300 mt-2 font-medium">Professional IMEI Parser</p>
          </div>
          
          <FileUpload onUpload={handleUpload} />

          <div className="mt-8 text-xs text-gray-400 dark:text-gray-500 font-medium tracking-widest uppercase">
            Created by Hamza
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 pb-20 md:p-8 relative">
       {/* Background Elements */}
       <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
          <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-blue-400/10 rounded-full blur-[100px]"></div>
          <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-400/10 rounded-full blur-[100px]"></div>
       </div>

      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className={`${GLASS_CARD} p-4 md:p-6 flex flex-col md:flex-row justify-between items-center gap-4 sticky top-4 z-40`}>
          <div className="text-center md:text-left">
            <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white cursor-pointer" onClick={() => setView('upload')}>
              Sickw Orders
            </h1>
            <div className="flex gap-2 mt-2 justify-center md:justify-start">
              <span className="px-2 py-0.5 rounded-md bg-blue-100/50 text-blue-700 text-xs font-bold">Total: {stats.total}</span>
              <span className="px-2 py-0.5 rounded-md bg-green-100/50 text-green-700 text-xs font-bold">Active: {stats.activeCount}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-3 justify-center">
            <button onClick={handleExport} className={`px-5 py-2.5 ${GLASS_BUTTON_PRIMARY} text-sm font-bold flex items-center gap-2`}>
              {searchResults ? 'Export Results' : 'Export All'}
            </button>
            <button onClick={() => setView('upload')} className={`px-5 py-2.5 ${GLASS_BUTTON_SECONDARY} text-sm font-bold`}>
              New Upload
            </button>
            <button onClick={() => setIsDarkMode(!isDarkMode)} className={`p-2.5 ${GLASS_BUTTON_SECONDARY} rounded-full`}>
              {isDarkMode ? '🌞' : '🌙'}
            </button>
          </div>
        </div>

        {/* Bulk Search & AI */}
        <div className={`${GLASS_CARD} p-6`}>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-2">
            <div>
               <h2 className="text-xl font-bold text-gray-800 dark:text-white">Bulk Search</h2>
               <p className="text-sm text-gray-500 dark:text-gray-400">Search via Text or AI Camera</p>
            </div>
            {searchResults && (
              <span className="px-3 py-1 bg-blue-500 text-white rounded-full text-xs font-bold shadow-lg shadow-blue-500/30">
                Found: {searchResults.length}
              </span>
            )}
          </div>
          
          <div className="relative">
            <textarea 
              className={`w-full p-4 h-32 ${GLASS_INPUT} font-mono text-sm text-gray-800 dark:text-gray-200 resize-none mb-4`}
              placeholder="Paste IMEIs here..."
              value={bulkQuery}
              onChange={(e) => setBulkQuery(e.target.value)}
            />
            {isProcessingImages && (
              <div className="absolute inset-0 bg-white/50 dark:bg-black/50 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center z-10">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-sm font-bold text-blue-600">AI Processing...</p>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
             {/* AI Image Button */}
            <div className="relative group flex-1">
              <input 
                type="file" 
                multiple 
                accept="image/*" 
                onChange={handleImageUpload} 
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                disabled={isProcessingImages}
              />
              <button className={`w-full py-3 ${GLASS_BUTTON_SECONDARY} flex items-center justify-center gap-2 border-blue-200 dark:border-blue-900`}>
                <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                <span className="font-bold text-blue-600 dark:text-blue-400">Extract from Photos</span>
              </button>
            </div>

            <button 
              onClick={handleBulkSearch}
              className={`flex-[2] py-3 ${GLASS_BUTTON_PRIMARY} font-bold`}
            >
              Search
            </button>
            
            {searchResults && (
              <button onClick={clearSearch} className={`flex-1 py-3 ${GLASS_BUTTON_SECONDARY} text-red-500 hover:text-red-600 font-bold`}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        {searchResults ? (
          <div className="animate-fade-in space-y-4">
            {searchResults.length === 0 ? (
              <div className={`${GLASS_CARD} p-12 text-center`}>
                <p className="text-gray-500 text-lg">No devices found matching your inputs.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {searchResults.map(device => (
                  <DeviceCard key={device.id} device={device} onCopy={copyToClipboard} onViewDetails={setSelectedDevice} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <h2 className="text-xl font-bold text-gray-800 dark:text-white px-2">Parsed Groups</h2>
            <div className="grid gap-4">
              {groups.map(group => (
                <div key={group.name} className={`${GLASS_CARD} overflow-hidden transition-all duration-300`}>
                  <div 
                    className={`p-5 flex justify-between items-center cursor-pointer hover:bg-white/30 dark:hover:bg-white/5 transition-colors`}
                    onClick={() => toggleGroup(group.name)}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 transition-transform duration-300 ${openGroups[group.name] ? 'rotate-90' : ''}`}>
                         <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="currentColor" viewBox="0 0 20 20"><path d="M6 6L14 10L6 14V6Z" /></svg>
                      </div>
                      <div>
                        <h3 className="font-bold text-lg text-gray-900 dark:text-white">{group.name}</h3>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{group.count} devices</p>
                      </div>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); copyGroup(group.name); }}
                      className={`px-4 py-2 ${GLASS_BUTTON_SECONDARY} text-xs font-bold`}
                    >
                      Copy All
                    </button>
                  </div>
                  
                  {openGroups[group.name] && (
                    <div className="p-4 border-t border-gray-200/20 bg-gray-50/30 dark:bg-black/20">
                       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {group.devices.map(device => (
                          <DeviceCard key={device.id} device={device} onCopy={copyToClipboard} onViewDetails={setSelectedDevice} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Branding */}
      <div className="fixed bottom-4 left-0 w-full text-center z-30 pointer-events-none">
        <span className="bg-black/20 dark:bg-white/10 backdrop-blur-md px-4 py-1.5 rounded-full text-xs font-bold text-gray-600 dark:text-gray-300 tracking-widest uppercase border border-white/10 shadow-lg">
          Created by Hamza
        </span>
      </div>

      {/* --- MODALS --- */}

      {/* Manual Fix Queue Modal */}
      {manualFixQueue.length > 0 && (
        <ManualFixModal 
          failedImage={manualFixQueue[0]} 
          onFix={handleManualFix} 
          onSkip={handleSkipFix} 
        />
      )}

      <Modal isOpen={icloudAlertDevices.length > 0} onClose={() => setIcloudAlertDevices([])} title="⚠️ iCloud Locked">
        <div className="space-y-3">
          {icloudAlertDevices.map(d => (
            <div key={d.id} className="bg-red-500/10 border border-red-500/20 p-3 rounded-xl flex justify-between items-center">
              <div>
                 <span className="font-mono text-sm font-bold block dark:text-white">{d.imei}</span>
                 <span className="text-xs text-red-600 dark:text-red-300">{d.modelDesc}</span>
              </div>
              <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-1 rounded-md">LOCKED</span>
            </div>
          ))}
        </div>
      </Modal>

      <Modal isOpen={notFoundQueries.length > 0} onClose={() => setNotFoundQueries([])} title="❌ Not Found">
        <div className="bg-gray-100/50 dark:bg-black/30 p-4 rounded-xl font-mono text-sm max-h-60 overflow-y-auto mb-4 border border-gray-200/50 dark:border-gray-700/50 dark:text-gray-300">
          {notFoundQueries.map((q, i) => (
            <div key={i} className="text-red-500 border-b border-gray-200/10 py-1">{q}</div>
          ))}
        </div>
         <button onClick={() => { copyToClipboard(notFoundQueries.join('\n')); alert("Copied!"); }} className={`w-full py-3 ${GLASS_BUTTON_SECONDARY} font-bold`}>
           Copy Missing List
         </button>
      </Modal>

      <Modal isOpen={showExportModal} onClose={() => setShowExportModal(false)} title="Export Results">
         <div className="relative">
           <textarea 
             className={`w-full h-96 p-4 ${GLASS_INPUT} font-mono text-sm resize-none`}
             readOnly
             value={exportText}
           />
           <button onClick={() => { copyToClipboard(exportText); alert("Copied!"); }} className="absolute top-4 right-4 bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-lg shadow-lg font-bold">
             Copy All
           </button>
         </div>
      </Modal>

      <Modal isOpen={!!selectedDevice} onClose={() => setSelectedDevice(null)} title="Device Details">
         <div className="relative">
           <div className={`p-4 rounded-xl font-mono text-sm whitespace-pre-wrap dark:text-gray-300 bg-gray-50/50 dark:bg-black/30 border border-gray-200/50 dark:border-gray-700`}>
             {selectedDevice ? getCleanDeviceDetails(selectedDevice.rawText) : ''}
           </div>
           <div className="flex justify-end mt-4">
             <button onClick={() => { if (selectedDevice) { copyToClipboard(getCleanDeviceDetails(selectedDevice.rawText)); alert("Copied!"); } }} className={`px-4 py-2 ${GLASS_BUTTON_PRIMARY} text-sm font-bold`}>
               Copy Details
             </button>
           </div>
         </div>
      </Modal>

    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);