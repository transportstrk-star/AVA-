import { Expense } from '../types';
import { formatBytes } from '../utils/storage';
import { Icon } from './Icon';

interface ReceiptViewerProps {
  expense: Expense;
  onClose: () => void;
  onReplace: (expenseId: string) => void;
  onRemove: (expenseId: string) => void;
}

export function ReceiptViewer({ expense, onClose, onReplace, onRemove }: ReceiptViewerProps) {
  const receipt = expense.receipt;
  if (!receipt) return null;

  const isImage = receipt.type && receipt.type.startsWith('image/');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4 bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col fade-in border border-slate-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-900 border-b border-slate-800">
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate text-slate-100">
              {receipt.name || 'Receipt Document'}
            </div>
            <div className="text-[11px] text-slate-400 capitalize">
              {expense.type} · {Number(expense.amount || 0).toFixed(2)} AED · {formatBytes(receipt.size)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 cursor-pointer"
          >
            <Icon name="X" size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3 bg-slate-950 flex items-center justify-center min-h-[220px]">
          {isImage ? (
            <img
              src={receipt.dataUrl}
              alt="Receipt proof"
              className="w-full max-h-[60vh] object-contain rounded-lg"
            />
          ) : (
            <div className="text-center py-10 px-4 text-slate-400 text-sm">
              <Icon name="FileText" size={40} className="mx-auto mb-3 text-sky-400" />
              <p className="font-medium text-slate-300 mb-1">PDF Receipt Document</p>
              <p className="text-xs text-slate-500 mb-4">View or download document in a new tab</p>
              <a
                href={receipt.dataUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-400 text-white font-medium text-xs rounded-xl shadow-lg shadow-sky-500/20"
              >
                <Icon name="ExternalLink" size={14} /> Open PDF
              </a>
            </div>
          )}
        </div>

        <div className="px-4 py-3 bg-slate-900 border-t border-slate-800 flex gap-2">
          <button
            onClick={() => {
              onReplace(expense.id);
              onClose();
            }}
            className="flex-1 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Icon name="RefreshCw" size={13} /> Replace
          </button>
          <button
            onClick={() => {
              onRemove(expense.id);
              onClose();
            }}
            className="flex-1 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 text-xs font-medium border border-red-500/30 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Icon name="Trash2" size={13} /> Remove
          </button>
        </div>
      </div>
    </div>
  );
}
