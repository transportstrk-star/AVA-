import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Driver, FleetState, QueueItem, StageData, Trip, Expense } from '../../types';
import {
  STAGES,
  RECEIPT_ACCEPT,
  RECEIPT_MAX_BYTES,
  daysAgo,
  fileToReceipt,
  formatBytes,
  formatDate,
  formatKm,
  lastOdometerForBus,
  loadQueue,
  saveQueue,
  saveState,
  shiftDistance,
  uid,
} from '../../utils/storage';
import { Icon } from '../Icon';
import { NetworkBadge } from '../NetworkBadge';
import { ReceiptViewer } from '../ReceiptViewer';
import { WatermarkCamera } from '../WatermarkCamera';

interface DriverPortalProps {
  state: FleetState;
  setState: React.Dispatch<React.SetStateAction<FleetState>>;
  driver: Driver;
  online: boolean;
  setOnline: React.Dispatch<React.SetStateAction<boolean>>;
  queue: QueueItem[];
  setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>;
  onLogout: () => void;
}

export function DriverPortal({
  state,
  setState,
  driver,
  online,
  setOnline,
  queue,
  setQueue,
  onLogout,
}: DriverPortalProps) {
  const [tab, setTab] = useState<'shift' | 'extras' | 'expenses' | 'history'>('shift');
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [cameraOpen, setCameraOpen] = useState<string | null>(null);
  const [odometerInput, setOdometerInput] = useState('');
  
  // Pre-trip check states
  const [setupBus, setSetupBus] = useState(driver.bus || '');
  const [setupBusManual, setSetupBusManual] = useState(false);
  const [setupOdo, setSetupOdo] = useState('');
  const [setupMode, setSetupMode] = useState(false);
  
  // Finish shift states
  const [finishMode, setFinishMode] = useState(false);
  const [endOdo, setEndOdo] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);

  // Extra trip form
  const [extraForm, setExtraForm] = useState({ startKm: '', endKm: '', note: '', time: '' });
  
  // Expense form
  const [expMode, setExpMode] = useState<'calc' | 'direct'>('calc');
  const [expForm, setExpForm] = useState({
    liters: '',
    price: '2.85',
    total: '',
    note: '',
    type: 'fuel',
  });
  
  // Receipt attachment for new expense
  const [receiptDraft, setReceiptDraft] = useState<any>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const receiptTargetRef = useRef<string | null>(null);
  const [viewReceipt, setViewReceipt] = useState<Expense | null>(null);
  const receiptCamRef = useRef<HTMLInputElement | null>(null);
  const receiptFileRef = useRef<HTMLInputElement | null>(null);

  const myTrips = useMemo(() => {
    return (state.trips || [])
      .filter((t) => t.driverId === driver.id && daysAgo(t.createdAt) <= 30)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [state.trips, driver.id]);

  const myExtras = useMemo(() => {
    return (state.extras || [])
      .filter((e) => e.driverId === driver.id && daysAgo(e.createdAt) <= 30)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [state.extras, driver.id]);

  const myExpenses = useMemo(() => {
    return (state.expenses || [])
      .filter((e) => e.driverId === driver.id && daysAgo(e.createdAt) <= 30)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [state.expenses, driver.id]);

  const showToast = (msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  // Find incomplete trip for today
  useEffect(() => {
    const open = myTrips.find((t) => t.status === 'in_progress');
    if (open) setActiveTrip(open);
  }, [myTrips]);

  // Buses offered in the pre-trip selector
  const fleetBuses = useMemo(() => {
    const list = [...((state && state.buses) || [])];
    if (driver.bus && !list.includes(driver.bus)) list.unshift(driver.bus);
    return list;
  }, [state.buses, driver.bus]);

  // Last ODO recorded for the selected bus
  const lastBusOdo = useMemo(
    () => lastOdometerForBus(state, setupBus),
    [state.trips, setupBus]
  );

  const openShiftSetup = () => {
    setSetupBus(driver.bus || fleetBuses[0] || '');
    setSetupBusManual(false);
    setSetupOdo('');
    setSetupMode(true);
  };

  const startNewShift = () => {
    const bus = String(setupBus || '').trim();
    const odo = Number(setupOdo);

    if (!bus) {
      showToast('Select or type a bus number', 'err');
      return;
    }
    const hasStartOdo = setupOdo !== '' && !isNaN(odo);
    if (setupOdo !== '' && (isNaN(odo) || odo < 0)) {
      showToast('ODO must be a number (or leave it blank)', 'err');
      return;
    }
    if (hasStartOdo && lastBusOdo != null && odo < Number(lastBusOdo)) {
      showToast(`ODO cannot be below ${formatKm(lastBusOdo)} (last reading for ${bus})`, 'err');
      return;
    }

    const trip: Trip = {
      id: uid('TRIP'),
      driverId: driver.id,
      driverName: driver.name,
      bus,
      busSource: setupBusManual ? 'manual' : 'auto',
      assignedBus: driver.bus || null,
      startOdometer: hasStartOdo ? odo : null,
      status: 'in_progress',
      stages: {},
      createdAt: Date.now(),
      completedAt: null,
    };

    setState((s) => {
      const next = { ...s, trips: [trip, ...s.trips] };
      saveState(next);
      return next;
    });

    setActiveTrip(trip);
    setSetupMode(false);
    setOdometerInput(hasStartOdo ? String(odo) : '');
    setSetupOdo('');
    enqueue({ type: 'trip_start', data: trip });
    showToast(hasStartOdo ? `Shift started · ${bus} @ ${formatKm(odo)}` : `Shift started · ${bus} (no ODO)`);
  };

  // Highest reading already recorded inside this shift
  const shiftFloor = useMemo(() => {
    if (!activeTrip) return null;
    const nums: number[] = [];
    if (activeTrip.startOdometer != null) nums.push(Number(activeTrip.startOdometer));
    Object.values(activeTrip.stages || {}).forEach((st) => {
      if (st && st.odometer != null) nums.push(Number(st.odometer));
    });
    const clean = nums.filter((n) => !isNaN(n));
    return clean.length ? Math.max(...clean) : null;
  }, [activeTrip]);

  const openFinish = () => {
    setFinishMode(true);
    setEndOdo('');
  };

  const endOdoBlank = endOdo === '';
  const endOdoNum = endOdoBlank ? null : Number(endOdo);
  const endOdoBelowFloor =
    endOdoNum != null && !isNaN(endOdoNum) && shiftFloor != null && endOdoNum < shiftFloor;
  const endOdoValid = endOdoBlank || (endOdoNum != null && !isNaN(endOdoNum) && !endOdoBelowFloor);

  const previewDistance =
    endOdoValid && activeTrip && activeTrip.startOdometer != null && endOdoNum != null
      ? endOdoNum - Number(activeTrip.startOdometer)
      : null;

  const finishShift = () => {
    if (!activeTrip) return;
    const hasEndOdo = endOdo !== '' && endOdoNum != null && !isNaN(endOdoNum);
    if (endOdo !== '' && (endOdoNum == null || isNaN(endOdoNum))) {
      showToast('End ODO must be a number (or leave it blank)', 'err');
      return;
    }
    if (hasEndOdo && endOdoNum < 0) {
      showToast('ODO reading cannot be negative', 'err');
      return;
    }
    if (hasEndOdo && shiftFloor != null && endOdoNum < shiftFloor) {
      const startKm = activeTrip.startOdometer != null ? Number(activeTrip.startOdometer) : shiftFloor;
      showToast(
        endOdoNum < startKm
          ? `End ODO must be at least ${formatKm(startKm)} (shift start)`
          : `End ODO must be at least ${formatKm(shiftFloor)} (highest reading this shift)`,
        'err'
      );
      return;
    }

    const endedAt = Date.now();
    const recorded = Object.keys(activeTrip.stages || {}).length;
    const closedEarly = recorded < STAGES.length;

    setState((s) => {
      const trips = s.trips.map((t) => {
        if (t.id !== activeTrip.id) return t;
        return {
          ...t,
          endOdometer: hasEndOdo ? endOdoNum : null,
          endedAt,
          status: 'completed' as const,
          completedAt: endedAt,
          closedBy: hasEndOdo ? ('end_odo' as const) : ('no_odo' as const),
          closedEarly,
        };
      });
      const next = { ...s, trips };
      saveState(next);
      return next;
    });

    setActiveTrip((prev) =>
      prev
        ? {
            ...prev,
            endOdometer: hasEndOdo ? endOdoNum : null,
            endedAt,
            status: 'completed' as const,
            completedAt: endedAt,
            closedBy: hasEndOdo ? ('end_odo' as const) : ('no_odo' as const),
            closedEarly,
          }
        : prev
    );

    enqueue({
      type: 'trip_end',
      tripId: activeTrip.id,
      driverId: driver.id,
      data: { endOdometer: hasEndOdo ? endOdoNum : null, endedAt, bus: activeTrip.bus },
    });

    setFinishMode(false);
    setEndOdo('');
    setOdometerInput('');
    showToast(hasEndOdo ? `Shift closed · end ODO ${formatKm(endOdoNum)}` : 'Shift closed (no end ODO)');
  };

  const openCameraForStage = (stageKey: string) => {
    if (!odometerInput || isNaN(Number(odometerInput))) {
      showToast('Enter a valid odometer reading first', 'err');
      return;
    }
    const idx = STAGES.findIndex((s) => s.key === stageKey);
    const prevKey = idx > 0 ? STAGES[idx - 1].key : null;
    const prevKm = prevKey && activeTrip && activeTrip.stages[prevKey]
      ? activeTrip.stages[prevKey].odometer
      : null;
    if (prevKm != null && Number(odometerInput) < Number(prevKm)) {
      showToast(`Odometer must be at least ${prevKm} km (previous stage)`, 'err');
      return;
    }
    if (
      stageKey === 'start' &&
      activeTrip &&
      activeTrip.startOdometer != null &&
      Number(odometerInput) < Number(activeTrip.startOdometer)
    ) {
      showToast(`ODO must be at least ${formatKm(activeTrip.startOdometer)} (pre-trip reading)`, 'err');
      return;
    }
    setCameraOpen(stageKey);
  };

  const handleCapture = (
    stageKey: string,
    photoData: { dataUrl: string; gps: { lat: string; lng: string } | null; timestamp: number }
  ) => {
    if (!activeTrip) return;
    const km = Number(odometerInput);
    const stageData: StageData = {
      odometer: km,
      photo: photoData.dataUrl,
      gps: photoData.gps,
      timestamp: photoData.timestamp,
    };

    setState((s) => {
      const trips = s.trips.map((t) => {
        if (t.id !== activeTrip.id) return t;
        const stages = { ...t.stages, [stageKey]: stageData };
        const done = STAGES.every((st) => stages[st.key]);
        return {
          ...t,
          stages,
          status: done ? ('completed' as const) : ('in_progress' as const),
          completedAt: done ? Date.now() : null,
        };
      });
      const next = { ...s, trips };
      saveState(next);
      return next;
    });

    setActiveTrip((prev) => {
      if (!prev) return prev;
      const stages = { ...prev.stages, [stageKey]: stageData };
      const done = STAGES.every((st) => stages[st.key]);
      return {
        ...prev,
        stages,
        status: done ? ('completed' as const) : ('in_progress' as const),
        completedAt: done ? Date.now() : null,
      };
    });

    setCameraOpen(null);
    setOdometerInput('');
    showToast(`Stage "${STAGES.find((s) => s.key === stageKey)?.title}" recorded`);

    enqueue({
      type: 'trip_stage',
      tripId: activeTrip.id,
      stageKey,
      data: stageData,
      driverId: driver.id,
    });
  };

  const flushQueue = useCallback(
    async (items?: QueueItem[]) => {
      const batch = items || queue;
      if (!online || batch.length === 0) return;
      setSyncing(true);
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 400));
      console.log('[FleetShift] Syncing queue to cloud (simulated):', batch);
      const sent = new Set(batch.map((b) => b.id));
      setQueue((q) => {
        const rest = q.filter((x) => !sent.has(x.id));
        saveQueue(rest);
        return rest;
      });
      setSyncing(false);
      showToast(`Synced ${batch.length} item(s)`);
    },
    [online, queue, setQueue]
  );

  const enqueue = (item: any) => {
    const entry: QueueItem = { ...item, id: uid('Q'), queuedAt: Date.now() };
    const base = queue.length >= loadQueue().length ? queue : loadQueue();
    const next = [...base, entry];
    setQueue(next);
    saveQueue(next);
    if (online) flushQueue(next);
  };

  useEffect(() => {
    if (online && queue.length > 0) flushQueue();
  }, [online, queue.length, flushQueue]);

  const submitExtra = () => {
    const rawStart = String(extraForm.startKm ?? '').trim();
    const rawEnd = String(extraForm.endKm ?? '').trim();

    const hasStart = rawStart !== '' && !isNaN(Number(rawStart));
    const hasEnd = rawEnd !== '' && !isNaN(Number(rawEnd));
    const start = hasStart ? Number(rawStart) : null;
    const end = hasEnd ? Number(rawEnd) : null;

    if (!hasStart && rawStart !== '') {
      showToast('Start km must be a number (or leave it blank)', 'err');
      return;
    }
    if (!hasEnd && rawEnd !== '') {
      showToast('End km must be a number (or leave it blank)', 'err');
      return;
    }
    if ((start != null && start < 0) || (end != null && end < 0)) {
      showToast('Odometer values cannot be negative', 'err');
      return;
    }
    if (start != null && end != null && end < start) {
      showToast('End km cannot be lower than start km', 'err');
      return;
    }

    const distance = start != null && end != null ? end - start : null;

    const extra = {
      id: uid('EXT'),
      driverId: driver.id,
      driverName: driver.name,
      bus: (activeTrip && activeTrip.bus) || driver.bus,
      startKm: start,
      endKm: end,
      distance,
      note: extraForm.note || '',
      time: extraForm.time || new Date().toISOString().slice(0, 16),
      createdAt: Date.now(),
    };

    setState((s) => {
      const next = { ...s, extras: [extra, ...s.extras] };
      saveState(next);
      return next;
    });

    enqueue({ type: 'extra', data: extra });
    setExtraForm({ startKm: '', endKm: '', note: '', time: '' });
    showToast(
      distance != null
        ? `Extra trip logged · ${distance} km`
        : 'Extra trip logged (no km readings)'
    );
  };

  const persistState = (next: FleetState) => {
    if (!saveState(next)) {
      showToast('Storage full — remove a receipt or attach a smaller photo', 'err');
      return false;
    }
    setState(next);
    return true;
  };

  const handleReceiptFile = async (file: File | null) => {
    if (!file) return;
    setReceiptBusy(true);
    try {
      const receipt = await fileToReceipt(file);
      const targetId = receiptTargetRef.current;
      if (targetId) {
        const next: FleetState = {
          ...state,
          expenses: state.expenses.map((x) => (x.id === targetId ? { ...x, receipt } : x)),
        };
        if (persistState(next)) showToast('Receipt updated');
        receiptTargetRef.current = null;
      } else {
        setReceiptDraft(receipt);
        showToast('Receipt attached');
      }
    } catch (e: any) {
      showToast(e.message || 'Could not attach file', 'err');
      receiptTargetRef.current = null;
    } finally {
      setReceiptBusy(false);
      if (receiptCamRef.current) receiptCamRef.current.value = '';
      if (receiptFileRef.current) receiptFileRef.current.value = '';
    }
  };

  const pickReceipt = (expenseId: string | null = null, useCamera = false) => {
    receiptTargetRef.current = expenseId;
    const el = useCamera ? receiptCamRef.current : receiptFileRef.current;
    if (el) el.click();
  };

  const removeReceipt = (expenseId: string | null = null) => {
    if (!expenseId) {
      setReceiptDraft(null);
      showToast('Receipt removed');
      return;
    }
    const next: FleetState = {
      ...state,
      expenses: state.expenses.map((x) => (x.id === expenseId ? { ...x, receipt: null } : x)),
    };
    if (persistState(next)) showToast('Receipt removed');
    if (viewReceipt && viewReceipt.id === expenseId) setViewReceipt(null);
  };

  const submitExpense = () => {
    let amount = 0;
    if (expMode === 'calc') {
      const liters = Number(expForm.liters);
      const price = Number(expForm.price);
      if (!liters || !price) {
        showToast('Enter liters and price', 'err');
        return;
      }
      amount = +(liters * price).toFixed(2);
    } else {
      amount = Number(expForm.total);
      if (!amount) {
        showToast('Enter total amount', 'err');
        return;
      }
    }

    const exp: Expense = {
      id: uid('EXP'),
      driverId: driver.id,
      driverName: driver.name,
      bus: (activeTrip && activeTrip.bus) || driver.bus,
      type: expForm.type,
      mode: expMode,
      liters: expMode === 'calc' ? Number(expForm.liters) : null,
      unitPrice: expMode === 'calc' ? Number(expForm.price) : null,
      amount,
      note: expForm.note || '',
      receipt: receiptDraft || null,
      createdAt: Date.now(),
    };

    const { receipt, ...queuePayload } = exp;
    if (!persistState({ ...state, expenses: [exp, ...state.expenses] })) return;

    enqueue({
      type: 'expense',
      data: {
        ...queuePayload,
        receiptMeta: receipt ? { name: receipt.name, type: receipt.type, size: receipt.size } : null,
      },
    });

    setExpForm({ liters: '', price: '2.85', total: '', note: '', type: 'fuel' });
    setReceiptDraft(null);
    showToast(receipt ? 'Expense recorded with receipt' : 'Expense recorded');
  };

  const currentStageIndex = activeTrip
    ? STAGES.findIndex((s) => !activeTrip.stages[s.key])
    : -1;

  const activeBus = (activeTrip && activeTrip.bus) || driver.bus;

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-slate-900/95 border-b border-slate-800 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between gap-2 max-w-xl mx-auto w-full">
          <div className="min-w-0">
            <div className="text-[11px] text-slate-400 font-medium">Driver Portal · AVA Transport</div>
            <div className="font-semibold text-sm truncate text-white">{driver.name}</div>
            <div className="text-[11px] text-sky-400 font-mono flex items-center gap-1">
              <span>{activeBus}</span>
              <span className="text-slate-500">·</span>
              <span>{driver.id}</span>
              {activeTrip && activeTrip.busSource === 'manual' && (
                <span className="ml-1 px-1.5 py-0.2 bg-amber-500/15 text-amber-400 rounded text-[10px] font-semibold">
                  MANUAL BUS
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <NetworkBadge
              online={online}
              syncing={syncing}
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

      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl fade-in flex items-center gap-2 ${
            toast.type === 'err'
              ? 'bg-red-600 text-white border border-red-500'
              : 'bg-emerald-600 text-white border border-emerald-500'
          }`}
        >
          <Icon name={toast.type === 'err' ? 'AlertCircle' : 'CheckCircle'} size={14} />
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pb-24 px-4 pt-4 max-w-xl mx-auto w-full">
        {tab === 'shift' && (
          <div className="space-y-4 fade-in">
            {!activeTrip || setupMode ? (
              <div className="card p-5 border border-slate-800 shadow-xl">
                <div className="flex items-center gap-2 font-semibold mb-1 text-white">
                  <Icon name="ClipboardCheck" size={18} className="text-sky-400" />
                  Pre-Trip Check
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  Confirm the vehicle and odometer reading before beginning your shift.
                </p>

                {/* Bus selector */}
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-400 font-medium">Bus Number</label>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      setupBusManual
                        ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {setupBusManual ? 'MANUAL' : 'AUTO-SELECTED'}
                  </span>
                </div>

                <select
                  value={setupBusManual ? '__manual__' : setupBus}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__manual__') {
                      setSetupBusManual(true);
                    } else {
                      setSetupBusManual(false);
                      setSetupBus(v);
                    }
                  }}
                  className="w-full bg-slate-800/90 border border-slate-700 rounded-xl px-3.5 py-3 font-mono text-sm text-slate-200 mb-2 cursor-pointer"
                >
                  {fleetBuses.map((b) => (
                    <option key={b} value={b}>
                      {b} {b === driver.bus ? '· Assigned to you' : ''}
                    </option>
                  ))}
                  <option value="__manual__">Manual entry…</option>
                </select>

                {setupBusManual && (
                  <input
                    value={setupBus}
                    onChange={(e) => setSetupBus(e.target.value.toUpperCase())}
                    placeholder="e.g. DXB-6600"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-3 font-mono text-sm mb-1.5 uppercase"
                  />
                )}

                <div className="text-[11px] text-slate-500 mb-4">
                  {setupBusManual
                    ? 'Type the bus number if not in list — flagged for fleet admin auditing.'
                    : driver.bus
                    ? `Auto-selected from your profile (${driver.bus}).`
                    : 'No bus assigned to your profile — pick from fleet or enter manually.'}
                </div>

                {/* ODO meter before trip start */}
                <label className="text-xs text-slate-400 block mb-1.5 font-medium">
                  ODO meter before trip start (km) <span className="text-slate-500">· optional</span>
                </label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={setupOdo}
                  onChange={(e) => setSetupOdo(e.target.value)}
                  placeholder="e.g. 124580"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-base font-mono text-white placeholder-slate-600"
                />

                <div className="text-[11px] text-slate-500 mt-1.5 mb-5 space-y-0.5">
                  <div>
                    {lastBusOdo != null
                      ? `Last recorded for ${setupBus || 'this bus'}: ${formatKm(lastBusOdo)}`
                      : `No previous reading on record for ${setupBus || 'this bus'}`}
                  </div>
                  <div className="text-slate-600">
                    Leave blank if meter cannot be read — shift starts cleanly with no initial distance.
                  </div>
                  {setupOdo !== '' && lastBusOdo != null && Number(setupOdo) < Number(lastBusOdo) && (
                    <div className="text-red-400 font-medium">
                      Cannot be lower than the last recorded reading ({formatKm(lastBusOdo)}).
                    </div>
                  )}
                </div>

                <button
                  onClick={startNewShift}
                  disabled={!setupBus}
                  className="w-full py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all shadow-lg shadow-sky-500/20 cursor-pointer"
                >
                  Start Shift · {setupBus || 'Select Bus'}
                </button>

                {setupMode && activeTrip && (
                  <button
                    onClick={() => setSetupMode(false)}
                    className="w-full mt-2.5 text-xs text-slate-400 hover:text-sky-400 py-1 cursor-pointer"
                  >
                    Cancel · Back to shift summary
                  </button>
                )}
              </div>
            ) : activeTrip.status === 'completed' ? (
              <div className="space-y-4">
                <div className="card p-5 border border-emerald-500/40 bg-emerald-500/5 shadow-xl">
                  <div className="flex items-center gap-2 font-semibold text-emerald-300 mb-1">
                    <Icon name="CheckCircle" size={20} /> Shift Complete
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    {activeTrip.bus}
                    {activeTrip.busSource === 'manual' && <span className="text-amber-400"> (manual)</span>}
                    {' '}· Completed {formatDate(activeTrip.completedAt)}
                  </div>

                  <div className="mt-3.5 grid grid-cols-3 gap-2 text-center">
                    <div className="bg-slate-800/80 rounded-xl p-2.5 border border-slate-700/50">
                      <div className="text-[10px] text-slate-400 uppercase tracking-wide">ODO start</div>
                      <div className="font-mono text-xs text-slate-100 font-semibold mt-0.5">
                        {activeTrip.startOdometer != null ? formatKm(activeTrip.startOdometer) : '—'}
                      </div>
                    </div>
                    <div className="bg-slate-800/80 rounded-xl p-2.5 border border-slate-700/50">
                      <div className="text-[10px] text-slate-400 uppercase tracking-wide">ODO end</div>
                      <div className="font-mono text-xs text-slate-100 font-semibold mt-0.5">
                        {activeTrip.endOdometer != null
                          ? formatKm(activeTrip.endOdometer)
                          : activeTrip.stages.final
                          ? formatKm(activeTrip.stages.final.odometer)
                          : '—'}
                      </div>
                    </div>
                    <div className="bg-slate-800/80 rounded-xl p-2.5 border border-slate-700/50">
                      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Distance</div>
                      <div className="font-mono text-xs text-sky-400 font-bold mt-0.5">
                        {formatKm(shiftDistance(activeTrip))}
                      </div>
                    </div>
                  </div>

                  {activeTrip.closedEarly && (
                    <div className="mt-3 text-[11px] text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-lg border border-amber-500/20">
                      Closed with {Object.keys(activeTrip.stages).length} of {STAGES.length} stages recorded.
                    </div>
                  )}

                  <div className="mt-4 space-y-2">
                    <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
                      Shift Stages Log
                    </div>
                    {STAGES.map((st) => {
                      const d = activeTrip.stages[st.key];
                      return (
                        <div
                          key={st.key}
                          className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded bg-slate-800/40"
                        >
                          <span className="text-slate-300 truncate">{st.title}</span>
                          <span className="font-mono text-emerald-400 font-medium shrink-0">
                            {d ? formatKm(d.odometer) : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-sm">
                    <span className="text-slate-400">Total Shift Distance</span>
                    <span className="font-mono font-bold text-sky-400 text-base">
                      {formatKm(shiftDistance(activeTrip))}
                    </span>
                  </div>
                </div>

                <button
                  onClick={openShiftSetup}
                  className="w-full py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold shadow-lg shadow-sky-500/20 transition-all cursor-pointer"
                >
                  Start New Shift
                </button>
              </div>
            ) : (
              <>
                {/* Active shift banner */}
                <div className="card p-3.5 flex items-center justify-between gap-2 text-xs border border-slate-800">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/15 flex items-center justify-center text-sky-400 shrink-0">
                      <Icon name="Bus" size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-white truncate">{activeTrip.bus}</span>
                        <span
                          className={`text-[9px] font-semibold px-1.5 py-0.2 rounded shrink-0 ${
                            activeTrip.busSource === 'manual'
                              ? 'bg-amber-500/15 text-amber-400'
                              : 'bg-emerald-500/15 text-emerald-400'
                          }`}
                        >
                          {activeTrip.busSource === 'manual' ? 'MANUAL' : 'AUTO'}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Started {formatDate(activeTrip.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[10px] text-slate-500 block">ODO start</span>
                    <span className="font-mono font-medium text-slate-200">
                      {formatKm(activeTrip.startOdometer)}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="card p-4 border border-slate-800">
                  <div className="flex justify-between text-xs text-slate-400 mb-2 font-medium">
                    <span>Shift Progress</span>
                    <span className="text-sky-400 font-mono">
                      {Object.keys(activeTrip.stages).length} / 4 stages
                    </span>
                  </div>
                  <div className="stage-bar">
                    <div
                      className="stage-bar-fill"
                      style={{ width: `${(Object.keys(activeTrip.stages).length / 4) * 100}%` }}
                    />
                  </div>
                </div>

                {/* Finish shift card */}
                {!finishMode ? (
                  <button
                    onClick={openFinish}
                    className="w-full card card-hover p-4 flex items-center justify-between text-left border border-slate-800 hover:border-emerald-500/40 transition-all cursor-pointer"
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
                      <Icon name="Flag" size={16} /> Finish Shift
                    </span>
                    <span className="text-[11px] text-slate-400 bg-slate-800 px-2.5 py-1 rounded-lg">
                      Enter End-Trip ODO
                    </span>
                  </button>
                ) : (
                  <div className="card p-5 border border-emerald-500/40 bg-slate-900/90 fade-in shadow-xl">
                    <div className="flex items-center gap-2 font-semibold mb-1 text-emerald-300">
                      <Icon name="Flag" size={16} /> End of Trip
                    </div>
                    <p className="text-xs text-slate-400 mb-3">
                      Enter the ODO meter reading now to close and seal this shift.
                    </p>
                    <label className="text-xs text-slate-400 block mb-1 font-medium">
                      ODO meter at end of trip (km) <span className="text-slate-500">· optional</span>
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={endOdo}
                      onChange={(e) => setEndOdo(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && finishShift()}
                      placeholder={shiftFloor != null ? String(shiftFloor) : 'e.g. 124712'}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-base font-mono text-white placeholder-slate-600 mb-2"
                      autoFocus
                    />

                    <div className="text-[11px] text-slate-400 space-y-1 mb-4">
                      <div>Started at: <span className="font-mono text-slate-200">{formatKm(activeTrip.startOdometer)}</span></div>
                      <div>Highest reading so far: <span className="font-mono text-slate-200">{formatKm(shiftFloor)}</span></div>
                      <div className="text-slate-500">Leave blank to close without an end reading.</div>
                      {endOdo !== '' && endOdoValid && (
                        <div className="text-emerald-400 font-medium">
                          Distance for this shift: {formatKm(previewDistance)}
                        </div>
                      )}
                      {endOdo !== '' && !endOdoValid && (
                        <div className="text-red-400 font-medium">
                          End ODO cannot be below {formatKm(shiftFloor)}.
                        </div>
                      )}
                      {Object.keys(activeTrip.stages).length < STAGES.length && (
                        <div className="text-amber-400 text-[11px]">
                          {STAGES.length - Object.keys(activeTrip.stages).length} stage(s) not yet recorded — shift will be logged as partial.
                        </div>
                      )}
                    </div>

                    <button
                      onClick={finishShift}
                      disabled={!endOdoValid}
                      className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm cursor-pointer shadow-lg shadow-emerald-500/20"
                    >
                      Confirm End & Close Shift
                    </button>
                    <button
                      onClick={() => {
                        setFinishMode(false);
                        setEndOdo('');
                      }}
                      className="w-full mt-2 text-xs text-slate-400 hover:text-sky-400 py-1.5 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Stages list */}
                {STAGES.map((stage, idx) => {
                  const done = !!activeTrip.stages[stage.key];
                  const isCurrent = idx === currentStageIndex;
                  const data = activeTrip.stages[stage.key];

                  return (
                    <div
                      key={stage.key}
                      className={`card p-4 transition-all border ${
                        done
                          ? 'stage-done border-emerald-500/40'
                          : isCurrent
                          ? 'stage-active border-sky-500'
                          : 'stage-locked border-slate-800'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                            done
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : isCurrent
                              ? 'bg-sky-500/20 text-sky-400'
                              : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          <Icon name={done ? 'Check' : stage.icon} size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-white flex items-center justify-between">
                            <span>{stage.title}</span>
                            {done && (
                              <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full font-medium">
                                Recorded
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 mb-2">{stage.subtitle}</div>

                          {done && data && (
                            <div className="mt-2 space-y-2">
                              <div className="text-xs font-mono text-emerald-300 font-semibold flex items-center gap-2">
                                <span>{formatKm(data.odometer)}</span>
                                <span className="text-slate-600">·</span>
                                <span className="text-slate-400 font-normal">{formatDate(data.timestamp)}</span>
                              </div>
                              {data.photo && (
                                <img
                                  src={data.photo}
                                  alt="Odometer verification proof"
                                  className="rounded-xl max-h-36 object-cover border border-slate-700 w-full"
                                />
                              )}
                            </div>
                          )}

                          {isCurrent && (
                            <div className="mt-3 space-y-3">
                              <div>
                                <label className="text-xs text-slate-400 block mb-1 font-medium">
                                  Current Odometer (km)
                                </label>
                                <input
                                  type="number"
                                  inputMode="decimal"
                                  value={odometerInput}
                                  onChange={(e) => setOdometerInput(e.target.value)}
                                  placeholder="e.g. 124580"
                                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-base font-mono text-white placeholder-slate-600"
                                />
                                {stage.key === 'start' && activeTrip.startOdometer != null && (
                                  <div className="text-[11px] text-slate-500 mt-1">
                                    Pre-trip declared ODO: {formatKm(activeTrip.startOdometer)}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => openCameraForStage(stage.key)}
                                className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-sky-500/20"
                              >
                                <Icon name="Camera" size={18} />
                                Capture Photo & Save Stage
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {tab === 'extras' && (
          <div className="space-y-4 fade-in">
            <div className="card p-5 border border-slate-800 shadow-xl">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-white">
                <Icon name="Route" size={18} className="text-sky-400" /> Extra / Inter-City Trip
              </h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs text-slate-400 font-medium">Start km (optional)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={extraForm.startKm}
                    onChange={(e) => setExtraForm((f) => ({ ...f, startKm: e.target.value }))}
                    placeholder="—"
                    className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 font-mono text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 font-medium">End km (optional)</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={extraForm.endKm}
                    onChange={(e) => setExtraForm((f) => ({ ...f, endKm: e.target.value }))}
                    placeholder="—"
                    className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 font-mono text-sm text-white"
                  />
                </div>
              </div>

              <div className="text-[11px] text-slate-500 -mt-1 mb-3">
                {extraForm.startKm !== '' &&
                extraForm.endKm !== '' &&
                !isNaN(Number(extraForm.startKm)) &&
                !isNaN(Number(extraForm.endKm)) &&
                Number(extraForm.endKm) >= Number(extraForm.startKm) ? (
                  <span className="text-emerald-400 font-semibold">
                    Computed Distance: {Number(extraForm.endKm) - Number(extraForm.startKm)} km
                  </span>
                ) : (
                  'Both km readings are optional — enter both to derive distance.'
                )}
              </div>

              <div className="mb-3">
                <label className="text-xs text-slate-400 font-medium">Departure Time</label>
                <input
                  type="datetime-local"
                  value={extraForm.time}
                  onChange={(e) => setExtraForm((f) => ({ ...f, time: e.target.value }))}
                  className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white"
                />
              </div>

              <div className="mb-4">
                <label className="text-xs text-slate-400 font-medium">Route / Purpose Note</label>
                <input
                  type="text"
                  value={extraForm.note}
                  onChange={(e) => setExtraForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="e.g. Airport VIP shuttle, Abu Dhabi run"
                  className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white"
                />
              </div>

              <button
                onClick={submitExtra}
                className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-sm cursor-pointer shadow-lg shadow-sky-500/20"
              >
                Log Extra Trip
              </button>
            </div>

            {myExtras.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-slate-500 uppercase tracking-wide font-medium px-1">
                  Recent Extras (30 Days)
                </div>
                {myExtras.map((ex) => (
                  <div key={ex.id} className="card p-3.5 text-sm border border-slate-800">
                    <div className="flex justify-between items-center gap-2">
                      <span className="font-semibold font-mono text-xs text-slate-200">
                        {ex.startKm != null ? formatKm(ex.startKm) : '—'}
                        {' → '}
                        {ex.endKm != null ? formatKm(ex.endKm) : '—'}
                      </span>
                      {ex.distance != null ? (
                        <span className="text-sky-400 font-mono text-xs font-bold shrink-0 bg-sky-500/10 px-2 py-0.5 rounded">
                          {ex.distance} km
                        </span>
                      ) : (
                        <span className="text-slate-500 text-xs shrink-0">No distance</span>
                      )}
                    </div>
                    {ex.note && <div className="text-slate-400 text-xs mt-1.5">{ex.note}</div>}
                    <div className="text-[11px] text-slate-500 mt-1">{formatDate(ex.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'expenses' && (
          <div className="space-y-4 fade-in">
            <div className="card p-5 border border-slate-800 shadow-xl">
              <h3 className="font-semibold mb-3 flex items-center gap-2 text-white">
                <Icon name="Fuel" size={18} className="text-amber-400" /> Fuel & Operational Expenses
              </h3>

              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setExpMode('calc')}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                    expMode === 'calc'
                      ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Calculation (Liters × Rate)
                </button>
                <button
                  onClick={() => setExpMode('direct')}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-colors ${
                    expMode === 'direct'
                      ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  Direct Entry
                </button>
              </div>

              <div className="mb-3">
                <label className="text-xs text-slate-400 font-medium">Expense Category</label>
                <select
                  value={expForm.type}
                  onChange={(e) => setExpForm((f) => ({ ...f, type: e.target.value }))}
                  className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white cursor-pointer"
                >
                  <option value="fuel">Fuel (Diesel / Super / Special)</option>
                  <option value="wash">Vehicle Wash / Cleaning</option>
                  <option value="parking">Parking / Tolls</option>
                  <option value="maintenance">Minor Maintenance / Fluids</option>
                  <option value="other">Other Operational</option>
                </select>
              </div>

              {expMode === 'calc' ? (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-slate-400 font-medium">Liters</label>
                    <input
                      type="number"
                      step="0.01"
                      value={expForm.liters}
                      onChange={(e) => setExpForm((f) => ({ ...f, liters: e.target.value }))}
                      placeholder="e.g. 50"
                      className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 font-medium">Price / L (AED)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={expForm.price}
                      onChange={(e) => setExpForm((f) => ({ ...f, price: e.target.value }))}
                      placeholder="2.85"
                      className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-mono text-white"
                    />
                  </div>
                  {expForm.liters && expForm.price && (
                    <div className="col-span-2 text-center text-sm text-emerald-400 font-mono font-semibold py-1 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                      = {(Number(expForm.liters) * Number(expForm.price)).toFixed(2)} AED
                    </div>
                  )}
                </div>
              ) : (
                <div className="mb-3">
                  <label className="text-xs text-slate-400 font-medium">Total Amount (AED)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={expForm.total}
                    onChange={(e) => setExpForm((f) => ({ ...f, total: e.target.value }))}
                    placeholder="0.00"
                    className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-mono text-white"
                  />
                </div>
              )}

              <div className="mb-3">
                <label className="text-xs text-slate-400 font-medium">Station / Description Note</label>
                <input
                  type="text"
                  value={expForm.note}
                  onChange={(e) => setExpForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="e.g. ADNOC Al Barsha station"
                  className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white"
                />
              </div>

              {/* Receipt upload */}
              <div className="mb-4">
                <label className="text-xs text-slate-400 block mb-1 font-medium">
                  Receipt Attachment <span className="text-slate-600">· optional</span>
                </label>
                {receiptBusy ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-3 bg-slate-800/50 rounded-xl px-3 border border-slate-700">
                    <Icon name="Loader" size={14} className="animate-spin text-sky-400" /> Compressing receipt…
                  </div>
                ) : receiptDraft ? (
                  <div className="flex items-center gap-2.5 bg-slate-800/80 border border-slate-700 rounded-xl p-2.5">
                    {receiptDraft.type && receiptDraft.type.startsWith('image/') ? (
                      <img
                        src={receiptDraft.dataUrl}
                        alt="Receipt preview"
                        className="w-12 h-12 object-cover rounded-lg border border-slate-700 shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center shrink-0">
                        <Icon name="FileText" size={20} className="text-slate-300" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium truncate text-slate-200">{receiptDraft.name}</div>
                      <div className="text-[10px] text-slate-400">
                        {receiptDraft.type === 'application/pdf' ? 'PDF' : 'Photo'} · {formatBytes(receiptDraft.size)}
                      </div>
                    </div>
                    <button
                      onClick={() => removeReceipt(null)}
                      className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 shrink-0 cursor-pointer"
                    >
                      <Icon name="X" size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => pickReceipt(null, true)}
                      className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Icon name="Camera" size={15} /> Take Photo
                    </button>
                    <button
                      onClick={() => pickReceipt(null, false)}
                      className="py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Icon name="Upload" size={15} /> Upload File
                    </button>
                  </div>
                )}
                <div className="text-[10px] text-slate-500 mt-1.5">
                  Photo or PDF up to {formatBytes(RECEIPT_MAX_BYTES)}. Photos are automatically compressed for offline storage.
                </div>
              </div>

              <button
                onClick={submitExpense}
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm cursor-pointer shadow-lg shadow-amber-500/20 transition-all"
              >
                {receiptDraft ? 'Save Expense + Receipt' : 'Save Expense'}
              </button>
            </div>

            {myExpenses.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-slate-500 uppercase tracking-wide font-medium px-1">
                  Recent Expenses (30 Days)
                </div>
                {myExpenses.map((ex) => (
                  <div key={ex.id} className="card p-3.5 text-sm border border-slate-800">
                    <div className="flex justify-between items-center">
                      <span className="capitalize font-semibold text-slate-200">{ex.type}</span>
                      <span className="text-amber-400 font-mono font-bold">
                        {Number(ex.amount || 0).toFixed(2)} AED
                      </span>
                    </div>
                    {ex.liters && (
                      <div className="text-xs text-slate-400 mt-0.5 font-mono">
                        {ex.liters} L @ {ex.unitPrice} AED/L
                      </div>
                    )}
                    {ex.note && <div className="text-slate-400 text-xs mt-1">{ex.note}</div>}

                    {ex.receipt && ex.receipt.dataUrl ? (
                      <div className="flex items-center gap-2.5 mt-2.5 pt-2.5 border-t border-slate-800/80">
                        {ex.receipt.type && ex.receipt.type.startsWith('image/') ? (
                          <img
                            src={ex.receipt.dataUrl}
                            alt="Receipt"
                            onClick={() => setViewReceipt(ex)}
                            className="w-11 h-11 object-cover rounded-lg border border-slate-700 cursor-pointer shrink-0 hover:opacity-80 transition-opacity"
                          />
                        ) : (
                          <div
                            onClick={() => setViewReceipt(ex)}
                            className="w-11 h-11 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center cursor-pointer shrink-0 hover:bg-slate-700 transition-colors"
                          >
                            <Icon name="FileText" size={16} className="text-sky-400" />
                          </div>
                        )}
                        <button
                          onClick={() => setViewReceipt(ex)}
                          className="flex-1 text-left text-xs text-sky-400 font-medium min-w-0 cursor-pointer"
                        >
                          View Receipt
                          <span className="block text-[10px] text-slate-500 font-normal truncate">
                            {ex.receipt.name || 'receipt'} · {formatBytes(ex.receipt.size)}
                          </span>
                        </button>
                        <button
                          onClick={() => pickReceipt(ex.id, false)}
                          title="Replace receipt"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 shrink-0 cursor-pointer"
                        >
                          <Icon name="RefreshCw" size={13} />
                        </button>
                        <button
                          onClick={() => removeReceipt(ex.id)}
                          title="Remove receipt"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 shrink-0 cursor-pointer"
                        >
                          <Icon name="Trash2" size={13} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-slate-800">
                        <span className="text-[11px] text-slate-500">No receipt attached</span>
                        <button
                          onClick={() => pickReceipt(ex.id, false)}
                          className="text-[11px] text-amber-400 font-medium flex items-center gap-1 shrink-0 hover:underline cursor-pointer"
                        >
                          <Icon name="Paperclip" size={12} /> Attach Receipt
                        </button>
                      </div>
                    )}

                    <div className="text-[10px] text-slate-500 mt-1">{formatDate(ex.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="space-y-3 fade-in">
            <div className="text-xs text-slate-500 uppercase tracking-wide font-medium px-1">
              Your Logs (Last 30 Days)
            </div>
            {myTrips.length === 0 && (
              <div className="card p-8 text-center text-slate-500 text-sm border border-slate-800">
                <Icon name="History" size={32} className="mx-auto mb-2 text-slate-600" />
                No shifts recorded in the last 30 days.
              </div>
            )}
            {myTrips.map((t) => (
              <div key={t.id} className="card p-4 border border-slate-800 shadow-md">
                <div className="flex justify-between items-start mb-2.5">
                  <div>
                    <div className="font-semibold text-sm text-white">{formatDate(t.createdAt)}</div>
                    <div className="text-xs text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                      <span>{t.bus}</span>
                      {t.busSource === 'manual' && (
                        <span className="text-[9px] text-amber-400 bg-amber-500/10 px-1 rounded">MANUAL</span>
                      )}
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      t.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    {t.status === 'completed' ? 'Completed' : 'In Progress'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                  <div className="bg-slate-800/60 rounded-lg p-2">
                    <div className="text-slate-500 text-[10px]">Start ODO</div>
                    <div className="font-mono text-slate-200 font-medium">
                      {t.startOdometer != null ? formatKm(t.startOdometer) : '—'}
                    </div>
                  </div>
                  <div className="bg-slate-800/60 rounded-lg p-2">
                    <div className="text-slate-500 text-[10px]">End ODO</div>
                    <div className="font-mono text-slate-200 font-medium">
                      {t.endOdometer != null
                        ? formatKm(t.endOdometer)
                        : t.stages.final
                        ? formatKm(t.stages.final.odometer)
                        : '—'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {STAGES.map((s) => {
                    const d = t.stages[s.key];
                    return (
                      <div key={s.key} className="bg-slate-800/40 rounded-lg p-2">
                        <div className="text-slate-500 text-[10px] truncate">{s.title}</div>
                        <div className="font-mono text-sky-400 font-medium">{d ? formatKm(d.odometer) : '—'}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-2.5 pt-2 border-t border-slate-800 flex justify-between items-center text-xs">
                  <span className="text-slate-500">Calculated Distance</span>
                  <span className="font-mono font-bold text-sky-400">
                    {formatKm(shiftDistance(t))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 bg-slate-900/95 border-t border-slate-800 backdrop-blur safe-bottom z-30">
        <div className="flex justify-around py-2 max-w-xl mx-auto">
          {[
            { id: 'shift' as const, icon: 'ClipboardList', label: 'Shift' },
            { id: 'extras' as const, icon: 'Route', label: 'Extras' },
            { id: 'expenses' as const, icon: 'Wallet', label: 'Expenses' },
            { id: 'history' as const, icon: 'History', label: 'History' },
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

      {/* Hidden file pickers */}
      <input
        ref={receiptCamRef}
        type="file"
        accept={RECEIPT_ACCEPT}
        capture="environment"
        className="hidden"
        onChange={(e) => handleReceiptFile(e.target.files && e.target.files[0])}
      />
      <input
        ref={receiptFileRef}
        type="file"
        accept={RECEIPT_ACCEPT}
        className="hidden"
        onChange={(e) => handleReceiptFile(e.target.files && e.target.files[0])}
      />

      {/* Receipt modal */}
      {viewReceipt && viewReceipt.receipt && (
        <ReceiptViewer
          expense={viewReceipt}
          onClose={() => setViewReceipt(null)}
          onReplace={(id) => pickReceipt(id, false)}
          onRemove={(id) => removeReceipt(id)}
        />
      )}

      {/* Watermarked camera */}
      {cameraOpen && (
        <WatermarkCamera
          driver={driver}
          bus={activeTrip ? activeTrip.bus : driver.bus}
          onCapture={(data) => handleCapture(cameraOpen, data)}
          onCancel={() => setCameraOpen(null)}
        />
      )}
    </div>
  );
}
