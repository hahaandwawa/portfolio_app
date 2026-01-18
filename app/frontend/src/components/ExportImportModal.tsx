import { useState } from 'react';
import { X, Download, Upload, FileText, AlertCircle, CheckCircle } from 'lucide-react';
import { exportImportApi } from '../api';

interface ExportImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
}

function ExportImportModal({ isOpen, onClose, onImportComplete }: ExportImportModalProps) {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFiles, setImportFiles] = useState<{
    accounts?: File;
    transactions?: File;
    cash_accounts?: File;
    targets?: File;
  }>({});
  const [importOptions, setImportOptions] = useState({
    skipExisting: false,
    recalculateSnapshots: true,
  });
  const [importResult, setImportResult] = useState<{
    accounts?: { success: number; errors: Array<{ row: number; error: string }> };
    transactions?: { success: number; errors: Array<{ row: number; error: string }> };
    cash_accounts?: { success: number; errors: Array<{ row: number; error: string }> };
    targets?: { success: number; errors: Array<{ row: number; error: string }> };
  } | null>(null);

  if (!isOpen) return null;

  const handleExportAll = async () => {
    setIsExporting(true);
    try {
      const data = await exportImportApi.exportAll();
      
      // 创建并下载所有CSV文件
      const files = [
        { name: 'accounts.csv', content: data.accounts },
        { name: 'transactions.csv', content: data.transactions },
        { name: 'cash_accounts.csv', content: data.cash_accounts },
        { name: 'targets.csv', content: data.targets },
      ];

      for (const file of files) {
        const blob = new Blob([file.content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', file.name);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      alert('所有数据已成功导出！');
    } catch (error) {
      console.error('导出失败:', error);
      alert(`导出失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSingle = (type: 'accounts' | 'transactions' | 'cash_accounts' | 'targets') => {
    const url = exportImportApi.getExportUrl(type);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type}.csv`;
    link.click();
  };

  const handleFileSelect = (type: 'accounts' | 'transactions' | 'cash_accounts' | 'targets', file: File | null) => {
    setImportFiles(prev => ({
      ...prev,
      [type]: file || undefined,
    }));
    setImportResult(null);
  };

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsText(file, 'utf-8');
    });
  };

  const handleImport = async () => {
    const hasFiles = Object.values(importFiles).some(f => f !== undefined);
    if (!hasFiles) {
      alert('请至少选择一个CSV文件');
      return;
    }

    setIsImporting(true);
    setImportResult(null);

    try {
      const data: {
        accounts?: string;
        transactions?: string;
        cash_accounts?: string;
        targets?: string;
      } = {};

      if (importFiles.accounts) {
        data.accounts = await readFileAsText(importFiles.accounts);
      }
      if (importFiles.transactions) {
        data.transactions = await readFileAsText(importFiles.transactions);
      }
      if (importFiles.cash_accounts) {
        data.cash_accounts = await readFileAsText(importFiles.cash_accounts);
      }
      if (importFiles.targets) {
        data.targets = await readFileAsText(importFiles.targets);
      }

      const result = await exportImportApi.import({
        ...data,
        options: {
          ...importOptions,
          // 快照计算在后台异步进行，不阻塞导入完成
          recalculateSnapshots: importOptions.recalculateSnapshots,
        },
      });

      setImportResult(result);
      
      // 计算总数
      const totalSuccess = Object.values(result).reduce((sum, r) => sum + r.success, 0);
      const totalErrors = Object.values(result).reduce((sum, r) => sum + r.errors.length, 0);

      // 立即刷新基础数据（不等待快照计算）
      if (onImportComplete) {
        onImportComplete();
      }

      if (totalErrors === 0) {
        alert(`导入成功！共导入 ${totalSuccess} 条记录。净值曲线正在后台计算中，请稍候...`);
      } else {
        alert(`导入完成，但有一些错误。成功: ${totalSuccess}，错误: ${totalErrors}。净值曲线正在后台计算中，请稍候...`);
      }
    } catch (error) {
      console.error('导入失败:', error);
      alert(`导入失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-xl w-full max-w-2xl relative animate-slide-up max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <X className="w-5 h-5 text-slate-400" />
        </button>

        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-6">数据导出/导入</h2>

        {/* 标签页 */}
        <div className="flex gap-2 mb-6 border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setActiveTab('export')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'export'
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Download className="w-4 h-4 inline mr-2" />
            导出数据
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`px-4 py-2 font-medium transition-colors ${
              activeTab === 'import'
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Upload className="w-4 h-4 inline mr-2" />
            导入数据
          </button>
        </div>

        {/* 导出标签页 */}
        {activeTab === 'export' && (
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                导出所有数据为CSV文件。每个表将导出为单独的CSV文件。
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleExportAll}
                disabled={isExporting}
                className="w-full px-4 py-3 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                {isExporting ? '导出中...' : '导出所有数据'}
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleExportSingle('accounts')}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  导出账户
                </button>
                <button
                  onClick={() => handleExportSingle('transactions')}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  导出交易
                </button>
                <button
                  onClick={() => handleExportSingle('cash_accounts')}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  导出现金账户
                </button>
                <button
                  onClick={() => handleExportSingle('targets')}
                  className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center justify-center gap-2"
                >
                  <FileText className="w-4 h-4" />
                  导出目标
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 导入标签页 */}
        {activeTab === 'import' && (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                导入CSV文件。请确保CSV文件格式正确。导入顺序：账户 → 现金账户 → 交易 → 目标。
              </p>
            </div>

            <div className="space-y-4">
              {[
                { key: 'accounts' as const, label: '账户 (accounts.csv)' },
                { key: 'transactions' as const, label: '交易 (transactions.csv)' },
                { key: 'cash_accounts' as const, label: '现金账户 (cash_accounts.csv)' },
                { key: 'targets' as const, label: '投资目标 (targets.csv)' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    {label}
                  </label>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={(e) => handleFileSelect(key, e.target.files?.[0] || null)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-500 file:text-white hover:file:bg-blue-600 cursor-pointer"
                  />
                  {importFiles[key] && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      已选择: {importFiles[key]?.name}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={importOptions.skipExisting}
                  onChange={(e) => setImportOptions(prev => ({ ...prev, skipExisting: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700 dark:text-slate-300">跳过已存在的记录</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={importOptions.recalculateSnapshots}
                  onChange={(e) => setImportOptions(prev => ({ ...prev, recalculateSnapshots: e.target.checked }))}
                  className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-blue-500 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700 dark:text-slate-300">导入后重新计算快照</span>
              </label>
            </div>

            <button
              onClick={handleImport}
              disabled={isImporting}
              className="w-full px-4 py-3 rounded-lg bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <Upload className="w-5 h-5" />
              {isImporting ? '导入中...' : '开始导入'}
            </button>

            {/* 导入结果 */}
            {importResult && (
              <div className="mt-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">导入结果</h3>
                {Object.entries(importResult).map(([key, result]) => (
                  <div key={key} className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300 capitalize">
                        {key.replace('_', ' ')}
                      </span>
                      {result.errors.length === 0 ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                      )}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      成功: {result.success} | 错误: {result.errors.length}
                    </p>
                    {result.errors.length > 0 && (
                      <div className="mt-2 max-h-32 overflow-y-auto">
                        {result.errors.slice(0, 5).map((error, idx) => (
                          <p key={idx} className="text-xs text-red-600 dark:text-red-400">
                            第 {error.row} 行: {error.error}
                          </p>
                        ))}
                        {result.errors.length > 5 && (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            还有 {result.errors.length - 5} 个错误...
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 mt-6 border-t border-slate-200 dark:border-slate-700">
          <button 
            onClick={onClose} 
            className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-medium hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

export default ExportImportModal;
