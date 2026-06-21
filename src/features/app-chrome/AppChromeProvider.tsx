import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react';

export type ViewerChromeStateKind = 'loading' | 'ready' | 'failed';

export interface ViewerChromeState {
  visible: boolean;
  mapLabel: string;
  status: string;
  state: ViewerChromeStateKind;
  onChooseAnother?: () => void;
}

interface AppChromeContextValue {
  debugPanelsVisible: boolean;
  setDebugPanelsVisible: (visible: boolean) => void;
  viewerChrome: ViewerChromeState;
  setViewerChrome: (state: ViewerChromeState) => void;
  resetViewerChrome: () => void;
}

const emptyViewerChrome: ViewerChromeState = {
  visible: false,
  mapLabel: '',
  status: '',
  state: 'loading'
};

const AppChromeContext = createContext<AppChromeContextValue | null>(null);

export function AppChromeProvider({ children }: { children: ReactNode }) {
  const [debugPanelsVisible, setDebugPanelsVisible] = useState(false);
  const [viewerChrome, setViewerChromeState] = useState<ViewerChromeState>(emptyViewerChrome);

  const setViewerChrome = useCallback((state: ViewerChromeState) => {
    setViewerChromeState(state);
  }, []);

  const resetViewerChrome = useCallback(() => {
    setViewerChromeState(emptyViewerChrome);
  }, []);

  const value = useMemo<AppChromeContextValue>(() => ({
    debugPanelsVisible,
    setDebugPanelsVisible,
    viewerChrome,
    setViewerChrome,
    resetViewerChrome
  }), [debugPanelsVisible, resetViewerChrome, setViewerChrome, viewerChrome]);

  return (
    <AppChromeContext.Provider value={value}>
      {children}
    </AppChromeContext.Provider>
  );
}

export function useAppChrome() {
  const context = useContext(AppChromeContext);
  if (!context) {
    throw new Error('useAppChrome must be used inside AppChromeProvider.');
  }

  return context;
}
