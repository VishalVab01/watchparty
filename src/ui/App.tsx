import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Clapperboard, Copy, Crown, Link2, LoaderCircle, LockKeyhole, LogOut, Menu, MessageCircle, Music2, Pause, Play, Plus, Send, Shield, Sparkles, Users, X } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { gsap } from 'gsap';

type Role = 'host' | 'moderator' | 'participant';
type Action = 'play' | 'pause' | 'seek' | 'change_video';
type Member = { id: string; name: string; role: Role };
type Session = { roomId: string; code: string; userId: string; username: string; role: Role; token: string };
type Snapshot = { code: string; videoId: string | null; currentTime: number; isPlaying: boolean; updatedAt: number; participants: Member[] };
type Request = { id: string; userId: string; username: string; action: Action; payload?: { time?: number; videoId?: string }; createdAt: number };

declare global { interface Window { YT?: YTApi; onYouTubeIframeAPIReady?: () => void } }
type YTApi = { Player: new (id: string, options: Record<string, unknown>) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number } };
type YTPlayer = { playVideo(): void; pauseVideo(): void; unMute(): void; seekTo(time: number, allowSeekAhead: boolean): void; loadVideoById(id: string): void; cueVideoById(id: string): void; getCurrentTime(): number; getDuration(): number; getPlayerState(): number; destroy(): void };

const defaultVideo = 'jfKfPfyJRdk';
const apiUrl = import.meta.env.VITE_API_URL || '';
const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;
const avatarTones = ['avatar-mint', 'avatar-peach', 'avatar-blue', 'avatar-lilac', 'avatar-sun'];
const persistKey = 'watchparty-sessions';
const emoji = ['✳', '✴', '✿', '✷', '✦'];

