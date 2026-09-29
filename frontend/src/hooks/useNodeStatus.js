import { useEffect, useState } from 'react';
import { api } from '../api';

export function useNodeStatus() {
  const [health, setHealth] = useState(null);
  const [sync, setSync] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [nextHealth, nextSync] = await Promise.all([api('/health'), api('/api/sync/status')]);
        if (active) {
          setHealth(nextHealth);
          setSync(nextSync);
          setError('');
        }
      } catch (err) {
        if (active) {
          setHealth(null);
          setError(err.message);
        }
      }
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return { health, sync, error };
}
