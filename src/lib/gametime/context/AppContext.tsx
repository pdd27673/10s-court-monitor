'use client';

import React, { createContext, useContext, useEffect, useReducer, useCallback } from 'react';
import type { UserPreferences, FilterState, Sport } from '../types';
import { DEFAULT_PREFS, DEFAULT_FILTERS } from '../types';
import { detectTimezone } from '../time';

interface AppState {
  prefs: UserPreferences;
  filters: FilterState;
  searchOpen: boolean;
  drawerEventId: string | null;
  sidebarOpen: boolean;
}

type Action =
  | { type: 'SET_TIMEZONE'; payload: string }
  | { type: 'SET_USE24H'; payload: boolean }
  | { type: 'TOGGLE_THEME' }
  | { type: 'SET_DENSE_MODE'; payload: boolean }
  | { type: 'SET_SPOILER_SAFE'; payload: boolean }
  | { type: 'TOGGLE_FAVORITE_SPORT'; payload: Sport }
  | { type: 'TOGGLE_SAVED_EVENT'; payload: string }
  | { type: 'TOGGLE_REMINDED_EVENT'; payload: string }
  | { type: 'SET_FILTER'; payload: Partial<FilterState> }
  | { type: 'RESET_FILTERS' }
  | { type: 'OPEN_SEARCH' }
  | { type: 'CLOSE_SEARCH' }
  | { type: 'OPEN_DRAWER'; payload: string }
  | { type: 'CLOSE_DRAWER' }
  | { type: 'TOGGLE_SIDEBAR' };

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_TIMEZONE':
      return { ...state, prefs: { ...state.prefs, timezone: action.payload } };
    case 'SET_USE24H':
      return { ...state, prefs: { ...state.prefs, use24h: action.payload } };
    case 'TOGGLE_THEME':
      return { ...state, prefs: { ...state.prefs, theme: state.prefs.theme === 'dark' ? 'light' : 'dark' } };
    case 'SET_DENSE_MODE':
      return { ...state, prefs: { ...state.prefs, denseMode: action.payload } };
    case 'SET_SPOILER_SAFE':
      return { ...state, prefs: { ...state.prefs, spoilerSafe: action.payload } };
    case 'TOGGLE_FAVORITE_SPORT': {
      const sports = state.prefs.favoriteSports.includes(action.payload)
        ? state.prefs.favoriteSports.filter(s => s !== action.payload)
        : [...state.prefs.favoriteSports, action.payload];
      return { ...state, prefs: { ...state.prefs, favoriteSports: sports } };
    }
    case 'TOGGLE_SAVED_EVENT': {
      const ids = state.prefs.savedEventIds.includes(action.payload)
        ? state.prefs.savedEventIds.filter(id => id !== action.payload)
        : [...state.prefs.savedEventIds, action.payload];
      return { ...state, prefs: { ...state.prefs, savedEventIds: ids } };
    }
    case 'TOGGLE_REMINDED_EVENT': {
      const ids = state.prefs.remindedEventIds.includes(action.payload)
        ? state.prefs.remindedEventIds.filter(id => id !== action.payload)
        : [...state.prefs.remindedEventIds, action.payload];
      return { ...state, prefs: { ...state.prefs, remindedEventIds: ids } };
    }
    case 'SET_FILTER':
      return { ...state, filters: { ...state.filters, ...action.payload } };
    case 'RESET_FILTERS':
      return { ...state, filters: DEFAULT_FILTERS };
    case 'OPEN_SEARCH':
      return { ...state, searchOpen: true };
    case 'CLOSE_SEARCH':
      return { ...state, searchOpen: false };
    case 'OPEN_DRAWER':
      return { ...state, drawerEventId: action.payload };
    case 'CLOSE_DRAWER':
      return { ...state, drawerEventId: null };
    case 'TOGGLE_SIDEBAR':
      return { ...state, sidebarOpen: !state.sidebarOpen };
    default:
      return state;
  }
}

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  isSaved: (id: string) => boolean;
  isReminded: (id: string) => boolean;
  isFavoriteSport: (sport: Sport) => boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

const STORAGE_KEY = 'gametime-grid-prefs';

function loadPrefs(): Partial<UserPreferences> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const tz = typeof window !== 'undefined' ? detectTimezone() : 'UTC';
  const saved = loadPrefs();

  const initialState: AppState = {
    prefs: { ...DEFAULT_PREFS, timezone: tz, ...saved },
    filters: DEFAULT_FILTERS,
    searchOpen: false,
    drawerEventId: null,
    sidebarOpen: false,
  };

  const [state, dispatch] = useReducer(appReducer, initialState);

  // Persist prefs
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.prefs));
    } catch {}
  }, [state.prefs]);

  // Apply theme class
  useEffect(() => {
    const root = document.documentElement;
    if (state.prefs.theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
  }, [state.prefs.theme]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === '/') {
        e.preventDefault();
        dispatch({ type: 'OPEN_SEARCH' });
      }
      if (e.key === 'Escape') {
        dispatch({ type: 'CLOSE_SEARCH' });
        dispatch({ type: 'CLOSE_DRAWER' });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const isSaved = useCallback((id: string) => state.prefs.savedEventIds.includes(id), [state.prefs.savedEventIds]);
  const isReminded = useCallback((id: string) => state.prefs.remindedEventIds.includes(id), [state.prefs.remindedEventIds]);
  const isFavoriteSport = useCallback((sport: Sport) => state.prefs.favoriteSports.includes(sport), [state.prefs.favoriteSports]);

  return (
    <AppContext.Provider value={{ state, dispatch, isSaved, isReminded, isFavoriteSport }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function usePrefs() {
  return useApp().state.prefs;
}

export function useFilters() {
  const { state, dispatch } = useApp();
  const setFilter = useCallback((f: Partial<FilterState>) => dispatch({ type: 'SET_FILTER', payload: f }), [dispatch]);
  const resetFilters = useCallback(() => dispatch({ type: 'RESET_FILTERS' }), [dispatch]);
  return { filters: state.filters, setFilter, resetFilters };
}
