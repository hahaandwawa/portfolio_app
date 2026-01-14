import { useEffect } from 'react';
import { X, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
}

function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 4000);

    return () => clearTimeout(timer);
  }, [onClose]);

  const icons = {
    success: CheckCircle,
    error: XCircle,
    info: AlertCircle,
  };

  const styles = {
    success: {
      bg: 'bg-emerald-50 dark:bg-emerald-500/10',
      border: 'border-emerald-500',
      text: 'text-emerald-600 dark:text-emerald-400',
      icon: 'text-emerald-500',
    },
    error: {
      bg: 'bg-red-50 dark:bg-red-500/10',
      border: 'border-red-500',
      text: 'text-red-600 dark:text-red-400',
      icon: 'text-red-500',
    },
    info: {
      bg: 'bg-blue-50 dark:bg-blue-500/10',
      border: 'border-blue-500',
      text: 'text-blue-600 dark:text-blue-400',
      icon: 'text-blue-500',
    },
  };

  const Icon = icons[type];
  const style = styles[type];

  return (
    <div 
      className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg border flex items-center gap-3 animate-fade-in ${style.bg} ${style.border}`}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${style.icon}`} />
      <span className={`text-sm font-medium ${style.text}`}>{message}</span>
      <button 
        onClick={onClose} 
        className="p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors ml-2"
      >
        <X className={`w-4 h-4 ${style.text}`} />
      </button>
    </div>
  );
}

export default Toast;
