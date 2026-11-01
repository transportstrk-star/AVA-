import { Icon } from './Icon';

interface NetworkBadgeProps {
  online: boolean;
  syncing: boolean;
  queueLen: number;
  onToggle: () => void;
}

export function NetworkBadge({ online, syncing, queueLen, onToggle }: NetworkBadgeProps) {
  let cls = online ? 'status-online' : 'status-offline';
  let label = online ? 'Online Sync' : 'Offline Mode';
  let icon = online ? 'Wifi' : 'WifiOff';
  if (syncing) {
    cls = 'status-syncing';
    label = 'Syncing…';
    icon = 'RefreshCw';
  }
  return (
    <button
      onClick={onToggle}
      className={`status-badge ${cls} cursor-pointer hover:opacity-90 transition-all select-none`}
      title="Click to toggle network simulation"
    >
      <Icon name={icon} size={12} className={syncing ? 'animate-spin' : ''} />
      <span>{label}</span>
      {queueLen > 0 && (
        <span className="ml-1 px-1.5 py-0.2 bg-black/40 text-[10px] rounded-full font-mono">
          {queueLen}
        </span>
      )}
    </button>
  );
}
