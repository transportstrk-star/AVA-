/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Driver, FleetState, QueueItem } from './types';
import { loadQueue, loadState, saveState } from './utils/storage';
import { LoginScreen } from './components/auth/LoginScreen';
import { DriverPortal } from './components/driver/DriverPortal';
import { AdminPortal } from './components/admin/AdminPortal';
import { Icon } from './components/Icon';

export default function App() {
  const [state, setState] = useState<FleetState>(loadState);
  const [role, setRole] = useState<'driver' | 'admin' | null>(null);
  const [currentDriver, setCurrentDriver] = useState<Driver | null>(null);
  const [online, setOnline] = useState<boolean>(true);
  const [queue, setQueue] = useState<QueueItem[]>(loadQueue);
  const [showPortalSwitcher, setShowPortalSwitcher] = useState(false);

  // Persist state to local storage whenever it changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  const logout = () => {
    setRole(null);
    setCurrentDriver(null);
  };

  const switchToAdmin = () => {
    setRole('admin');
    setShowPortalSwitcher(false);
  };

  const switchToDriver = (d?: Driver) => {
    const driverToUse = d || currentDriver || state.drivers.find((x) => x.status === 'active') || state.drivers[0];
    setCurrentDriver(driverToUse);
    setRole('driver');
    setShowPortalSwitcher(false);
  };

  return (
    <div className="relative min-h-screen bg-slate-950 font-sans text-slate-100 antialiased selection:bg-sky-500 selection:text-white">
      {/* Quick Portal Switcher banner for seamless previewing & testing */}
      {role && (
        <div className="fixed top-2 right-2 z-40">
          <button
            onClick={() => setShowPortalSwitcher((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900/90 border border-slate-700/80 text-[10px] font-semibold text-slate-300 hover:text-white hover:border-slate-600 shadow-lg backdrop-blur cursor-pointer transition-all"
            title="Switch portal view"
          >
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <span>{role === 'driver' ? 'Driver View' : 'Admin View'}</span>
            <Icon name="ChevronDown" size={12} />
          </button>

          {showPortalSwitcher && (
            <div className="absolute right-0 mt-1.5 w-52 p-2 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl z-50 text-xs fade-in">
              <div className="text-[10px] text-slate-500 font-semibold px-2 py-1 uppercase tracking-wider">
                Switch Portal
              </div>
              <button
                onClick={() => switchToDriver()}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left cursor-pointer transition-colors ${
                  role === 'driver' ? 'bg-sky-500/20 text-sky-300 font-semibold' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Icon name="User" size={14} className="text-sky-400" />
                <span>Driver Portal</span>
              </button>
              <button
                onClick={switchToAdmin}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left cursor-pointer transition-colors ${
                  role === 'admin' ? 'bg-violet-500/20 text-violet-300 font-semibold' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Icon name="Shield" size={14} className="text-violet-400" />
                <span>Admin Control</span>
              </button>
              <div className="my-1 border-t border-slate-800" />
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-red-400 hover:bg-red-500/10 cursor-pointer"
              >
                <Icon name="LogOut" size={14} />
                <span>Sign Out / Launcher</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Role Router */}
      {!role && (
        <LoginScreen
          state={state}
          onDriverLogin={(d) => {
            setCurrentDriver(d);
            setRole('driver');
          }}
          onAdminLogin={() => setRole('admin')}
        />
      )}

      {role === 'driver' && currentDriver && (
        <DriverPortal
          state={state}
          setState={setState}
          driver={state.drivers.find((d) => d.id === currentDriver.id) || currentDriver}
          online={online}
          setOnline={setOnline}
          queue={queue}
          setQueue={setQueue}
          onLogout={logout}
        />
      )}

      {role === 'admin' && (
        <AdminPortal
          state={state}
          setState={setState}
          online={online}
          setOnline={setOnline}
          queue={queue}
          setQueue={setQueue}
          onLogout={logout}
        />
      )}
    </div>
  );
}
