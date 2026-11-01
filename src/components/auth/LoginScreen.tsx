import { useState, useRef } from 'react';
import { Driver, FleetState } from '../../types';
import { ADMIN_PASS } from '../../utils/storage';
import { Icon } from '../Icon';

interface LoginScreenProps {
  state: FleetState;
  onDriverLogin: (driver: Driver) => void;
  onAdminLogin: () => void;
  forceDriver?: boolean;
  forceAdmin?: boolean;
}

export function LoginScreen({
  state,
  onDriverLogin,
  onAdminLogin,
  forceDriver = false,
  forceAdmin = false,
}: LoginScreenProps) {
  const initialMode = forceDriver ? 'driver' : forceAdmin ? 'admin' : null;
  const [mode, setMode] = useState<'driver' | 'admin' | null>(initialMode);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [driverPin, setDriverPin] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [error, setError] = useState('');
  const [showForgotPin, setShowForgotPin] = useState(false);
  const pinRef = useRef<HTMLInputElement | null>(null);

  const activeDrivers = (state.drivers || []).filter((d) => d.status === 'active');

  const tryAdmin = () => {
    if (adminPass === ADMIN_PASS) {
      onAdminLogin();
    } else {
      setError('Incorrect passcode (default is admin123)');
    }
  };

  const tryDriver = () => {
    const d = state.drivers.find((x) => x.id === selectedDriver);
    if (!d || d.status !== 'active') {
      setError('Please select an active driver');
      return;
    }
    const expected = String(d.pin || '').trim();
    const entered = String(driverPin || '').trim();
    if (!entered) {
      setError('Enter your PIN');
      return;
    }
    if (entered !== expected) {
      setError('Incorrect PIN');
      setDriverPin('');
      if (pinRef.current) pinRef.current.focus();
      return;
    }
    setError('');
    onDriverLogin(d);
  };

  const quickLoginDriver = (driverId: string) => {
    const d = state.drivers.find((x) => x.id === driverId);
    if (d) {
      setSelectedDriver(d.id);
      setDriverPin(d.pin);
      setError('');
      onDriverLogin(d);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="text-center mb-8 max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center mx-auto mb-3 shadow-xl shadow-sky-500/10">
          <Icon name="Bus" size={32} />
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
          <span>FleetShift</span>
          <span className="text-[11px] bg-sky-500/15 text-sky-400 px-2 py-0.5 rounded-full font-mono font-medium">
            v1.6
          </span>
        </h1>
        <p className="text-slate-400 text-xs mt-1.5 leading-relaxed">
          {forceDriver
            ? 'Driver Portal · AVA Transport'
            : forceAdmin
            ? 'Admin Control Center · AVA Transport'
            : 'AVA Transport · Trip Logger & Fleet Management'}
        </p>
      </div>

      {!mode && (
        <div className="w-full max-w-sm space-y-3 fade-in">
          <button
            onClick={() => setMode('driver')}
            className="w-full card card-hover p-5 text-left flex items-center gap-4 border border-slate-800 hover:border-sky-500/50 transition-all cursor-pointer shadow-lg"
          >
            <div className="w-12 h-12 rounded-xl bg-sky-500/20 flex items-center justify-center text-sky-400 shrink-0">
              <Icon name="User" size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-white text-base">Driver Portal</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Log shifts, ODO meters, watermarked photos & receipts
              </div>
            </div>
            <Icon name="ChevronRight" size={18} className="text-slate-500" />
          </button>

          <button
            onClick={() => setMode('admin')}
            className="w-full card card-hover p-5 text-left flex items-center gap-4 border border-slate-800 hover:border-violet-500/50 transition-all cursor-pointer shadow-lg"
          >
            <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center text-violet-400 shrink-0">
              <Icon name="Shield" size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-white text-base">Admin Control Center</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Roster, PIN reset, fleet buses & master audit trail
              </div>
            </div>
            <Icon name="ChevronRight" size={18} className="text-slate-500" />
          </button>

          {/* Quick Demo Accounts */}
          <div className="mt-8 pt-6 border-t border-slate-800/80">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold text-center mb-3">
              Fast Demo Accounts (1-Click)
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              {activeDrivers.slice(0, 3).map((d) => (
                <button
                  key={d.id}
                  onClick={() => quickLoginDriver(d.id)}
                  className="p-2.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-left cursor-pointer transition-colors"
                >
                  <div className="text-white font-medium truncate">{d.name.split(' ')[0]}</div>
                  <div className="text-[10px] text-sky-400">{d.bus} · PIN {d.pin}</div>
                </button>
              ))}
              <button
                onClick={() => {
                  setAdminPass(ADMIN_PASS);
                  onAdminLogin();
                }}
                className="p-2.5 rounded-xl bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/30 text-left cursor-pointer transition-colors"
              >
                <div className="text-violet-300 font-medium">Fleet Admin</div>
                <div className="text-[10px] text-violet-400">Pass: admin123</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'driver' && (
        <div className="w-full max-w-sm card p-6 fade-in border border-slate-800 shadow-2xl">
          {!forceDriver && (
            <button
              onClick={() => {
                setMode(null);
                setError('');
                setDriverPin('');
              }}
              className="text-xs text-slate-400 hover:text-white mb-4 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Icon name="ArrowLeft" size={14} /> Back to Launcher
            </button>
          )}

          <h2 className="font-bold text-lg text-white mb-1">Driver Login</h2>
          <p className="text-xs text-slate-400 mb-4">Select your profile and enter your 4-digit PIN</p>

          <label className="text-xs text-slate-400 block mb-1.5 font-medium">Driver Profile</label>
          <select
            value={selectedDriver}
            onChange={(e) => {
              setSelectedDriver(e.target.value);
              setError('');
              setDriverPin('');
            }}
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-3 text-sm text-white mb-4 cursor-pointer"
          >
            <option value="">— Select Driver —</option>
            {activeDrivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.bus}
              </option>
            ))}
          </select>

          <label className="text-xs text-slate-400 block mb-1.5 font-medium">Security PIN</label>
          <input
            ref={pinRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={driverPin}
            onChange={(e) => {
              setDriverPin(e.target.value.replace(/\D/g, ''));
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && tryDriver()}
            placeholder="••••"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-3 mb-4 text-center text-2xl tracking-[0.4em] font-semibold text-white placeholder-slate-600 font-mono"
            autoComplete="off"
          />

          {error && (
            <div className="text-red-400 text-xs mb-3.5 flex items-center gap-1.5 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20">
              <Icon name="AlertCircle" size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={tryDriver}
            disabled={!selectedDriver}
            className="w-full py-3.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm cursor-pointer shadow-lg shadow-sky-500/20 transition-all"
          >
            Unlock Portal
          </button>

          <button
            type="button"
            onClick={() => setShowForgotPin(true)}
            className="w-full mt-3 text-xs text-slate-400 hover:text-sky-400 py-1 cursor-pointer transition-colors"
          >
            Forgot PIN?
          </button>

          <div className="mt-4 pt-4 border-t border-slate-800/80 text-[11px] text-slate-500 text-center">
            Demo PINs match the driver ID: Ahmed (1001), Mohammed (1002), Fatima (1003).
          </div>
        </div>
      )}

      {showForgotPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4 bg-black/80">
          <div className="card w-full max-w-sm p-6 fade-in border border-slate-800 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center mx-auto mb-3">
              <Icon name="KeyRound" size={24} />
            </div>
            <h3 className="font-bold text-center text-lg mb-2 text-white">Forgot your PIN?</h3>
            <p className="text-xs text-slate-400 text-center mb-4 leading-relaxed">
              For security, driver PINs are centrally managed. Contact your AVA Transport fleet manager or administrator to request a PIN reset.
            </p>
            <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-3 mb-4 text-xs text-slate-300">
              <div className="font-semibold text-slate-200 mb-1.5 flex items-center gap-1.5">
                <Icon name="Shield" size={14} className="text-sky-400" /> Admin Reset Procedure:
              </div>
              <ol className="list-decimal list-inside space-y-1 text-slate-400">
                <li>Admin logs into Admin Control Center</li>
                <li>Navigates to the <strong className="text-slate-200">Roster</strong> tab</li>
                <li>Clicks <strong className="text-amber-400">Reset PIN</strong> on your profile</li>
                <li>Provides you with the new 4-digit temporary PIN</li>
              </ol>
            </div>
            <button
              onClick={() => setShowForgotPin(false)}
              className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-semibold text-sm cursor-pointer shadow-lg shadow-sky-500/20"
            >
              Understood
            </button>
          </div>
        </div>
      )}

      {mode === 'admin' && (
        <div className="w-full max-w-sm card p-6 fade-in border border-slate-800 shadow-2xl">
          {!forceAdmin && (
            <button
              onClick={() => {
                setMode(null);
                setError('');
                setAdminPass('');
              }}
              className="text-xs text-slate-400 hover:text-white mb-4 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <Icon name="ArrowLeft" size={14} /> Back to Launcher
            </button>
          )}
          <h2 className="font-bold text-lg text-white mb-1">Admin Passcode</h2>
          <p className="text-xs text-slate-400 mb-4">Enter master passcode for fleet control</p>
          <input
            type="password"
            value={adminPass}
            onChange={(e) => {
              setAdminPass(e.target.value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && tryAdmin()}
            placeholder="Enter passcode"
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-3 mb-4 text-center tracking-widest text-lg font-mono text-white placeholder-slate-600"
            autoFocus
          />
          {error && (
            <div className="text-red-400 text-xs mb-3.5 flex items-center gap-1.5 bg-red-500/10 p-2.5 rounded-lg border border-red-500/20">
              <Icon name="AlertCircle" size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <button
            onClick={tryAdmin}
            className="w-full py-3.5 rounded-xl bg-violet-500 hover:bg-violet-400 text-white font-semibold text-sm cursor-pointer shadow-lg shadow-violet-500/20 transition-all"
          >
            Unlock Control Center
          </button>
          <p className="text-[11px] text-slate-500 text-center mt-3 font-mono">Default passcode: admin123</p>
        </div>
      )}
    </div>
  );
}
