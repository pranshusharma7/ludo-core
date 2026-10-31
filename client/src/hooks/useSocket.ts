import { useEffect, useState, useRef, useCallback } from 'react';
import {
  GameState,
  PlayerColor,
  MoveResult,
  EmojiReaction
} from '@royal-ludo/shared';

// The frontend calls /.netlify/functions/game directly as specified
const NETLIFY_ENDPOINT = '/.netlify/functions/game';

export const useSocket = () => {
  const [isConnected, setIsConnected] = useState<boolean>(true);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [latency, setLatency] = useState<number>(24);

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [myPlayerId] = useState<string>(() => {
    let id = localStorage.getItem('ludo_player_id');
    if (!id) {
      id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      localStorage.setItem('ludo_player_id', id);
    }
    return id;
  });

  const [myColor, setMyColor] = useState<PlayerColor | null>(null);
  const [reactions, setReactions] = useState<EmojiReaction[]>([]);
  const [lastDiceEvent, setLastDiceEvent] = useState<{ playerColor: PlayerColor; roll: number; timestamp?: number } | null>(null);

  const prevRollRef = useRef<number | null>(null);
  const prevVersionRef = useRef<number>(0);
  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameStateRef = useRef<GameState | null>(null);
  gameStateRef.current = gameState;

  // Generic POST caller to /.netlify/functions/game
  const callApi = useCallback(async (body: any) => {
    const t0 = performance.now();
    try {
      const res = await fetch(NETLIFY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(body)
      });
      const t1 = performance.now();
      setLatency(Math.max(5, Math.round(t1 - t0)));
      setIsConnected(true);
      setIsReconnecting(false);

      const json = await res.json();
      return json;
    } catch (err: any) {
      setIsConnected(false);
      setIsReconnecting(true);
      return { success: false, error: err.message || 'Network request failed' };
    }
  }, []);

  // Update local state when fresh GameState arrives
  const updateStateFromApi = useCallback((freshState: GameState) => {
    if (!freshState) return;

    // Detect new roll event to animate 3D dice
    if (
      freshState.turnState.roll !== null &&
      (freshState.turnState.roll !== prevRollRef.current ||
        (freshState.version || 0) > prevVersionRef.current)
    ) {
      setLastDiceEvent({
        playerColor: freshState.turnState.activeColor,
        roll: freshState.turnState.roll,
        timestamp: Date.now()
      });
    }

    prevRollRef.current = freshState.turnState.roll;
    prevVersionRef.current = freshState.version || 0;

    // Detect new reactions
    if (freshState.reactions && freshState.reactions.length > 0) {
      setReactions(freshState.reactions);
    }

    // Determine my player color
    const me = freshState.players?.find(p => p.id === myPlayerId);
    if (me) {
      setMyColor(me.color);
    }

    setGameState(freshState);
  }, [myPlayerId]);

  // Polling loop when player is in an active room
  useEffect(() => {
    const currentCode = gameState?.roomCode;
    if (!currentCode) return;

    let isSubscribed = true;

    const poll = async () => {
      if (!isSubscribed) return;
      try {
        const res = await fetch(`${NETLIFY_ENDPOINT}?action=get_state&roomCode=${currentCode}&_t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.gameState && isSubscribed) {
            updateStateFromApi(data.gameState);
          }
        }
      } catch {
        // silent retry on next interval
      }

      if (isSubscribed) {
        pollingTimerRef.current = setTimeout(poll, 850);
      }
    };

    pollingTimerRef.current = setTimeout(poll, 850);

    return () => {
      isSubscribed = false;
      if (pollingTimerRef.current) clearTimeout(pollingTimerRef.current);
    };
  }, [gameState?.roomCode, updateStateFromApi]);

  const joinRoom = useCallback(
    async (roomCode: string | undefined, playerName: string, avatar: string, playerCount = 4, preferredColor: PlayerColor = 'blue') => {
      const res = await callApi({
        action: 'join_room',
        roomCode,
        playerName,
        avatar,
        playerCount,
        playerId: myPlayerId,
        preferredColor
      });

      if (res.success && res.gameState) {
        updateStateFromApi(res.gameState);
      }
      return res;
    },
    [callApi, myPlayerId, updateStateFromApi]
  );

  const playVsComputer = useCallback(
    async (playerName: string, avatar: string, playerCount = 4, preferredColor: PlayerColor = 'blue') => {
      const joinRes = await callApi({
        action: 'join_room',
        playerName,
        avatar,
        playerCount,
        playerId: myPlayerId,
        preferredColor
      });

      if (joinRes.success && joinRes.gameState && joinRes.roomCode) {
        updateStateFromApi(joinRes.gameState);
        const startRes = await callApi({
          action: 'start_game',
          roomCode: joinRes.roomCode,
          playerId: myPlayerId
        });
        if (startRes.success && startRes.gameState) {
          updateStateFromApi(startRes.gameState);
        }
        return startRes;
      }
      return joinRes;
    },
    [callApi, myPlayerId, updateStateFromApi]
  );

  const quickMatch = useCallback(
    async (playerName: string, avatar: string, playerCount = 4) => {
      const res = await callApi({
        action: 'quick_match',
        playerName,
        avatar,
        playerCount,
        playerId: myPlayerId
      });

      if (res.success && res.gameState) {
        updateStateFromApi(res.gameState);
      }
      return res;
    },
    [callApi, myPlayerId, updateStateFromApi]
  );

  const startGame = useCallback(async () => {
    const roomCode = gameStateRef.current?.roomCode;
    if (!roomCode) return { success: false, error: 'No room' };
    const res = await callApi({
      action: 'start_game',
      roomCode,
      playerId: myPlayerId
    });
    if (res.success && res.gameState) {
      updateStateFromApi(res.gameState);
    }
    return res;
  }, [callApi, myPlayerId, updateStateFromApi]);

  const rollDice = useCallback(async () => {
    const roomCode = gameStateRef.current?.roomCode;
    if (!roomCode) return { success: false, error: 'No room' };
    const res = await callApi({
      action: 'roll_dice',
      roomCode,
      playerId: myPlayerId
    });
    if (res.success && res.gameState) {
      updateStateFromApi(res.gameState);
    }
    return res;
  }, [callApi, myPlayerId, updateStateFromApi]);

  const moveToken = useCallback(
    async (tokenIndex: number) => {
      const roomCode = gameStateRef.current?.roomCode;
      if (!roomCode) return { success: false, error: 'No room' };
      const res = await callApi({
        action: 'move_token',
        roomCode,
        playerId: myPlayerId,
        tokenIndex
      });
      if (res.success && res.gameState) {
        updateStateFromApi(res.gameState);
      }
      return res;
    },
    [callApi, myPlayerId, updateStateFromApi]
  );

  const sendReaction = useCallback(
    async (emoji: string) => {
      const roomCode = gameStateRef.current?.roomCode;
      if (!roomCode) return;
      await callApi({
        action: 'reaction',
        roomCode,
        playerId: myPlayerId,
        emoji
      });
    },
    [callApi, myPlayerId]
  );

  const requestRematch = useCallback(async () => {
    const roomCode = gameStateRef.current?.roomCode;
    if (!roomCode) return;
    const res = await callApi({
      action: 'rematch',
      roomCode,
      playerId: myPlayerId
    });
    if (res.success && res.gameState) {
      updateStateFromApi(res.gameState);
    }
  }, [callApi, myPlayerId, updateStateFromApi]);

  return {
    isConnected,
    isReconnecting,
    latency,
    myPlayerId,
    myColor,
    gameState,
    setGameState,
    reactions,
    lastDiceEvent,
    joinRoom,
    playVsComputer,
    quickMatch,
    startGame,
    rollDice,
    moveToken,
    sendReaction,
    requestRematch
  };
};

export const useGame = useSocket;
