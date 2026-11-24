import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

/**
 * Reactive native connectivity hook backed by NetInfo.
 * Defaults to `true` on initial mount until the native probe reports offline.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let mounted = true;

    NetInfo.fetch().then((state) => {
      if (!mounted) return;
      const connected =
        state.isConnected !== false && state.isInternetReachable !== false;
      setIsOnline(connected);
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected =
        state.isConnected !== false && state.isInternetReachable !== false;
      setIsOnline(connected);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return isOnline;
}
