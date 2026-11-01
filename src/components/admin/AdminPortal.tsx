import React, { useState, useMemo } from 'react';
import { Driver, FleetState, QueueItem } from '../../types';
import { formatDate, lastOdometerForBus, saveState, shiftDistance } from '../../utils/storage';
import { Icon } from '../Icon';
import { NetworkBadge } from '../NetworkBadge';

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
  const [tab, setTab] = useState<'overview' | 'drivers' | 'audit' | 'buses'>('overview');
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [newDriver, setNewDriver] = useState({ name: '', id: '', bus: '', phone: '', pin: '' });
  const [showAddBus, setShowAddBus] = useState(false);
  const [newBus, setNewBus] = useState('');
  const [searchAudit, setSearchAudit] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [pinResetNotice, setPinResetNotice] = useState<{ driverId: string; pin: string } | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
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
      const drivers = s.drivers.map((d) =>
        d.id === id ? { ...d, status: d.status === 'active' ? ('locked' as const) : ('active' as const) } : d
      );
      const next = { ...s, drivers };
      saveState(next);
      return next;
    });
    showToast('Driver status updated');
  };

  const reassignBus = (driverId: string, bus: string) => {
    setState((s) => {
      const drivers = s.drivers.map((d) => (d.id === driverId ? { ...d, bus } : d));
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
    setNewDriver({ name: '', id: '', bus: '', phone: '', pin: '' });
    setShowAddDriver(false);
    showToast('Driver added');
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
      const drivers = s.drivers.map((d) => (d.id === driverId ? { ...d, pin: cleaned } : d));
      const next = { ...s, drivers };
      saveState(next);
      return next;
    });
    showToast('PIN updated');
  };

  const resetDriverPin = (driverId: string) => {
    const newPin = String(1000 + Math.floor(Math.random() * 9000));
    setState((s) => {
      const drivers = s.drivers.map((d) => (d.id === driverId ? { ...d, pin: newPin } : d));
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
              syncing={false}
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

      <main className="flex-1 overflow-y-auto pb-24 px-4 pt-4 max-w-2xl mx-auto w-full">
        {tab === 'overview' && (
          <div className="space-y-4 fade-in">
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
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white cursor-pointer"
                  >
                    {state.buses.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => toggleDriver(d.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                      d.status === 'active'
                        ? 'bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30'
                        : 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {d.status === 'active' ? 'Lock Account' : 'Activate'}
                  </button>
                </div>

                <div className="mt-2.5 flex items-center gap-2 flex-wrap pt-2.5 border-t border-slate-800/80">
                  <label className="text-xs text-slate-400 font-medium shrink-0">Driver PIN:</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    defaultValue={d.pin || ''}
                    key={`${d.id}-pin-${d.pin}`}
                    onBlur={(e) => {
                      const v = e.target.value.replace(/\D/g, '');
                      if (v && v !== d.pin) updateDriverPin(d.id, v);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-24 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs font-mono tracking-widest text-center text-white"
                    maxLength={6}
                    title="Change PIN"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Reset PIN for ${d.name}? A new temporary PIN will be generated.`)) {
                        resetDriverPin(d.id);
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 flex items-center gap-1 cursor-pointer"
                  >
                    <Icon name="KeyRound" size={12} /> Reset PIN
                  </button>
                </div>
              </div>
            ))}

            {showAddDriver && (
              <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4 bg-black/80">
                <div className="card w-full max-w-md p-6 fade-in border border-slate-800 shadow-2xl">
                  <h3 className="font-bold text-base mb-1 text-white">Onboard New Driver</h3>
                  <p className="text-xs text-slate-400 mb-4">Create driver profile and assign fleet bus.</p>
                  <div className="space-y-3">
                    <input
                      placeholder="Full Name (e.g. Tariq Mansoor)"
                      value={newDriver.name}
                      onChange={(e) => setNewDriver((f) => ({ ...f, name: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white"
                    />
                    <input
                      placeholder="Driver ID (e.g. DRV-1005)"
                      value={newDriver.id}
                      onChange={(e) => setNewDriver((f) => ({ ...f, id: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white"
                    />
                    <input
                      placeholder="Bus Plate (e.g. DXB-2201)"
                      value={newDriver.bus}
                      onChange={(e) => setNewDriver((f) => ({ ...f, bus: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white"
                    />
                    <input
                      placeholder="PIN (4–6 digits, default matches ID)"
                      value={newDriver.pin}
                      onChange={(e) =>
                        setNewDriver((f) => ({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }))
                      }
                      inputMode="numeric"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono tracking-widest text-white"
                    />
                    <input
                      placeholder="Phone (optional, e.g. +971501234005)"
                      value={newDriver.phone}
                      onChange={(e) => setNewDriver((f) => ({ ...f, phone: e.target.value }))}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white"
                    />
                  </div>
                  <div className="flex gap-2.5 mt-5">
                    <button
                      onClick={() => {
                        setShowAddDriver(false);
                        setNewDriver({ name: '', id: '', bus: '', phone: '', pin: '' });
                      }}
                      className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={addDriver}
                      className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold cursor-pointer shadow-lg shadow-sky-500/20"
                    >
                      Add Driver
                    </button>
                  </div>
                </div>
              </div>
            )}

            {pinResetNotice && (
              <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4 bg-black/80">
                <div className="card w-full max-w-sm p-6 fade-in text-center border border-slate-800 shadow-2xl">
                  <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-3">
                    <Icon name="KeyRound" size={24} />
                  </div>
                  <h3 className="font-bold text-lg mb-1 text-white">Temporary PIN Generated</h3>
                  <p className="text-xs text-slate-400 mb-4">
                    New temporary PIN for{' '}
                    <span className="text-slate-100 font-semibold">
                      {state.drivers.find((x) => x.id === pinResetNotice.driverId)?.name || pinResetNotice.driverId}
                    </span>
                  </p>
                  <div className="bg-slate-800 border border-slate-700 rounded-xl py-4 mb-4">
                    <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-1">
                      Share this PIN with driver
                    </div>
                    <div className="text-3xl font-mono font-bold tracking-[0.3em] text-amber-400">
                      {pinResetNotice.pin}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500 mb-4 leading-relaxed">
                    Driver can now log in using this temporary PIN. Admin can edit it anytime from the roster.
                  </p>
                  <button
                    onClick={() => setPinResetNotice(null)}
                    className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-sm cursor-pointer shadow-lg shadow-sky-500/20"
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
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
              <div>
                <h3 className="font-bold text-white text-base">Master Audit Trail</h3>
                <p className="text-xs text-slate-400">Full tamper-evident shift & expense records</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-56">
                  <input
                    type="text"
                    value={searchAudit}
                    onChange={(e) => setSearchAudit(e.target.value)}
                    placeholder="Search logs…"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500"
                  />
                  <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500">
                    <Icon name="Search" size={14} />
                  </div>
                </div>
                <button
                  onClick={exportAuditCSV}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  title="Export to CSV spreadsheet"
                >
                  <Icon name="Download" size={14} /> Export CSV
                </button>
              </div>
            </div>

            <div className="card overflow-hidden border border-slate-800 shadow-xl">
              <div className="table-wrap">
                <table className="text-xs">
                  <thead>
                    <tr className="bg-slate-900/90 text-slate-400">
                      <th>Time</th>
                      <th>Type</th>
                      <th>Driver</th>
                      <th>Bus</th>
                      <th>Detail</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAudit.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center text-slate-500 py-10">
                          No audit records found
                        </td>
                      </tr>
                    ) : (
                      filteredAudit.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-850/60 transition-colors">
                          <td className="text-slate-400 font-mono">{formatDate(item.createdAt)}</td>
                          <td className="capitalize font-semibold text-slate-300">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] ${
                                item.type === 'trip'
                                  ? 'bg-sky-500/10 text-sky-400'
                                  : item.type === 'extra'
                                  ? 'bg-violet-500/10 text-violet-400'
                                  : 'bg-amber-500/10 text-amber-400'
                              }`}
                            >
                              {item.type}
                            </span>
                          </td>
                          <td className="font-medium text-white">{item.driverName}</td>
                          <td className="font-mono text-sky-400">{item.bus}</td>
                          <td className="text-slate-300 flex items-center gap-1">
                            {item.hasReceipt && (
                              <Icon name="Paperclip" size={12} className="text-amber-400 shrink-0" />
                            )}
                            <span>{item.detail}</span>
                          </td>
                          <td>
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                item.status === 'completed' || item.status === 'logged'
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : item.status === 'in_progress'
                                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                                  : 'bg-slate-800 text-slate-400 border border-slate-700'
                              }`}
                            >
                              {item.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'buses' && (
          <div className="space-y-3 fade-in">
            <div className="flex justify-between items-center mb-1">
              <div>
                <h3 className="font-bold text-white text-base">Fleet Buses</h3>
                <p className="text-xs text-slate-400">Registered transport vehicles & odometer state</p>
              </div>
              <button
                onClick={() => setShowAddBus(true)}
                className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-sky-500/20 cursor-pointer"
              >
                <Icon name="Plus" size={14} /> Add Bus
              </button>
            </div>

            <div className="grid gap-2.5">
              {state.buses.map((b) => {
                const assigned = state.drivers.filter((d) => d.bus === b);
                const lastOdo = lastOdometerForBus(state, b);
                return (
                  <div
                    key={b}
                    className="card p-4 flex items-center justify-between border border-slate-800 shadow-md"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-white text-base flex items-center gap-2">
                        <span>{b}</span>
                        {lastOdo != null && (
                          <span className="text-xs font-normal text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded font-mono">
                            ODO: {Number(lastOdo).toLocaleString('en')} km
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        Assigned to:{' '}
                        {assigned.length ? (
                          <span className="text-slate-200 font-medium">
                            {assigned.map((d) => d.name).join(', ')}
                          </span>
                        ) : (
                          <span className="text-slate-600">Unassigned pool vehicle</span>
                        )}
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-sky-500/15 flex items-center justify-center text-sky-400 shrink-0">
                      <Icon name="Bus" size={20} />
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
