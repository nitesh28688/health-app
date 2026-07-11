import { Clock, AlertTriangle, X } from "lucide-react";

export type FastingModalType = "break_fast" | "start_fast" | null;

interface SmartFastingModalProps {
  type: FastingModalType;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function SmartFastingModal({ type, onConfirm, onCancel, isLoading }: SmartFastingModalProps) {
  if (!type) return null;

  const isBreak = type === "break_fast";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-neutral-900 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 text-center relative">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 rounded-full p-1.5 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${isBreak ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" : "bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400"}`}>
            {isBreak ? <AlertTriangle className="w-8 h-8" /> : <Clock className="w-8 h-8" />}
          </div>
          
          <h2 className="text-xl font-bold mb-2">
            {isBreak ? "Break Your Fast?" : "Start Fasting?"}
          </h2>
          
          <p className="text-neutral-600 dark:text-neutral-400 text-sm mb-6">
            {isBreak 
              ? "Logging this meal will end your current active fast. Are you sure you want to proceed?" 
              : "You just logged dinner! This is usually the perfect time to start your daily 16-hour fast. Ready to begin?"}
          </p>
          
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1 py-3 px-4 rounded-xl font-bold text-neutral-700 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className={`flex-1 py-3 px-4 rounded-xl font-bold text-white transition-colors disabled:opacity-50 ${isBreak ? "bg-amber-600 hover:bg-amber-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
            >
              {isLoading ? "Saving..." : isBreak ? "Yes, Break Fast" : "Start Fast"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
