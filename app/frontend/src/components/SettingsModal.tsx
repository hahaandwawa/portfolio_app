import { useState, useEffect } from 'react';
import { X, RefreshCw, Database, Globe, Palette } from 'lucide-react';
import { useSettingsStore, useUIStore } from '../store';

function SettingsModal() {
  const { theme, refreshInterval, baseCurrency, defaultProvider, updateSettings } = useSettingsStore();
  const { closeSettings } = useUIStore();
  
  const [isSaving, setIsSaving] = useState(false);
  const [localSettings, setLocalSettings] = useState({
    theme,
    refreshInterval,
    baseCurrency,
    defaultProvider,
  });

  useEffect(() => {
    setLocalSettings({
      theme,
      refreshInterval,
      baseCurrency,
      defaultProvider,
    });
  }, [theme, refreshInterval, baseCurrency, defaultProvider]);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    setLocalSettings(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    try {
      await updateSettings(localSettings as any);
      closeSettings();
    } catch (error) {
      console.error('保存设置失败:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const settingGroups = [
    {
      icon: Palette,
      title: '外观',
      items: [
        {
          name: 'theme',
          label: '主题',
          value: localSettings.theme,
          options: [
            { value: 'system', label: '跟随系统' },
            { value: 'light', label: '浅色模式' },
            { value: 'dark', label: '深色模式' },
          ],
        },
      ],
    },
    {
      icon: RefreshCw,
      title: '数据刷新',
      items: [
        {
          name: 'refreshInterval',
          label: '自动刷新',
          value: localSettings.refreshInterval,
          options: [
            { value: 'manual', label: '手动刷新' },
            { value: '5s', label: '每5秒' },
            { value: '30s', label: '每30秒' },
            { value: '60s', label: '每60秒' },
          ],
        },
      ],
    },
    {
      icon: Globe,
      title: '市场数据',
      items: [
        {
          name: 'defaultProvider',
          label: '数据源',
          value: localSettings.defaultProvider,
          options: [
            { value: 'yahoo', label: 'Yahoo Finance' },
            { value: 'tushare', label: 'Tushare' },
          ],
        },
      ],
    },
    {
      icon: Database,
      title: '货币',
      items: [
        {
          name: 'baseCurrency',
          label: '基础货币',
          value: localSettings.baseCurrency,
          options: [
            { value: 'USD', label: 'US Dollar (USD)' },
            { value: 'CNY', label: 'Chinese Yuan (CNY)' },
            { value: 'HKD', label: 'Hong Kong Dollar (HKD)' },
            { value: 'EUR', label: 'Euro (EUR)' },
            { value: 'GBP', label: 'British Pound (GBP)' },
          ],
        },
      ],
    },
  ];

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={closeSettings}
    >
      <div 
        className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-xl w-full max-w-lg relative animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={closeSettings}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <X className="w-5 h-5 text-slate-400" />
        </button>

        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-6">设置</h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          {settingGroups.map(group => (
            <div key={group.title} className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                <group.icon className="w-4 h-4 text-blue-500" />
                {group.title}
              </div>
              
              {group.items.map(item => (
                <div key={item.name} className="flex items-center justify-between">
                  <label htmlFor={item.name} className="text-sm text-slate-600 dark:text-slate-400">
                    {item.label}
                  </label>
                  <select
                    id={item.name}
                    name={item.name}
                    value={item.value}
                    onChange={handleChange}
                    className="w-40 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-sm cursor-pointer focus:outline-none focus:border-blue-500 transition-colors"
                  >
                    {item.options.map(opt => (
                      <option key={opt.value} value={opt.value} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          ))}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
            <button 
              type="button" 
              onClick={closeSettings} 
              className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
            >
              取消
            </button>
            <button 
              type="submit" 
              className="px-4 py-2 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isSaving}
            >
              {isSaving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SettingsModal;
