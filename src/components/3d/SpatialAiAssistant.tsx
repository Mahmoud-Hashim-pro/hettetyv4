import React, { useState } from 'react';
import { Sparkles, Send, Compass, MessageSquare, X, ChevronRight, ChevronLeft } from 'lucide-react';
import { ThreeDTour, Room } from '../../types';
import { parseSpatialCommand, SpatialNavigationResult } from '../../services/ai/spatial-assistant';

interface SpatialAiAssistantProps {
  tour?: ThreeDTour;
  onNavigateToRoom: (roomId: string, cameraPos?: [number, number, number], target?: [number, number, number]) => void;
  isRtl?: boolean;
}

export const SpatialAiAssistant: React.FC<SpatialAiAssistantProps> = ({
  tour,
  onNavigateToRoom,
  isRtl = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; text: string }[]>([
    {
      role: 'assistant',
      text: isRtl
        ? 'أهلاً بك! أنا مساعدك الفراغي داخل العقار. اطلب مني الانتقال لأي غرفة مثل: "وريني الريسبشن" أو "خدني للماستر".'
        : 'Welcome! I am your 3D spatial assistant. Ask me to take you anywhere: e.g. "Show me the kitchen" or "Take me to master suite".',
    },
  ]);

  const handleSend = (textToSend?: string) => {
    const commandText = textToSend || input;
    if (!commandText.trim()) return;

    const userMsg = commandText.trim();
    setInput('');

    // Parse with spatial assistant
    const result: SpatialNavigationResult = parseSpatialCommand(userMsg, tour);
    const replyText = isRtl ? result.responseTextAr : result.responseTextEn;

    setHistory(prev => [
      ...prev,
      { role: 'user', text: userMsg },
      { role: 'assistant', text: replyText },
    ]);

    if (result.action === 'navigate_to_room' && result.targetRoomId) {
      onNavigateToRoom(result.targetRoomId, result.cameraPosition, result.cameraTarget);
    }
  };

  const QUICK_COMMANDS = isRtl
    ? ['وريني الريسبشن', 'خدني لغرفة الماستر', 'المطبخ', 'ما هي الغرف؟']
    : ['Show me reception', 'Take me to master suite', 'Kitchen', 'List rooms'];

  return (
    <div className="absolute bottom-5 left-5 rtl:left-auto rtl:right-5 z-40 text-start">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-900/90 hover:bg-slate-900 text-white rounded-2xl shadow-xl backdrop-blur-md border border-slate-700/60 font-bold text-xs transition-all cursor-pointer hover:scale-105"
        >
          <Sparkles size={15} className="text-brand-400 animate-pulse" />
          <span>{isRtl ? 'المساعد الفراغي الذكي' : '3D Spatial Assistant'}</span>
        </button>
      ) : (
        <div className="w-80 sm:w-96 bg-slate-950/95 border border-slate-800 rounded-3xl shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-white">
          {/* Header */}
          <div className="p-3.5 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-brand-500/20 text-brand-400 rounded-xl">
                <Sparkles size={14} />
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-100">
                  {isRtl ? 'المساعد الفراغي الذكي' : 'Hettety 3D Navigator'}
                </h4>
                <p className="text-[10px] text-slate-400">
                  {isRtl ? 'توجيه الكاميرا والاستفسار الفراغي' : 'Voice & Spatial Navigation'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>

          {/* Chat Messages */}
          <div className="p-3.5 max-h-56 overflow-y-auto space-y-2.5 text-xs">
            {history.map((msg, i) => (
              <div
                key={i}
                className={`p-2.5 rounded-2xl max-w-[85%] leading-relaxed ${
                  msg.role === 'user'
                    ? 'ml-auto rtl:ml-0 rtl:mr-auto bg-brand-600 text-white font-medium'
                    : 'bg-slate-900 border border-slate-800 text-slate-300'
                }`}
              >
                {msg.text}
              </div>
            ))}
          </div>

          {/* Quick prompts */}
          <div className="px-3 pb-2 flex items-center gap-1.5 overflow-x-auto text-[10px]">
            {QUICK_COMMANDS.map((cmd, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSend(cmd)}
                className="whitespace-nowrap px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-full transition-colors cursor-pointer"
              >
                {cmd}
              </button>
            ))}
          </div>

          {/* Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-2 border-t border-slate-800/80 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isRtl ? 'اكتب أمرك الفراغي...' : 'Ask to visit any room...'}
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
              dir={isRtl ? 'rtl' : 'ltr'}
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="p-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white rounded-xl transition-all cursor-pointer shrink-0"
            >
              <Send size={13} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
