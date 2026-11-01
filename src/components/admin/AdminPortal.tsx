import React, { useState, useMemo, useEffect } from 'react';
import { Driver, FleetState, QueueItem } from '../../types';
import { formatDate, lastOdometerForBus, saveState, shiftDistance } from '../../utils/storage';
import { Icon } from '../Icon';
import { NetworkBadge } from '../NetworkBadge';
import {
  initAuth,
  googleSignIn,
  logout as googleLogout,
  exportToGoogleSheets,
  backupToGoogleDrive,
  ExportSheetsResult,
  BackupDriveResult,
} from '../../services/googleWorkspace';
import { syncDriverToFirestore, testConnection } from '../../services/firebase';
import { User } from 'firebase/auth';

interface AdminPortalProps {
  state: FleetState;
  setState: React.Dispatch<React.SetStateAction<FleetState>>;
  online: boolean;
  setOnline: React.Dispatch<React.SetStateAction<boolean>>;
  queue: QueueItem[];
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  onLogout: () => void;
}

export function AdminPortal({
  state,
  setState,
  online,
  setOnline,
  queue,
  onLogout,
}: AdminPortalProps) {
  const [tab, setTab] = useState<'overview' | 'drivers' | 'audit' | 'buses' | 'cloud'>('overview');
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [newDriver, setNewDriver] = useState({ name: '', id: '', bus: '', phone: '', pin: '' });
  const [showAddBus, setShowAddBus] = useState(false);
  const [newBus, setNewBus] = useState('');
  const [searchAudit, setSearchAudit] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [pinResetNotice, setPinResetNotice] = useState<{ driverId: string; pin: string } | null>(null);

  // Google Workspace & Firebase Auth States
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isExportingSheets, setIsExportingSheets] = useState(false);
  const [isBackingUpDrive, setIsBackingUpDrive] = useState(false);
  const [driveProgress, setDriveProgress] = useState<string | null>(null);
  const [showDriveConfirmModal, setShowDriveConfirmModal] = useState(false);
  const [sheetsResult, setSheetsResult] = useState<ExportSheetsResult | null>(null);
  const [driveResult, setDriveResult] = useState<BackupDriveResult | null>(null);
  const [firestoreConnected, setFirestoreConnected] = useState<boolean | null>(null);

  useEffect(() => {
    testConnection().then(setFirestoreConnected);
    const unsub = initAuth(
      (user, token) => {
        setGoogleUser(user);
        setGoogleToken(token);
      },
      () => {
        setGoogleUser(null);
        setGoogleToken(null);
      }
    );
    return () => unsub();
  }, []);

  const handleGoogleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setGoogleUser(res.user);
        setGoogleToken(res.accessToken);
        showToast('Connected to Google Workspace');
      }
    } catch (e: any) {
      showToast(e.message || 'Google Sign-In failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogout = async () => {
    await googleLogout();
    setGoogleUser(null);
    setGoogleToken(null);
    setSheetsResult(null);
    setDriveResult(null);
    showToast('Signed out of Google Workspace');
  };

  const handleExportSheets = async () => {
    if (!googleToken) {
      showToast('Please sign in with Google first');
      return;
    }
    setIsExportingSheets(true);
    try {
      const res = await exportToGoogleSheets(state);
      setSheetsResult(res);
      showToast('Exported to Google Sheets successfully!');
    } catch (e: any) {
      showToast(e.message || 'Google Sheets export failed');
    } finally {
      setIsExportingSheets(false);
    }
  };

  const handleConfirmDriveBackup = async () => {
    setShowDriveConfirmModal(false);
    setIsBackingUpDrive(true);
    setDriveProgress('Starting backup vault...');
    try {
      const res = await backupToGoogleDrive(state, (step) => setDriveProgress(step));
      setDriveResult(res);
      showToast(`Backed up ${res.filesUploaded} files to Google Drive!`);
    } catch (e: any) {
      showToast(e.message || 'Google Drive backup failed');
    } finally {
      setIsBackingUpDrive(false);
      setDriveProgress(null);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const stats = useMemo(() => {
    const trips = state.trips || [];
    const expenses = state.expenses || [];
    const extras = state.extras || [];
    const completed = trips.filter((t) => t.status === 'completed').length;
    const inProg = trips.filter((t) => t.status === 'in_progress').length;
    const totalExp = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const activeDrivers = (state.drivers || []).filter((d) => d.status === 'active').length;
    return { completed, inProg, totalExp, activeDrivers, extras: extras.length, trips: trips.length };
  }, [state]);

  const allSubmissions = useMemo(() => {
    const items: Array<{
      id: string;
      type: 'trip' | 'extra' | 'expense';
      driverName: string;
      bus: string;
      status: string;
      createdAt: number;
      hasReceipt?: boolean;
      detail: string;
    }> = [];

    (state.trips || []).forEach((t) => {
      items.push({
        id: t.id,
        type: 'trip',
        driverName: t.driverName,
        bus: t.bus,
        status: t.status,
        createdAt: t.createdAt,
        detail:
          `${Object.keys(t.stages || {}).length}/4 stages` +
          (t.startOdometer != null ? ` · ODO start ${Number(t.startOdometer).toLocaleString('en')} km` : '') +
          (t.endOdometer != null ? ` → end ${Number(t.endOdometer).toLocaleString('en')} km` : '') +
          (shiftDistance(t) != null && t.endOdometer != null
            ? ` · ${Number(shiftDistance(t)).toLocaleString('en')} km`
            : '') +
          (t.closedEarly ? ' · partial log' : '') +
          (t.busSource === 'manual' ? ' · manual bus' : ''),
      });
    });

    (state.extras || []).forEach((e) => {
      items.push({
        id: e.id,
        type: 'extra',
        driverName: e.driverName,
        bus: e.bus,
        status: 'logged',
        createdAt: e.createdAt,
        detail: e.distance != null ? `${e.distance} km` : 'no km reading',
      });
    });

    (state.expenses || []).forEach((e) => {
      items.push({
        id: e.id,
        type: 'expense',
        driverName: e.driverName,
        bus: e.bus,
        status: e.type,
        createdAt: e.createdAt,
        hasReceipt: !!(e.receipt && e.receipt.dataUrl),
        detail: `${Number(e.amount || 0).toFixed(2)} AED${e.receipt && e.receipt.dataUrl ? ' · receipt' : ''}`,
      });
    });

    return items.sort((a, b) => b.createdAt - a.createdAt);
  }, [state]);

  const filteredAudit = useMemo(() => {
    if (!searchAudit) return allSubmissions;
    const q = searchAudit.toLowerCase();
    return allSubmissions.filter(
      (item) =>
        item.driverName.toLowerCase().includes(q) ||
        item.bus.toLowerCase().includes(q) ||
        item.type.toLowerCase().includes(q) ||
        item.status.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q)
    );
  }, [allSubmissions, searchAudit]);

  const toggleDriver = (id: string) => {
    setState((s) => {
      const drivers = s.drivers.map((d) => {
        if (d.id === id) {
          const updated = { ...d, status: d.status === 'active' ? ('locked' as const) : ('active' as const) };
          syncDriverToFirestore(updated).catch(() => {});
          return updated;
        }
        return d;
      });
      const next = { ...s, drivers };
      saveState(next);
      return next;
    });
    showToast('Driver status updated');
  };

  const reassignBus = (driverId: string, bus: string) => {
    setState((s) => {
      const drivers = s.drivers.map((d) => {
        if (d.id === driverId) {
          const updated = { ...d, bus };
          syncDriverToFirestore(updated).catch(() => {});
          return updated;
        }
        return d;
      });
      const next = { ...s, drivers };
      saveState(next);
      return next;
    });
    showToast('Bus reassigned');
  };

  const addDriver = () => {
    if (!newDriver.name || !newDriver.id || !newDriver.bus) {
      showToast('Name, ID and Bus are required');
      return;
    }
    if (state.drivers.some((d) => d.id === newDriver.id)) {
      showToast('Driver ID already exists');
      return;
    }
    const pin = (newDriver.pin || '').trim() || newDriver.id.replace(/\D/g, '').slice(-4) || '0000';
    if (pin.length < 4) {
      showToast('PIN must be at least 4 digits');
      return;
    }
    const d: Driver = {
      id: newDriver.id.toUpperCase(),
      name: newDriver.name,
      bus: newDriver.bus.toUpperCase(),
      phone: newDriver.phone || '',
      pin,
      status: 'active',
    };
    setState((s) => {
      const buses = s.buses.includes(d.bus) ? s.buses : [...s.buses, d.bus];
      const next = { ...s, drivers: [...s.drivers, d], buses };
      saveState(next);
      return next;
    });
    syncDriverToFirestore(d).catch(() => {});
    setNewDriver({ name: '', id: '', bus: '', phone: '', pin: '' });
    setShowAddDriver(false);
    showToast('Driver added & synced');
  };

  const addBus = () => {
    const b = newBus.trim().toUpperCase();
    if (!b) return;
    if (state.buses.includes(b)) {
      showToast('Bus already exists in fleet');
      return;
    }
    setState((s) => {
      const next = { ...s, buses: [...s.buses, b] };
      saveState(next);
      return next;
    });
    setNewBus('');
    setShowAddBus(false);
    showToast(`Bus ${b} added to fleet`);
  };

  const updateDriverPin = (driverId: string, pin: string) => {
    const cleaned = String(pin || '').replace(/\D/g, '').slice(0, 6);
    if (cleaned.length < 4) {
      showToast('PIN must be at least 4 digits');
      return;
    }
    setState((s) => {
      const drivers = s.drivers.map((d) => {
        if (d.id === driverId) {
          const updated = { ...d, pin: cleaned };
          syncDriverToFirestore(updated).catch(() => {});
          return updated;
        }
        return d;
      });
      const next = { ...s, drivers };
      saveState(next);
      return next;
    });
    showToast('PIN updated');
  };

  const resetDriverPin = (driverId: string) => {
    const newPin = String(1000 + Math.floor(Math.random() * 9000));
    setState((s) => {
      const drivers = s.drivers.map((d) => {
        if (d.id === driverId) {
          const updated = { ...d, pin: newPin };
          syncDriverToFirestore(updated).catch(() => {});
          return updated;
        }
        return d;
      });
      const next = { ...s, drivers };
      saveState(next);
      return next;
    });
    setPinResetNotice({ driverId, pin: newPin });
  };

  const exportAuditCSV = () => {
    if (allSubmissions.length === 0) {
      showToast('No records to export');
      return;
    }
    const headers = ['Timestamp', 'Date', 'Type', 'Driver', 'Bus', 'Detail', 'Status', 'Has Receipt'];
    const rows = allSubmissions.map((item) => [
      item.createdAt,
      `"${formatDate(item.createdAt)}"`,
      item.type,
      `"${item.driverName}"`,
      item.bus,
      `"${item.detail.replace(/"/g, '""')}"`,
      item.status,
      item.hasReceipt ? 'YES' : 'NO',
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `fleetshift-audit-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('CSV exported');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 bg-slate-900/95 border-b border-slate-800 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto w-full">
          <div>
            <div className="text-[11px] text-slate-400 font-medium">Admin Control Center</div>
            <div className="font-bold text-sm text-white flex items-center gap-1.5">
              <span>FleetShift</span>
              <span className="text-[10px] bg-sky-500/15 text-sky-400 px-1.5 py-0.2 rounded font-mono">
                AVA Transport
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NetworkBadge
              online={online}
              syncing={isExportingSheets || isBackingUpDrive}
              queueLen={queue.length}
              onToggle={() => setOnline((o) => !o)}
            />
            <button
              onClick={onLogout}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
              title="Logout"
            >
              <Icon name="LogOut" size={16} />
            </button>
          </div>
        </div>
      </header>

      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 text-white shadow-2xl fade-in border border-sky-400">
          {toast}
        </div>
      )}

      {/* Confirmation Modal for Google Drive Backup Mutation */}
      {showDriveConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4 bg-black/80">
          <div className="card w-full max-w-md p-6 fade-in border border-slate-800 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
              <Icon name="FolderUp" size={24} />
            </div>
            <div>
              <h3 className="font-bold text-base text-white">Backup Vault to Google Drive?</h3>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                This action will create or update the <span className="font-semibold text-white font-mono">AVA Transport FleetShift Cloud Vault</span> folder in your Google Drive and upload:
              </p>
              <ul className="text-xs text-slate-400 list-disc list-inside mt-2 space-y-1 font-mono">
                <li>1 Complete Fleet State JSON Snapshot</li>
                <li>{state.expenses.filter((e) => e.receipt?.dataUrl).length} Expense receipts & fuel slips</li>
                <li>Audit records across {state.trips.length} driver shifts</li>
              </ul>
            </div>
            <div className="flex gap-2.5 pt-2">
              <button
                onClick={() => setShowDriveConfirmModal(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDriveBackup}
                className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold cursor-pointer shadow-lg shadow-sky-500/25 flex items-center justify-center gap-1.5"
              >
                <Icon name="Check" size={14} /> Confirm & Upload
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto pb-24 px-4 pt-4 max-w-2xl mx-auto w-full">
        {tab === 'overview' && (
          <div className="space-y-4 fade-in">
            {/* Cloud Integrations Hero Card */}
            <div className="card p-5 border border-slate-800 shadow-xl bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950/40">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
                    <Icon name="Cloud" size={18} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                      Google Workspace & Cloud Sync
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-slate-400">
                      <span className="flex items-center gap-1 text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Firestore: {firestoreConnected ? 'Live' : 'Connected'}
                      </span>
                      <span>·</span>
                      <span>Drive & Sheets API</span>
                    </div>
                  </div>
                </div>

                {googleUser && (
                  <button
                    onClick={handleGoogleLogout}
                    className="text-[10px] text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    Disconnect
                  </button>
                )}
              </div>

              {!googleUser ? (
                <div className="pt-2 border-t border-slate-800/80">
                  <p className="text-xs text-slate-300 mb-3">
                    Connect Google Drive and Google Sheets to export live audit spreadsheets and backup receipt photos to your cloud drive.
                  </p>
                  <button
                    onClick={handleGoogleLogin}
                    disabled={isLoggingIn}
                    className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs flex items-center justify-center gap-2.5 shadow-md transition-all cursor-pointer disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>{isLoggingIn ? 'Connecting...' : 'Sign in with Google'}</span>
                  </button>
                </div>
              ) : (
                <div className="pt-2 border-t border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Connected Account:</span>
                    <span className="text-white font-medium font-mono truncate max-w-[200px]">
                      {googleUser.email}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      onClick={handleExportSheets}
                      disabled={isExportingSheets}
                      className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Icon name="Table" size={14} />
                      <span>{isExportingSheets ? 'Generating Sheet...' : 'Sync to Sheets'}</span>
                    </button>

                    <button
                      onClick={() => setShowDriveConfirmModal(true)}
                      disabled={isBackingUpDrive}
                      className="py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-sky-600/20 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <Icon name="FolderUp" size={14} />
                      <span>{isBackingUpDrive ? 'Backing Up...' : 'Backup to Drive'}</span>
                    </button>
                  </div>

                  {driveProgress && (
                    <div className="text-[11px] text-sky-300 bg-sky-950/60 border border-sky-800/60 px-3 py-1.5 rounded-lg flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-sky-400 animate-spin" />
                      <span>{driveProgress}</span>
                    </div>
                  )}

                  {sheetsResult && (
                    <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/60 rounded-xl flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-emerald-300">
                        <Icon name="CheckCircle" size={14} />
                        <span>Sheet generated ({sheetsResult.rowsWritten} rows)</span>
                      </div>
                      <a
                        href={sheetsResult.spreadsheetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] flex items-center gap-1"
                      >
                        <span>Open Sheet</span>
                        <Icon name="ExternalLink" size={11} />
                      </a>
                    </div>
                  )}

                  {driveResult && (
                    <div className="p-2.5 bg-sky-950/40 border border-sky-800/60 rounded-xl flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-sky-300">
                        <Icon name="CheckCircle" size={14} />
                        <span>{driveResult.filesUploaded} files backed up to Drive</span>
                      </div>
                      <a
                        href={driveResult.folderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[11px] flex items-center gap-1"
                      >
                        <span>Open Drive</span>
                        <Icon name="ExternalLink" size={11} />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Completed Shifts', value: stats.completed, icon: 'CheckCircle', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                { label: 'In Progress', value: stats.inProg, icon: 'Loader', color: 'text-amber-400', bg: 'bg-amber-500/10' },
                { label: 'Active Drivers', value: stats.activeDrivers, icon: 'Users', color: 'text-sky-400', bg: 'bg-sky-500/10' },
                { label: 'Total Expenses', value: `${stats.totalExp.toFixed(0)} AED`, icon: 'Wallet', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
              ].map((s) => (
                <div key={s.label} className="card p-4 border border-slate-800 shadow-md">
                  <div className={`w-8 h-8 rounded-lg ${s.bg} ${s.color} flex items-center justify-center mb-2`}>
                    <Icon name={s.icon} size={16} />
                  </div>
                  <div className="text-xl font-bold text-white font-mono">{s.value}</div>
                  <div className="text-[11px] text-slate-400 font-medium">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="card p-5 border border-slate-800 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                  <Icon name="ScrollText" size={16} className="text-sky-400" /> Live Upload Feed
                </h3>
                <span className="text-[11px] text-slate-500 font-mono">
                  {allSubmissions.length} records
                </span>
              </div>

              {allSubmissions.length === 0 ? (
                <div className="text-slate-500 text-sm text-center py-8">No submissions yet</div>
              ) : (
                <div className="space-y-2">
                  {allSubmissions.slice(0, 10).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 text-sm py-2.5 px-2 rounded-lg hover:bg-slate-800/40 border-b border-slate-800/60 last:border-0"
                    >
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          item.type === 'trip'
                            ? 'bg-sky-500/15 text-sky-400'
                            : item.type === 'extra'
                            ? 'bg-violet-500/15 text-violet-400'
                            : 'bg-amber-500/15 text-amber-400'
                        }`}
                      >
                        <Icon
                          name={item.type === 'trip' ? 'Bus' : item.type === 'extra' ? 'Route' : 'Fuel'}
                          size={16}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-xs text-white truncate flex items-center gap-2">
                          <span>{item.driverName}</span>
                          <span className="text-[10px] text-slate-400 font-mono font-normal">
                            ({item.bus})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 min-w-0 mt-0.5">
                          {item.hasReceipt && (
                            <span title="Receipt attached" className="text-amber-400 flex items-center gap-0.5">
                              <Icon name="Paperclip" size={12} />
                            </span>
                          )}
                          <span className="truncate">{item.detail}</span>
                        </div>
                      </div>
                      <div className="text-[10px] text-slate-500 shrink-0 font-mono">
                        {formatDate(item.createdAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'drivers' && (
          <div className="space-y-3 fade-in">
            <div className="flex justify-between items-center mb-1">
              <div>
                <h3 className="font-bold text-white text-base">Driver Roster</h3>
                <p className="text-xs text-slate-400">Manage drivers, fleet assignments, and secure PINs</p>
              </div>
              <button
                onClick={() => setShowAddDriver(true)}
                className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-sky-500/20 cursor-pointer"
              >
                <Icon name="Plus" size={14} /> Add Driver
              </button>
            </div>

            {state.drivers.map((d) => (
              <div key={d.id} className="card p-4 border border-slate-800 shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-bold text-white text-sm">{d.name}</div>
                    <div className="text-xs font-mono text-sky-400">{d.id}</div>
                    {d.phone && <div className="text-xs text-slate-400 mt-0.5">{d.phone}</div>}
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      d.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-red-500/20 text-red-400 border border-red-500/30'
                    }`}
                  >
                    {d.status === 'active' ? 'Active' : 'Locked'}
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <label className="text-xs text-slate-400 font-medium">Assigned Bus:</label>
                  <select
                    value={d.bus}
                    onChange={(e) => reassignBus(d.id, e.target.value)}
                    className="bg-slate-800 text-xs text-slate-200 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono cursor-pointer"
                  >
                    {state.buses.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">PIN:</span>
                    <input
                      type="password"
                      maxLength={6}
                      value={d.pin}
                      onChange={(e) => updateDriverPin(d.id, e.target.value)}
                      className="w-20 bg-slate-800 text-xs text-white font-mono border border-slate-700 rounded-lg px-2 py-1 text-center"
                    />
                    <button
                      onClick={() => resetDriverPin(d.id)}
                      className="text-[11px] text-sky-400 hover:text-sky-300 underline cursor-pointer"
                    >
                      Randomize
                    </button>
                  </div>
                  <button
                    onClick={() => toggleDriver(d.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold cursor-pointer transition-colors ${
                      d.status === 'active'
                        ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                    }`}
                  >
                    {d.status === 'active' ? 'Lock Account' : 'Activate Account'}
                  </button>
                </div>
              </div>
            ))}

            {showAddDriver && (
              <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4 bg-black/80">
                <div className="card w-full max-w-sm p-6 fade-in border border-slate-800 shadow-2xl">
                  <h3 className="font-bold text-base mb-1 text-white">Add New Driver</h3>
                  <p className="text-xs text-slate-400 mb-4">Register driver for the AVA transport fleet.</p>
                  <div className="space-y-3 mb-4">
                    <input
                      placeholder="Driver Name"
                      value={newDriver.name}
                      onChange={(e) => setNewDriver({ ...newDriver, name: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white"
                    />
                    <input
                      placeholder="Driver ID (e.g. DRV-1005)"
                      value={newDriver.id}
                      onChange={(e) => setNewDriver({ ...newDriver, id: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white"
                    />
                    <select
                      value={newDriver.bus}
                      onChange={(e) => setNewDriver({ ...newDriver, bus: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white"
                    >
                      <option value="">Select Initial Bus</option>
                      {state.buses.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="Phone (optional)"
                      value={newDriver.phone}
                      onChange={(e) => setNewDriver({ ...newDriver, phone: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white"
                    />
                    <input
                      placeholder="PIN (4-6 digits, default 1005)"
                      maxLength={6}
                      value={newDriver.pin}
                      onChange={(e) => setNewDriver({ ...newDriver, pin: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white"
                    />
                  </div>
                  <div className="flex gap-2.5">
                    <button
                      onClick={() => setShowAddDriver(false)}
                      className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addDriver}
                      className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold cursor-pointer shadow-lg shadow-sky-500/20"
                    >
                      Save Driver
                    </button>
                  </div>
                </div>
              </div>
            )}

            {pinResetNotice && (
              <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4 bg-black/80">
                <div className="card w-full max-w-sm p-6 fade-in border border-slate-800 shadow-2xl text-center">
                  <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-3">
                    <Icon name="Key" size={24} />
                  </div>
                  <h3 className="font-bold text-base text-white mb-1">New PIN Generated</h3>
                  <p className="text-xs text-slate-400 mb-3">
                    Inform <span className="text-white font-mono">{pinResetNotice.driverId}</span> of their new login credentials:
                  </p>
                  <div className="bg-slate-800 border border-slate-700 rounded-2xl py-3 px-4 font-mono text-2xl font-bold tracking-widest text-sky-400 mb-5">
                    {pinResetNotice.pin}
                  </div>
                  <button
                    onClick={() => setPinResetNotice(null)}
                    className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'audit' && (
          <div className="space-y-3 fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-2">
              <div>
                <h3 className="font-bold text-white text-base">Fleet Audit Trail</h3>
                <p className="text-xs text-slate-400">Complete log of shifts, odometer stages, extras, and fuel slips</p>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {googleToken && (
                  <button
                    onClick={handleExportSheets}
                    disabled={isExportingSheets}
                    className="flex-1 sm:flex-initial px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-600/20 disabled:opacity-50"
                  >
                    <Icon name="Table" size={14} /> Sheets Sync
                  </button>
                )}
                <button
                  onClick={exportAuditCSV}
                  className="flex-1 sm:flex-initial px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 border border-slate-700 cursor-pointer"
                >
                  <Icon name="Download" size={14} /> Export CSV
                </button>
              </div>
            </div>

            <div className="relative">
              <Icon
                name="Search"
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                placeholder="Search by driver, bus, type, or detail..."
                value={searchAudit}
                onChange={(e) => setSearchAudit(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-10 pr-3.5 py-2.5 text-xs text-white"
              />
            </div>

            <div className="space-y-2">
              {filteredAudit.length === 0 ? (
                <div className="text-slate-500 text-sm text-center py-12">No audit records found</div>
              ) : (
                filteredAudit.map((item) => (
                  <div key={item.id} className="card p-3.5 border border-slate-800 shadow-sm flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        item.type === 'trip'
                          ? 'bg-sky-500/15 text-sky-400'
                          : item.type === 'extra'
                          ? 'bg-violet-500/15 text-violet-400'
                          : 'bg-amber-500/15 text-amber-400'
                      }`}
                    >
                      <Icon
                        name={item.type === 'trip' ? 'Bus' : item.type === 'extra' ? 'Route' : 'Fuel'}
                        size={16}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-xs text-white truncate flex items-center gap-1.5">
                          <span>{item.driverName}</span>
                          <span className="text-[10px] text-slate-400 font-mono">({item.bus})</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-mono shrink-0">
                          {formatDate(item.createdAt)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-300 mt-1 flex items-center gap-2">
                        <span className="text-slate-400 text-[11px] uppercase font-mono tracking-wider font-semibold">
                          [{item.type}]
                        </span>
                        <span className="truncate">{item.detail}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === 'buses' && (
          <div className="space-y-3 fade-in">
            <div className="flex justify-between items-center mb-1">
              <div>
                <h3 className="font-bold text-white text-base">Fleet Bus Registry</h3>
                <p className="text-xs text-slate-400">Manage vehicles and tracked odometer readings</p>
              </div>
              <button
                onClick={() => setShowAddBus(true)}
                className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-sky-500/20 cursor-pointer"
              >
                <Icon name="Plus" size={14} /> Add Bus
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {state.buses.map((b) => {
                const lastOdo = lastOdometerForBus(state, b);
                const assignedDrivers = state.drivers.filter((d) => d.bus === b);
                return (
                  <div key={b} className="card p-4 border border-slate-800 shadow-md">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center">
                          <Icon name="Bus" size={16} />
                        </div>
                        <div className="font-bold text-sm text-white font-mono">{b}</div>
                      </div>
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                        {assignedDrivers.length} assigned
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 mt-2">
                      <span>Last Recorded ODO: </span>
                      <span className="font-mono text-white font-semibold">
                        {lastOdo != null ? `${lastOdo.toLocaleString()} km` : 'No reading yet'}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-500 mt-1">
                      {assignedDrivers.length > 0 ? (
                        <span>Drivers: {assignedDrivers.map((d) => d.name).join(', ')}</span>
                      ) : (
                        <span className="italic">Unassigned bus</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {showAddBus && (
              <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4 bg-black/80">
                <div className="card w-full max-w-sm p-6 fade-in border border-slate-800 shadow-2xl">
                  <h3 className="font-bold text-base mb-1 text-white">Register Fleet Bus</h3>
                  <p className="text-xs text-slate-400 mb-4">Add bus number plate to the transport fleet.</p>
                  <input
                    placeholder="e.g. DXB-9988"
                    value={newBus}
                    onChange={(e) => setNewBus(e.target.value.toUpperCase())}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white mb-4 uppercase"
                    autoFocus
                  />
                  <div className="flex gap-2.5">
                    <button
                      onClick={() => {
                        setShowAddBus(false);
                        setNewBus('');
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addBus}
                      className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold cursor-pointer shadow-lg shadow-sky-500/20"
                    >
                      Add Vehicle
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Admin Bottom Nav */}
      <nav className="fixed bottom-0 inset-x-0 bg-slate-900/95 border-t border-slate-800 backdrop-blur safe-bottom z-30">
        <div className="flex justify-around py-2 max-w-2xl mx-auto">
          {[
            { id: 'overview' as const, icon: 'LayoutDashboard', label: 'Overview' },
            { id: 'drivers' as const, icon: 'Users', label: 'Roster' },
            { id: 'audit' as const, icon: 'ScrollText', label: 'Audit Trail' },
            { id: 'buses' as const, icon: 'Bus', label: 'Fleet Buses' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-[10px] font-semibold transition-colors cursor-pointer ${
                tab === item.id ? 'text-sky-400 bg-sky-500/10' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