function storeSession(session: Session) {
  const sessions = JSON.parse(sessionStorage.getItem(persistKey) || '{}') as Record<string, Session>;
  sessions[session.code] = session;
  sessionStorage.setItem(persistKey, JSON.stringify(sessions));
}
function getSession(code: string): Session | null {
  const sessions = JSON.parse(sessionStorage.getItem(persistKey) || '{}') as Record<string, Session>;
  return sessions[code.toUpperCase()] || null;
}
function videoIdFromUrl(value: string) {
  try {
    const url = new URL(value);
    const id = url.hostname.includes('youtu.be') ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop();
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch { return /^[a-zA-Z0-9_-]{11}$/.test(value.trim()) ? value.trim() : null; }
}
function formatTime(total: number) {
  if (!Number.isFinite(total)) return '0:00';
  const seconds = Math.max(0, Math.floor(total));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function initials(name: string) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [enteredSession, setEnteredSession] = useState<Session | null>(null);
  const [modal, setModal] = useState<'create' | 'join' | null>(null);
  const [toast, setToast] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (!root.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      gsap.fromTo('.reveal', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.09, ease: 'power3.out', clearProps: 'all' });
      gsap.fromTo('.orbit', { rotate: -20, scale: 0.88 }, { rotate: 0, scale: 1, duration: 1.2, ease: 'elastic.out(1, 0.6)', delay: 0.15 });
    }, root);
    return () => ctx.revert();
  }, [path]);
  const showToast = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800); }, []);
  const navigateRoom = useCallback((code: string) => { window.history.pushState({}, '', `/room/${code}`); setPath(`/room/${code}`); setModal(null); }, []);
  const leaveRoom = useCallback(() => { window.history.pushState({}, '', '/'); setPath('/'); }, []);
  const roomCode = path.match(/^\/room\/([a-zA-Z0-9]+)/)?.[1]?.toUpperCase();
  const session = useMemo(() => roomCode ? (enteredSession?.code === roomCode ? enteredSession : getSession(roomCode)) : null, [roomCode, enteredSession]);

  useEffect(() => {
    if (roomCode && !session) setModal('join');
  }, [roomCode, session]);

  return <div ref={root} className="app-shell min-h-screen bg-paper font-sans antialiased">
    {roomCode && session ? <Room session={session} onLeave={leaveRoom} showToast={showToast} /> : <>
      <div className="folio-page">
        <header className="folio-nav">
          <a className="folio-logo" href="/" aria-label="Watchparty home" onClick={(e) => { e.preventDefault(); leaveRoom(); }}><span>◒</span></a>
          <nav className={`folio-links ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
            <a className="active" href="#top"><span>⌂</span> HOME</a><a href="#how-it-works" onClick={() => setMenuOpen(false)}><span>✿</span> ABOUT</a><a href="#the-good-stuff" onClick={() => setMenuOpen(false)}><span>▣</span> THE GOOD STUFF</a><a href="#how-it-works" onClick={() => setMenuOpen(false)}><span>✣</span> HOW IT WORKS</a>
          </nav>
          <div className="folio-nav-actions"><span className="nav-chip">SYNC</span><span className="nav-chip">SOCIAL</span><span className="folio-avatar"><img src="https://framerusercontent.com/images/DxEColy2Zkko0WyVGe1jwbs7BpI.png?height=354&width=278" alt="Watchparty host" /></span><button onClick={() => setModal('create')}>♥ &nbsp; START A PARTY</button></div>
          <button className="mobile-menu folio-menu" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        </header>
        <div className="folio-ruler" aria-hidden="true"><span>100</span><span>200</span><span>300</span><span>400</span><span>500</span><span>600</span><span>700</span><span>800</span><span>900</span><span>1000</span><span>1100</span><span>1200</span><span>1300</span><span>1400</span><span>1500</span></div>
        <main id="top" className="folio-main">
          <section className="folio-hero" aria-label="Watchparty home">
            <div className="folio-clock">{new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date())}</div>
            <span className="folio-you"><i /> YOU</span>
            <span className="folio-photo photo-left"><img src="https://framerusercontent.com/images/DxEColy2Zkko0WyVGe1jwbs7BpI.png?height=354&width=278" alt="A member of the Watchparty crew" /></span>
            <span className="folio-photo photo-right"><img src="https://framerusercontent.com/images/jaipCY5FvgftEDz3qtilGNnLVk.png?height=1024&width=683" alt="A member of the Watchparty crew" /></span>
            <div className="folio-name-wrap reveal"><div className="folio-hand">your place for</div><span className="folio-note note-mint">Currently syncing everyone</span><span className="folio-note note-yellow">Previously watching alone</span><h1 className="folio-name">WATCHPARTY</h1><span className="folio-handle handle-a"/><span className="folio-handle handle-b"/><span className="folio-handle handle-c"/><span className="folio-handle handle-d"/></div>
            <p className="folio-status"><i /> AVAILABLE FOR YOUR NEXT MOVIE NIGHT</p>
            <div className="folio-lower reveal"><span className="folio-sticker sticker-left">HOST PICKS<br />THE VIDEO</span><span className="folio-sticker sticker-right">SAME TIME<br />EVERYWHERE</span><h2>Watch together <b>◎</b><br />from anywhere <em>✳</em></h2><button className="folio-cta" onClick={() => setModal('create')}><span>▶</span> START A PARTY</button><button className="folio-join" onClick={() => setModal('join')}>I HAVE A ROOM CODE <ArrowRight size={14} /></button></div>
          </section>
          <section className="folio-about" id="how-it-works"><div><span>01 / THE IDEA</span><h2>Same video.<br /><i>Same moment.</i></h2></div><p>Send a link, gather your favorite people, and let Watchparty keep everyone on the same second. No account needed. Just press play together.</p></section>
          <section className="folio-features" id="the-good-stuff"><Feature number="01" icon={<Music2 size={21} />} title="Right on time" text="Play, pause, or skip. Everyone lands on the same second." /><Feature number="02" icon={<Users size={21} />} title="Your people" text="Bring the group chat to one little room of its own." /><Feature number="03" icon={<Shield size={21} />} title="Good hosts" text="Pick the people who can take the wheel. Everyone else just enjoys." /></section>
        </main>
        <footer className="folio-footer"><span>WATCHPARTY © 2025</span><span>MADE FOR CLOSER, NOT LOUDER ♥</span><button onClick={() => setModal('join')}>JOIN A PARTY ↗</button></footer>
      </div>
      {modal && <EntryModal mode={modal} onClose={() => setModal(null)} onComplete={(s) => { storeSession(s); setEnteredSession(s); navigateRoom(s.code); }} />}
      {toast && <Toast text={toast} />}
    </>}
  </div>;
}

function Feature({ number, icon, title, text }: { number: string; icon: React.ReactNode; title: string; text: string }) {
  return <article className="feature-card"><div className="feature-top"><span>{number}</span><span className="feature-icon">{icon}</span></div><h3>{title}</h3><p>{text}</p></article>;
}

function EntryModal({ mode, onClose, onComplete }: { mode: 'create' | 'join'; onClose: () => void; onComplete: (s: Session) => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(new URLSearchParams(window.location.search).get('code') || window.location.pathname.match(/^\/room\/([A-Z0-9]+)/i)?.[1] || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/api/rooms${mode === 'create' ? '' : '/join'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'create' ? { username: name } : { username: name, code }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Something went wrong. Try again.');
      onComplete(data as Session);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect. Try again in a moment.'); }
    finally { setLoading(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="entry-modal w-full max-w-[426px]" role="dialog" aria-modal="true" aria-labelledby="entry-title">
      <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
      <div className="modal-stamp"><Clapperboard size={18} /></div><span className="micro-label">{mode === 'create' ? 'THE REMOTE IS YOURS' : 'COME ON IN'}</span>
      <h2 id="entry-title">{mode === 'create' ? <>Make a little<br /><em>movie night.</em></> : <>There's room<br /><em>for one more.</em></>}</h2>
      <form onSubmit={submit}>
        <label htmlFor="username">Your name</label><input ref={input} id="username" value={name} onChange={(e) => setName(e.target.value)} placeholder="What should we call you?" maxLength={32} required autoComplete="nickname" />
        {mode === 'join' && <><label htmlFor="room-code">Room code</label><input id="room-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="E.g. SUNSET" maxLength={8} required className="code-input" /></>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-dark modal-submit" type="submit" disabled={loading}>{loading ? <><LoaderCircle size={16} className="spin" /> One sec...</> : mode === 'create' ? <>Let's get this going <ArrowRight size={16} /></> : <>Join the party <ArrowRight size={16} /></>}</button>
      </form>
      <p className="modal-foot">NO ACCOUNTS. NO FUSS. JUST GOOD COMPANY.</p>
    </section>
  </div>;
}

function Room({ session, onLeave, showToast }: { session: Session; onLeave: () => void; showToast: (m: string) => void }) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState<Request[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<{ name: string; text: string; at: string }[]>([]);
  const [chatText, setChatText] = useState('');
  const [copied, setCopied] = useState(false);
  const [roleMenu, setRoleMenu] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const socket = useRef<Socket | null>(null);
  const player = useRef<YTPlayer | null>(null);
  const videoHost = useRef<HTMLDivElement>(null);
  const lastVideo = useRef<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const canControl = session.role === 'host' || session.role === 'moderator';

  useEffect(() => {
    const client = io(socketUrl, { auth: { code: session.code, token: session.token }, reconnectionAttempts: 8, reconnectionDelayMax: 4000 });
    socket.current = client;
    client.on('connect', () => { setConnected(true); setError(''); });
    client.on('disconnect', () => setConnected(false));
    client.on('connect_error', (err) => setError(err.message));
    client.on('room_state', (next: Snapshot) => setState(next));
    client.on('sync_state', (next: Snapshot) => setState(next));
    client.on('user_joined', (event: { participants: Member[] }) => setState((old) => old ? { ...old, participants: event.participants } : old));
    client.on('user_left', (event: { participants: Member[] }) => setState((old) => old ? { ...old, participants: event.participants } : old));
    client.on('role_assigned', (event: { userId: string; role: Role; participants: Member[] }) => {
      setState((old) => old ? { ...old, participants: event.participants } : old);
      if (event.userId === session.userId) {
        session.role = event.role;
        storeSession(session);
        showToast(event.role === 'moderator' ? 'You’re a moderator now. You’ve got the wheel.' : 'Your moderator role has changed.');
      }
    });
    client.on('room_request_created', (request: Request) => setRequests((old) => old.some((r) => r.id === request.id) ? old : [request, ...old]));
    client.on('pending_requests', (pending: Request[]) => setRequests(pending));
    client.on('request_resolved', ({ requestId, approved }: { requestId: string; approved: boolean }) => {
      setRequests((old) => old.filter((r) => r.id !== requestId));
      showToast(approved ? 'Request approved. Press play with the gang.' : 'Request passed.');
    });
    client.on('action_error', ({ message }: { message: string }) => showToast(message));
    client.on('participant_removed', ({ userId }: { userId: string }) => setState((old) => old ? { ...old, participants: old.participants.filter((p) => p.id !== userId) } : old));
    client.on('removed_from_room', () => { sessionStorage.removeItem(persistKey); showToast('You’ve been removed from this party.'); window.setTimeout(onLeave, 400); });
    client.on('chat_message', (message: { name: string; text: string; at: string }) => setChat((old) => [...old.slice(-79), message]));
    return () => { client.disconnect(); player.current?.destroy(); player.current = null; setPlayerReady(false); };
  }, [session, onLeave, showToast]);

  useEffect(() => {
    if (!state) return;
    setCurrentTime(state.currentTime + (state.isPlaying ? Math.max(0, (Date.now() - state.updatedAt) / 1000) : 0));
    if (!window.YT) {
      const existing = document.querySelector<HTMLScriptElement>('script[data-youtube-api]');
      if (!existing) {
        const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.dataset.youtubeApi = 'true'; document.head.appendChild(script);
      }
      window.onYouTubeIframeAPIReady = () => initializePlayer(state);
    } else initializePlayer(state);
    function initializePlayer(snapshot: Snapshot) {
      if (!window.YT || !videoHost.current) return;
      if (!player.current) {
        const iframe = document.createElement('div'); iframe.id = 'watchparty-player'; videoHost.current.replaceChildren(iframe);
        player.current = new window.YT.Player('watchparty-player', {
          width: '100%', height: '100%', videoId: snapshot.videoId || defaultVideo,
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, origin: window.location.origin },
          events: { onReady: (event: { target: YTPlayer }) => {
            setPlayerReady(true);
            const startTime = snapshot.currentTime + (snapshot.isPlaying ? Math.max(0, (Date.now() - snapshot.updatedAt) / 1000) : 0);
            lastVideo.current = snapshot.videoId;
            if (snapshot.videoId) {
              if (snapshot.isPlaying) event.target.loadVideoById(snapshot.videoId);
              else event.target.cueVideoById(snapshot.videoId);
            }
            if (startTime > 0) event.target.seekTo(startTime, true);
            if (snapshot.isPlaying) event.target.playVideo();
          }, onStateChange: (event: { data: number }) => setPlayerPlaying(event.data === window.YT?.PlayerState.PLAYING), onError: () => showToast('YouTube could not load that video. Try another link.') },
        });
      }
    }
  }, [state?.videoId]);

  useEffect(() => {
    if (!state || !playerReady || !player.current) return;
    const active = state.isPlaying ? state.currentTime + Math.max(0, (Date.now() - state.updatedAt) / 1000) : state.currentTime;
    if (state.videoId && lastVideo.current !== state.videoId) {
      lastVideo.current = state.videoId;
      if (state.isPlaying) player.current.loadVideoById(state.videoId); else player.current.cueVideoById(state.videoId);
      return;
    }
    const actual = player.current.getCurrentTime?.() || 0;
    if (Math.abs(actual - active) > 3 && state.videoId) player.current.seekTo(active, true);
    if (state.isPlaying) player.current.playVideo(); else player.current.pauseVideo();
  }, [state, playerReady]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (playerReady && player.current) {
        const videoDuration = player.current.getDuration?.() || 0;
        if (videoDuration) setDuration(videoDuration);
      }
      if (state?.isPlaying && canControl && playerReady && player.current) {
        const time = player.current.getCurrentTime();
        if (Number.isFinite(time) && Math.floor(time) % 5 === 0) socket.current?.emit('sync_time', { time });
      }
      if (state?.isPlaying) setCurrentTime((time) => time + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [state?.isPlaying, canControl, playerReady]);

  const handleAction = (action: Action, payload?: Request['payload']) => {
    if (!socket.current) return;
    if (!canControl) { socket.current.emit('request_change', { action, payload }); showToast('Your request is with the host.'); return; }
    if (action === 'play') player.current?.playVideo();
    if (action === 'pause') player.current?.pauseVideo();
    socket.current.emit(action, payload || {});
  };
  const updateVideo = () => {
    const videoId = videoIdFromUrl(videoUrl);
    if (!videoId) return showToast('Paste a YouTube link or its 11-character video code.');
    handleAction('change_video', { videoId }); setVideoUrl('');
  };
  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/room/${session.code}`);
      setCopied(true); window.setTimeout(() => setCopied(false), 1800);
    } catch { showToast(`Share this room code: ${session.code}`); }
  };
  const resolve = (request: Request, approved: boolean) => socket.current?.emit('resolve_request', { requestId: request.id, approved });
  const showChat = (text: string) => {
    const line = text.trim().slice(0, 500); if (!line) return;
    socket.current?.emit('chat_message', { text: line }); setChatText('');
  };
  const currentMember = state?.participants.find((p) => p.id === session.userId);
  const myRole = currentMember?.role || session.role;
  const controlsAllowed = myRole !== 'participant';

  return <main className="room-shell min-h-screen">
    <header className="room-nav"><a href="/" className="wordmark"><span className="wordmark-mark"><Clapperboard size={14} /></span> watchparty<span className="wordmark-period">.</span></a><div className="room-live-pill"><span className={`live-dot ${connected ? '' : 'offline'}`} />{connected ? 'PARTY IS LIVE' : 'RECONNECTING'}</div><button className="room-leave" onClick={onLeave}><LogOut size={15} /> Leave room</button></header>
    <div className="room-body page-width">
      <div className="room-topline"><div><div className="micro-label">THE LIVING ROOM <span className="coral-period">✳</span></div><h1 className="room-title">Movie night <em>is on.</em></h1></div><div className="room-invite"><div className="invite-code-label">ROOM CODE</div><strong>{session.code}</strong><button onClick={copyInvite}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy invite'}</button></div></div>
      {error && <div className="connection-note"><span className="live-dot offline" /> {error} <button onClick={() => socket.current?.connect()}>Try again</button></div>}
      <div className="room-grid">
        <section className="player-column">
          <div className="player-shell"><div className="player-topbar"><div className="topbar-now"><span className="live-dot" /> NOW SHOWING <span className="player-video-label">{state?.videoId ? 'YOUR PICK' : 'A LITTLE LOFI WHILE YOU DECIDE'}</span></div><button className="player-more" onClick={() => void copyInvite()}><Link2 size={15} /> Invite someone</button></div><div className="player-frame"><div ref={videoHost} className="youtube-stage"/><div className={`player-cover ${state?.isPlaying ? 'playing' : ''}`} aria-hidden="true"><div className="cover-stars">✦ &nbsp; ✳ &nbsp; ✦</div><div className="cover-center"><span>THE INTERNET'S</span><b>COZIEST<br />CINEMA</b><i>admit one, wherever you are</i></div><div className="cover-bottom"><span>WITH YOUR PEOPLE</span><span>WP — {session.code}</span></div></div><div className="player-overlay-controls"><button className="big-play" aria-label={state?.isPlaying ? 'Pause video' : 'Play video'} onClick={() => handleAction(state?.isPlaying ? 'pause' : 'play')}><span>{state?.isPlaying ? <Pause fill="currentColor" size={24} /> : <Play fill="currentColor" size={24} />}</span></button></div>{state?.isPlaying && !playerPlaying && <button className="sync-nudge" onClick={() => { player.current?.unMute(); player.current?.playVideo(); }}><Play size={12} fill="currentColor" /> Tap to start your video</button>}</div>
            <div className="player-controls"><button className="control-play" onClick={() => handleAction(state?.isPlaying ? 'pause' : 'play')}>{state?.isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}{state?.isPlaying ? 'Pause for everyone' : 'Play for everyone'}</button><span className="time-readout">{formatTime(currentTime)} <span>/</span> {formatTime(duration)}</span><input className="timeline" type="range" min="0" max={duration || 1} step="0.25" value={Math.min(currentTime, duration || 1)} aria-label="Seek video for everyone" disabled={!duration} onChange={(e) => setCurrentTime(Number(e.target.value))} onMouseUp={(e) => handleAction('seek', { time: Number(e.currentTarget.value) })} onTouchEnd={(e) => handleAction('seek', { time: Number(e.currentTarget.value) })} onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) handleAction('seek', { time: Number(e.currentTarget.value) }); }} /><button className="chat-toggle" onClick={() => setChatOpen(!chatOpen)}><MessageCircle size={16} /> Chat <span className="chat-count">{chat.length}</span></button></div>
            <div className="video-form"><div className="form-scribble">{emoji[2]}</div><div className="video-form-copy"><b>Got something in mind?</b><span>{controlsAllowed ? 'Paste a YouTube link and switch it up.' : 'Suggest a video for the host to pop on.'}</span></div><div className="video-input"><input aria-label="YouTube URL" placeholder="Paste a YouTube link..." value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') updateVideo(); }} /><button onClick={updateVideo} aria-label="Submit video"><ArrowUpRight size={16} /></button></div></div>
          </div>
          <div className="room-bottom-grid"><div className="room-note"><span className="micro-label">A NOTE FROM THE ROOM</span><p>“The best part of being together is forgetting how far apart you are.”</p><span className="note-byline">— SOMEONE VERY WISE <span className="coral-period">♥</span></span></div><div className="room-vibe"><span className="micro-label">THE VIBE CHECK</span><div className="vibe-icons"><span>🍿</span><span>🧦</span><span>🛋️</span></div><p>Comfy, we hope.</p></div></div>
        </section>
        <aside className="sidebar-column">
          <section className="people-card"><div className="side-card-heading"><div><span className="micro-label">IN THE ROOM</span><h2>Your people <span>{state?.participants.length || 0}</span></h2></div><Users size={19} /></div><div className="people-list">{state?.participants.map((participant, index) => <div className="person-row" key={participant.id}><div className={`avatar ${avatarTones[index % avatarTones.length]}`}>{initials(participant.name)}{participant.role === 'host' && <span className="host-star"><Crown size={10} fill="currentColor" /></span>}</div><div className="person-info"><b>{participant.name}{participant.id === session.userId ? ' (you)' : ''}</b><span>{participant.role === 'host' ? 'Host' : participant.role === 'moderator' ? 'Moderator' : 'Just vibing'}</span></div>{participant.id === session.userId ? <span className="you-pill">YOU</span> : <span className="online-mark" />}{myRole === 'host' && participant.id !== session.userId && <div className="person-menu-wrap"><button className="person-menu" aria-label={`Manage ${participant.name}`} onClick={() => setRoleMenu(roleMenu === participant.id ? null : participant.id)}><ChevronDown size={14} /></button>{roleMenu === participant.id && <div className="person-menu-pop"><button onClick={() => { socket.current?.emit('assign_role', { userId: participant.id, role: participant.role === 'moderator' ? 'participant' : 'moderator' }); setRoleMenu(null); }}>{participant.role === 'moderator' ? 'Make participant' : 'Make moderator'}</button><button className="danger-action" onClick={() => { socket.current?.emit('remove_participant', { userId: participant.id }); setRoleMenu(null); }}>Remove from room</button></div>}</div>}</div>)}</div><button className="invite-people" onClick={() => void copyInvite()}><Plus size={15} /> Invite more people</button></section>
          <section className="requests-card"><div className="side-card-heading"><div><span className="micro-label">A LITTLE DEMOCRACY</span><h2>Requests <span className="request-count">{requests.length}</span></h2></div><Sparkles size={19} /></div>{requests.length === 0 ? <div className="empty-requests"><span className="empty-star">✳</span><p>{controlsAllowed ? 'All caught up.' : 'Want to change it up? Ask the host.'}</p><span>Requests from the room show up here.</span></div> : <div className="request-list">{requests.map((request) => <div className="request-row" key={request.id}><div className="request-copy"><b>{request.username}</b><span>{describeAction(request)}</span></div>{controlsAllowed ? <div className="request-actions"><button aria-label="Approve request" onClick={() => resolve(request, true)}><Check size={15} /></button><button aria-label="Decline request" onClick={() => resolve(request, false)}><X size={15} /></button></div> : <span className="pending-pill">PENDING</span>}</div>)}</div>}</section>
          <div className="roles-note"><LockKeyhole size={14} /><span>{controlsAllowed ? myRole === 'host' ? 'You’re the host. It’s your living room.' : 'You’re a moderator. Keep the good times rolling.' : 'Playback changes go through the host. Request away!'}</span></div>
        </aside>
      </div>
    </div>
    {chatOpen && <div className="chat-panel"><div className="chat-header"><div><span className="micro-label">THE GROUP CHAT</span><strong>Say a little something</strong></div><button onClick={() => setChatOpen(false)}><X size={17} /></button></div><div className="chat-messages">{chat.length ? chat.map((message, i) => <div key={`${i}-${message.at}`} className="chat-message"><b>{message.name}</b><p>{message.text}</p><time>{message.at}</time></div>) : <div className="chat-empty"><MessageCircle size={20} /><p>Quiet room. Be the first to say something.</p></div>}</div><form className="chat-form" onSubmit={(e) => { e.preventDefault(); showChat(chatText); }}><input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Type a message..." maxLength={500} /><button aria-label="Send message"><Send size={16} /></button></form></div>}
  </main>;
}

function describeAction(request: Request) {
  if (request.action === 'play') return 'wants to press play';
  if (request.action === 'pause') return 'wants to pause for a sec';
  if (request.action === 'seek') return `wants to skip to ${formatTime(request.payload?.time || 0)}`;
  return 'wants to change the video';
}
function Toast({ text }: { text: string }) { return <div className="toast-message" role="status"><span>✳</span>{text}</div>; }
