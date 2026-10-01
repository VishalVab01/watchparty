import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Copy, Crown, Link2, LoaderCircle, LockKeyhole, LogOut, Menu, MessageCircle, Pause, Play, Plus, Send, Sparkles, Users, X } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

gsap.registerPlugin(ScrollTrigger);

type Role = 'host' | 'moderator' | 'participant';
type Action = 'play' | 'pause' | 'seek' | 'change_video';
type Member = { id: string; name: string; role: Role };
type Session = { roomId: string; code: string; userId: string; username: string; role: Role; token: string; accountToken: string };
type Snapshot = { code: string; videoId: string | null; currentTime: number; isPlaying: boolean; updatedAt: number; participants: Member[] };
type Request = { id: string; userId: string; username: string; action: Action; payload?: { time?: number; videoId?: string }; createdAt: number };

declare global { interface Window { YT?: YTApi; onYouTubeIframeAPIReady?: () => void } }
type YTApi = { Player: new (id: string, options: Record<string, unknown>) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number } };
type YTPlayer = { playVideo(): void; pauseVideo(): void; unMute(): void; seekTo(time: number, allowSeekAhead: boolean): void; loadVideoById(id: string): void; cueVideoById(id: string): void; getCurrentTime(): number; getDuration(): number; getPlayerState(): number; destroy(): void };

const apiUrl = import.meta.env.VITE_API_URL || '';
const socketUrl = import.meta.env.VITE_SOCKET_URL || undefined;
const avatarTones = ['avatar-mint', 'avatar-peach', 'avatar-blue', 'avatar-lilac', 'avatar-sun'];
const persistKey = 'watchparty-sessions';
const accountTokenKey = 'watchparty-account-token';
const accountNameKey = 'watchparty-account-name';
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
  const [featuredVideoId, setFeaturedVideoId] = useState<string | null>(null);
  const [modal, setModal] = useState<'create' | 'join' | null>(null);
  const [toast, setToast] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({ autoRaf: false, anchors: true });
    lenisRef.current = lenis;
    const updateScrollTrigger = () => ScrollTrigger.update();
    const tick = (time: number) => lenis.raf(time * 1000);
    lenis.on('scroll', updateScrollTrigger);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);
    return () => {
      lenis.off('scroll', updateScrollTrigger);
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    const appRoot = root.current;
    if (!appRoot) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const isRoomPath = window.location.pathname.startsWith('/room/');
    const ctx = gsap.context(() => {
      if (!isRoomPath) {
        gsap.fromTo('.reveal', { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.09, ease: 'power3.out', clearProps: 'all' });
        gsap.fromTo('.orbit', { rotate: -20, scale: 0.88 }, { rotate: 0, scale: 1, duration: 1.2, ease: 'elastic.out(1, 0.6)', delay: 0.15 });
        gsap.to('.photo-left', { y: -16, rotation: -7, duration: 2.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
        gsap.to('.photo-right', { y: 18, rotation: 7, duration: 3.4, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 0.45 });
      }
      const appearTargets = gsap.utils.toArray<HTMLElement>([
        '.folio-hero > .folio-clock', '.folio-hero > .folio-status',
        '.about-canvas > *', '.about-more > *', '.how-hero > *', '.how-step', '.how-cta > *',
        '.featured-heading > span', '.featured-heading-title > *',
        '.flower-art', '.flower-copy > *',
        '.party-profile', '.party-contact-button', '.party-caption',
        '.room-nav', '.room-topline', '.player-shell', '.room-bottom-grid > *', '.sidebar-column > *',
      ].join(','), appRoot);
      if (appearTargets.length) {
        gsap.set(appearTargets, { autoAlpha: 0, y: 24 });
        ScrollTrigger.batch(appearTargets, {
          start: 'top 89%',
          once: true,
          onEnter: (batch) => gsap.to(batch, {
            autoAlpha: 1,
            y: 0,
            duration: 0.8,
            ease: 'power3.out',
            stagger: 0.12,
            overwrite: true,
          }),
        });
      }
    }, appRoot);
    return () => ctx.revert();
  }, [path]);
  const showToast = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800); }, []);
  const navigateRoom = useCallback((code: string) => { window.history.pushState({}, '', `/room/${code}`); window.scrollTo(0, 0); setPath(`/room/${code}`); setModal(null); }, []);
  const leaveRoom = useCallback(() => { window.history.pushState({}, '', '/'); setPath('/'); }, []);
  const navigateHow = useCallback(() => {
    window.history.pushState({}, '', '/how-it-works');
    setPath('/how-it-works');
    setMenuOpen(false);
    lenisRef.current?.scrollTo(0, { immediate: true });
  }, []);
  const navigateFeatured = useCallback(() => {
    const alreadyHome = window.location.pathname === '/';
    window.history.pushState({}, '', '/#featured-work');
    setMenuOpen(false);
    if (alreadyHome) {
      const target = document.getElementById('featured-work');
      if (target && lenisRef.current) lenisRef.current.scrollTo(target, { offset: -24 });
      else target?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    setPath('/');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = document.getElementById('featured-work');
      if (target && lenisRef.current) lenisRef.current.scrollTo(target, { offset: -24 });
      else target?.scrollIntoView({ behavior: 'smooth' });
    }));
  }, []);
  const roomCode = path.match(/^\/room\/([a-zA-Z0-9_-]+)\/?$/)?.[1]?.toUpperCase();
  const session = useMemo(() => roomCode ? (enteredSession?.code === roomCode ? enteredSession : getSession(roomCode)) : null, [roomCode, enteredSession]);

  useEffect(() => {
    if (roomCode && !session) setModal('join');
  }, [roomCode, session]);

  return <div ref={root} className="app-shell min-h-screen bg-paper font-sans antialiased">
    {roomCode && session ? <Room session={session} onLeave={leaveRoom} showToast={showToast} initialVideoId={featuredVideoId} onInitialVideoHandled={() => setFeaturedVideoId(null)} /> : path === '/about' ? <><AboutPage menuOpen={menuOpen} setMenuOpen={setMenuOpen} onHome={leaveRoom} onCreate={() => setModal('create')} onJoin={() => setModal('join')} onFeatured={navigateFeatured} onHow={navigateHow} />{modal && <EntryModal mode={modal} onClose={() => { setModal(null); setFeaturedVideoId(null); }} onComplete={(s) => { storeSession(s); setEnteredSession(s); navigateRoom(s.code); }} />}{toast && <Toast text={toast} />}</> : path === '/how-it-works' ? <><HowItWorksPage menuOpen={menuOpen} setMenuOpen={setMenuOpen} onHome={leaveRoom} onCreate={() => setModal('create')} onJoin={() => setModal('join')} onFeatured={navigateFeatured} onHow={navigateHow} />{modal && <EntryModal mode={modal} onClose={() => { setModal(null); setFeaturedVideoId(null); }} onComplete={(s) => { storeSession(s); setEnteredSession(s); navigateRoom(s.code); }} />}{toast && <Toast text={toast} />}</> : <>
      <div className="folio-page">
        <header className="folio-nav">
          <a className="folio-logo" href="/" aria-label="Watchparty home" onClick={(e) => { e.preventDefault(); leaveRoom(); }}><img src="/assets/nudge-logo.svg" alt="" /></a>
          <nav className={`folio-links ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
            <a className="active" href="#top" onClick={() => setMenuOpen(false)}><span>⌂</span> HOME</a><a href="/about" onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/about'); setPath('/about'); setMenuOpen(false); }}><span>✿</span> ABOUT</a><a href="/#featured-work" onClick={(e) => { e.preventDefault(); navigateFeatured(); }}><span>▣</span> THE GOOD STUFF</a><a href="/how-it-works" onClick={(e) => { e.preventDefault(); navigateHow(); }}><span>✣</span> HOW IT WORKS</a>
          </nav>
          <div className="folio-nav-actions"><span className="folio-avatar"><img src="https://framerusercontent.com/images/DxEColy2Zkko0WyVGe1jwbs7BpI.png?height=354&width=278" alt="Watchparty host" /></span><button onClick={() => setModal('create')}>♥ &nbsp; START A PARTY</button></div>
          <button className="mobile-menu folio-menu" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
        </header>
        <div className="folio-ruler" aria-hidden="true"><span>100</span><span>200</span><span>300</span><span>400</span><span>500</span><span>600</span><span>700</span><span>800</span><span>900</span><span>1000</span><span>1100</span><span>1200</span><span>1300</span><span>1400</span><span>1500</span></div>
        <main id="top" className="folio-main">
          <section className="folio-hero" aria-label="Watchparty home">
            <FolioClock />
            <span className="folio-photo photo-left"><img src="https://framerusercontent.com/images/DxEColy2Zkko0WyVGe1jwbs7BpI.png?height=354&width=278" alt="A member of the Watchparty crew" /></span>
            <span className="folio-photo photo-right" aria-label="YouTube"><svg className="youtube-float-logo" viewBox="0 0 48 34" role="img" aria-label="YouTube logo"><rect x="1" y="1" width="46" height="32" rx="10" fill="#ff0033"/><path d="M20 10.5v13l11-6.5z" fill="#fff"/></svg></span>
            <div className="folio-name-wrap reveal"><div className="folio-hand">your place for</div><span className="folio-note note-mint">Currently syncing everyone</span><span className="folio-note note-yellow">Previously watching alone</span><h1 className="folio-name">WATCHPARTY</h1><span className="folio-handle handle-a"/><span className="folio-handle handle-b"/><span className="folio-handle handle-c"/><span className="folio-handle handle-d"/></div>
            <p className="folio-status"><i /> READY TO STREAM YOUTUBE TOGETHER</p>
            <div className="folio-lower reveal"><span className="folio-sticker sticker-left">HOST CONTROLS</span><span className="folio-sticker sticker-right">YOUTUBE, TOGETHER</span><h2>Watch together <b>◎</b><br />from anywhere <em>✳</em></h2><button className="folio-cta" onClick={() => setModal('create')}><span>▶</span> START A PARTY</button><button className="folio-join" onClick={() => setModal('join')}>I HAVE A ROOM CODE <ArrowRight size={14} /></button></div>
          </section>
          <AboutShowcase onCreate={() => setModal('create')} onJoin={() => setModal('join')} />
          <FeaturedWork onStream={(videoId) => { setFeaturedVideoId(videoId); setModal('create'); }} />
          <FlowerContact onCreate={() => setModal('create')} onJoin={() => setModal('join')} />
          <PartyContact onCreate={() => setModal('create')} />
        </main>
        <footer className="folio-footer"><span>WATCHPARTY@WEB3TASK</span><span>MADE FOR CLOSER, NOT LOUDER ♥</span><button onClick={() => setModal('join')}>JOIN A PARTY ↗</button></footer>
        <CustomCursor />
      </div>
      {modal && <EntryModal mode={modal} onClose={() => { setModal(null); setFeaturedVideoId(null); }} onComplete={(s) => { storeSession(s); setEnteredSession(s); navigateRoom(s.code); }} />}
      {toast && <Toast text={toast} />}
    </>}
  </div>;
}

function AboutPage({ menuOpen, setMenuOpen, onHome, onCreate, onJoin, onFeatured, onHow }: { menuOpen: boolean; setMenuOpen: (open: boolean) => void; onHome: () => void; onCreate: () => void; onJoin: () => void; onFeatured: () => void; onHow: () => void }) {
  return <div className="folio-page about-page">
    <header className="folio-nav">
      <a className="folio-logo" href="/" aria-label="Watchparty home" onClick={(e) => { e.preventDefault(); onHome(); }}><img src="/assets/nudge-logo.svg" alt="" /></a>
      <nav className={`folio-links ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
        <a href="/" onClick={(e) => { e.preventDefault(); onHome(); }}><span>⌂</span> HOME</a><a className="active" href="/about"><span>✿</span> ABOUT</a><a href="/#featured-work" onClick={(e) => { e.preventDefault(); onFeatured(); }}><span>▣</span> THE GOOD STUFF</a><a href="/how-it-works" onClick={(e) => { e.preventDefault(); onHow(); }}><span>✣</span> HOW IT WORKS</a>
      </nav>
      <div className="folio-nav-actions"><span className="folio-avatar"><img src="https://framerusercontent.com/images/DxEColy2Zkko0WyVGe1jwbs7BpI.png?height=354&width=278" alt="Watchparty host" /></span><button onClick={onCreate}>♥ &nbsp; START A PARTY</button></div>
      <button className="mobile-menu folio-menu" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
    </header>
    <AboutShowcase onCreate={onCreate} onJoin={onJoin} />
    <footer className="folio-footer"><span>WATCHPARTY@WEB3TASK</span><span>MADE FOR CLOSER, NOT LOUDER ♥</span><button onClick={onJoin}>JOIN A PARTY ↗</button></footer>
    <CustomCursor />
  </div>;
}

function HowItWorksPage({ menuOpen, setMenuOpen, onHome, onCreate, onJoin, onFeatured, onHow }: { menuOpen: boolean; setMenuOpen: (open: boolean) => void; onHome: () => void; onCreate: () => void; onJoin: () => void; onFeatured: () => void; onHow: () => void }) {
  const steps = [
    { number: '01', icon: <Users size={24} />, title: 'Make a room', text: 'Start a party and choose your name. We’ll make a room code you can share with your friends.', note: 'YOUR ROOM, YOUR PEOPLE' },
    { number: '02', icon: <Link2 size={24} />, title: 'Pick a video', text: 'Paste a YouTube link in the room, or start with one of the featured picks on the home page.', note: 'ANY YOUTUBE LINK' },
    { number: '03', icon: <Play size={24} />, title: 'Hit play together', text: 'Everyone watches the same moment in sync. The host can play, pause, and keep the room moving.', note: 'ONE PLAY BUTTON' },
    { number: '04', icon: <MessageCircle size={24} />, title: 'Make it a hangout', text: 'Chat while you watch, invite more people, and send video requests for what comes next.', note: 'STAY IN THE MOMENT' },
  ];
  return <div className="folio-page how-page">
    <header className="folio-nav">
      <a className="folio-logo" href="/" aria-label="Watchparty home" onClick={(e) => { e.preventDefault(); onHome(); }}><img src="/assets/nudge-logo.svg" alt="" /></a>
      <nav className={`folio-links ${menuOpen ? 'open' : ''}`} aria-label="Main navigation">
        <a href="/" onClick={(e) => { e.preventDefault(); onHome(); }}><span>⌂</span> HOME</a><a href="/about" onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/about'); window.dispatchEvent(new PopStateEvent('popstate')); setMenuOpen(false); }}><span>✿</span> ABOUT</a><a href="/#featured-work" onClick={(e) => { e.preventDefault(); onFeatured(); }}><span>▣</span> THE GOOD STUFF</a><a className="active" href="/how-it-works" onClick={(e) => { e.preventDefault(); onHow(); }}><span>✣</span> HOW IT WORKS</a>
      </nav>
      <div className="folio-nav-actions"><span className="folio-avatar"><img src="https://framerusercontent.com/images/DxEColy2Zkko0WyVGe1jwbs7BpI.png?height=354&width=278" alt="Watchparty host" /></span><button onClick={onCreate}>♥ &nbsp; START A PARTY</button></div>
      <button className="mobile-menu folio-menu" aria-label="Open menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button>
    </header>
    <main className="how-main">
      <section className="how-hero">
        <span className="how-eyebrow"><i /> THE WATCHPARTY FIELD GUIDE&nbsp; ✳ &nbsp;01—04</span>
        <h1>Good videos.<br /><em>Better together.</em></h1>
        <p>Four little steps from “what should we watch?” to watching it together.</p>
        <span className="how-doodle" aria-hidden="true">✳</span>
      </section>
      <section className="how-steps" aria-label="How Watchparty works">
        {steps.map((step) => <article className="how-step" key={step.number}>
          <div className="how-step-top"><span className="how-step-number">{step.number}</span><span className="how-step-icon">{step.icon}</span></div>
          <h2>{step.title}</h2><p>{step.text}</p><span className="how-step-note">{step.note}</span>
        </article>)}
      </section>
      <section className="how-cta"><span>THAT’S THE WHOLE THING</span><h2>Now, who’s<br /><em>watching with you?</em></h2><div><button onClick={onCreate}>START A PARTY <ArrowRight size={16} /></button><button onClick={onJoin}>JOIN WITH A CODE <ArrowUpRight size={16} /></button></div></section>
    </main>
    <footer className="folio-footer"><span>WATCHPARTY@WEB3TASK</span><span>MADE FOR CLOSER, NOT LOUDER ♥</span><button onClick={onJoin}>JOIN A PARTY ↗</button></footer>
    <CustomCursor />
  </div>;
}

function FolioClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <div className="folio-clock" aria-label={`Local time ${now.toLocaleTimeString()}`}>
    {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now)}
  </div>;
}

function AboutShowcase({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return <section className="folio-main about-main">
      <section className="about-canvas">
        <span className="about-scribble">about us!</span>
        <h1 className="about-question"><span>what's up</span></h1>
        <figure className="about-polaroid polaroid-left"><img src="/assets/friends-watchparty.jpg" alt="Four Indian friends laughing together while watching a video" /><figcaption>your people</figcaption></figure>
        <figure className="about-polaroid polaroid-right"><img src="https://framerusercontent.com/images/jaipCY5FvgftEDz3qtilGNnLVk.png?height=1024&width=683" alt="A cozy place to watch together" /><figcaption>your place</figcaption></figure>
        <span className="about-you"><i/>YOU</span>
        <p className="about-statement">We’re Watchparty <img src="https://framerusercontent.com/images/DxEColy2Zkko0WyVGe1jwbs7BpI.png?height=354&width=278" alt="A Watchparty member" /> a little corner of the internet that gets excited <b className="about-burst">✿</b> about bringing people together to stream YouTube in sync <b className="about-heart">♥</b>.</p>
        <div className="about-tags" aria-label="What Watchparty does">
          <div className="about-tag-row">
            <div className="about-tag-pair"><span className="tag-yellow">Synchronized Watching</span><i className="tag-icon icon-black"><img src="/assets/framer-icon-interaction.svg" alt="" /></i></div>
            <div className="about-tag-pair"><span className="tag-green">Private Rooms</span><i className="tag-icon icon-sun"><img src="/assets/framer-icon-prototyping.svg" alt="" /></i></div>
          </div>
          <div className="about-tag-row">
            <div className="about-tag-pair"><span className="tag-pink">Real-time Chat</span><i className="tag-icon icon-eye"><img src="/assets/framer-icon-research.svg" alt="" /></i></div>
            <div className="about-tag-pair"><span className="tag-blue">Host Controls</span><i className="tag-icon icon-dots"><img src="/assets/framer-icon-motion.svg" alt="" /></i></div>
          </div>
        </div>
        <div className="about-actions"><button onClick={onCreate}>MAKE A WATCHPARTY <ArrowUpRight size={16}/></button><button onClick={onJoin}>JOIN WITH A CODE <ArrowRight size={15}/></button></div>
      </section>
      <section className="about-more"><span>MADE FOR THE PEOPLE YOU WISH WERE HERE</span><p>Pick a video, invite your people, and enjoy the little magic of being together—even from miles apart.</p></section>
    </section>
}

function FeaturedWork({ onStream }: { onStream: (videoId: string) => void }) {
  const cardStack = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const stack = cardStack.current;
    if (!stack || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cards = Array.from(stack.querySelectorAll<HTMLElement>('.work-card'));
    if (cards.length < 2) return;
    stack.classList.add('is-scroll-stack');

    const context = gsap.context(() => {
      gsap.set(cards, { transformOrigin: '50% 0%' });
      gsap.set(cards.slice(1), { yPercent: 110 });
      const sequence = gsap.timeline({
        scrollTrigger: {
          trigger: stack,
          start: 'top top+=64',
          end: () => `+=${window.innerHeight * (cards.length - 1 + 0.4)}`,
          pin: true,
          scrub: 0.7,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      });
      const tabs = Array.from(stack.querySelectorAll<HTMLElement>('.work-project-tab'));
      const updateTabs = () => {
        const activeIndex = Math.min(cards.length - 1, Math.floor(sequence.progress() * (cards.length - 1) + 0.001));
        tabs.forEach((tab, index) => {
          tab.classList.toggle('active', index === activeIndex);
          if (index === activeIndex) tab.setAttribute('aria-current', 'step');
          else tab.removeAttribute('aria-current');
        });
        cards[cards.length - 1].classList.toggle('is-final-layer', sequence.progress() > 0.94);
      };
      sequence.eventCallback('onUpdate', updateTabs);
      updateTabs();

      cards.slice(1).forEach((card, index) => {
        gsap.set(card, { zIndex: index + 2 });
        sequence.to(cards[index], { scale: 0.965, yPercent: -2, ease: 'none', duration: 1 }, index);
        sequence.to(card, { yPercent: 0, ease: 'none', duration: 1 }, index);
      });
      const tabHeight = tabs[0]?.offsetHeight || 78;
      sequence.to(cards[cards.length - 1], { top: tabHeight, ease: 'none', duration: 0.24 }, cards.length - 1 - 0.24);
      sequence.to(tabs, { autoAlpha: 1, y: 0, ease: 'power1.out', duration: 0.2, stagger: 0.025 }, cards.length - 1 - 0.2);
      sequence.to({}, { duration: 0.4 });
    }, stack);

    return () => { context.revert(); stack.classList.remove('is-scroll-stack'); stack.querySelector('.work-card:last-of-type')?.classList.remove('is-final-layer'); };
  }, []);
  const cards = [
    { title: 'The 100% Problem · Short Film', date: 'SHORT FILM · WATCHLIST', description: 'Settle in together for a short film on this week’s Watchparty list.', videoId: 'mAt3tNxjHUY', tag: 'SHORT FILM', tag2: 'WATCHLIST', color: 'cyan' },
    { title: 'iPhone 18 Pro Max vs iPhone 17 Pro Max', date: 'TECH · PHONE COMPARISON', description: 'A Hindi comparison of the iPhone 18 Pro Max and iPhone 17 Pro Max to watch and discuss together.', videoId: 'Gludm2LhYT4', tag: 'TECH', tag2: 'HINDI', color: 'ink' },
    { title: 'BMSD 2026 · Qualifiers Week 3', date: 'TRENDING GAMING · LIVE', description: 'Catch the BGMI esports qualifiers together and follow every clutch moment in the room.', videoId: 'eirM68AnN78', tag: 'BGMI', tag2: 'ESPORTS', color: 'yellow' },
    { title: 'Jadal Zamana · Interval Theme', date: 'TRENDING MUSIC · TELUGU', description: 'Anirudh Ravichander’s powerful theme from The Paradise is made for a full-volume group listen.', videoId: 'bYN2t0AjVuE', tag: 'SOUNDTRACK', tag2: 'TRENDING', color: 'pink' },
  ];
  return <section className="featured-work" id="featured-work" aria-label="Watchparty features">
    <header className="featured-heading"><span>02 / THIS WEEK’S YOUTUBE WATCHLIST</span><div className="featured-heading-title"><span className="featured-scribble">explore this week!</span><h2><span>FEATURED</span><span>VIDEOS</span></h2><p className="featured-note">Pick a video, invite your people, and press play together.</p></div></header>
    <div className="work-card-list" ref={cardStack}>
      <div className="work-project-tabs" aria-label="Featured video cards">{cards.map((card, index) => <div className={`work-project-tab work-${card.color}${index === 0 ? ' active' : ''}`} key={card.date} aria-current={index === 0 ? 'step' : undefined}><span>◢ &nbsp; VIDEO &nbsp;{String(index + 1).padStart(2, '0')}</span></div>)}</div>
      {cards.map((card, index) => <article className={`work-card work-${card.color}`} key={card.date}>
      <div className="work-project-label"><span>◢ &nbsp; VIDEO &nbsp;{String(index + 1).padStart(2, '0')}</span></div>
      <div className="work-copy"><div className="work-date"><i/> {card.date}</div><h3>{card.title}</h3><p>{card.description}</p><div className="work-card-actions"><a className="work-link" href={`https://www.youtube.com/watch?v=${card.videoId}`} target="_blank" rel="noreferrer">WATCH ON YOUTUBE <ArrowUpRight size={15}/></a><button className="work-stream-button" onClick={() => onStream(card.videoId)}><Play size={13} fill="currentColor"/> STREAM TO WATCH PARTY</button></div><div className="work-tags"><span>{card.tag}</span><span>{card.tag2}</span></div></div>
      <a className="work-image" href={`https://www.youtube.com/watch?v=${card.videoId}`} target="_blank" rel="noreferrer" aria-label={`Watch ${card.title} on YouTube`}><img src={`https://img.youtube.com/vi/${card.videoId}/maxresdefault.jpg`} onError={(event) => { event.currentTarget.src = `https://img.youtube.com/vi/${card.videoId}/hqdefault.jpg`; }} alt={`${card.title} YouTube thumbnail`} /><span className="work-file"><b>▶</b> YOUTUBE</span><span className="work-corner corner-one"/><span className="work-corner corner-two"/><span className="work-corner corner-three"/><span className="work-corner corner-four"/><span className="work-play">▶</span></a>
    </article>)}
    </div>
  </section>;
}

function FlowerContact({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return <section className="flower-contact" aria-labelledby="flower-contact-title">
    <div className="flower-art" aria-hidden="true"><svg viewBox="0 0 260 260" role="presentation">
      <path d="M130 17C167-7 210 7 220 43c9 32-8 58-31 87 29 24 55 54 46 88-10 39-56 47-105 17-42 31-91 32-112 1-21-31-6-70 28-106C13 99 1 57 25 27 49-3 88 2 130 17Z" fill="#2cbd88" stroke="#111" strokeWidth="2" strokeLinejoin="round"/>
      <g fill="#111">
        <ellipse cx="101" cy="73" rx="8" ry="11"/><ellipse cx="157" cy="73" rx="8" ry="11"/>
        <circle cx="104" cy="69" r="2.5" fill="#fff"/><circle cx="160" cy="69" r="2.5" fill="#fff"/>
      </g>
    </svg></div>
    <div className="flower-copy"><span>GOOD VIDEOS ARE BETTER TOGETHER</span><h2 id="flower-contact-title">PLAY IT<br />TOGETHER</h2><p>Bring your favorite video and your favorite people. We’ll keep everyone watching in sync, wherever they are.</p><div className="flower-actions"><button onClick={onCreate}>START A WATCHPARTY <ArrowUpRight size={16}/></button><button onClick={onJoin}>JOIN WITH A ROOM CODE <ArrowRight size={15}/></button></div></div>
  </section>;
}

function PartyContact({ onCreate }: { onCreate: () => void }) {
  const section = useRef<HTMLElement>(null);
  const upperRing = useRef<SVGPathElement>(null);
  const lowerRing = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    if (!section.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const paths = [upperRing.current, lowerRing.current].filter((path): path is SVGPathElement => Boolean(path));
    const context = gsap.context(() => {
      paths.forEach((path, index) => {
        const length = path.getTotalLength();
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
        gsap.to(path, {
          strokeDashoffset: 0,
          ease: 'none',
          scrollTrigger: {
            trigger: section.current,
            start: index === 0 ? 'top 88%' : 'top 78%',
            end: index === 0 ? 'top 18%' : 'top 8%',
            scrub: true,
            invalidateOnRefresh: true,
          },
        });
      });
    }, section);
    return () => context.revert();
  }, []);
  return <section ref={section} className="party-contact" aria-label="Start a Watchparty">
    <svg className="party-rings" viewBox="0 0 1400 690" preserveAspectRatio="none" aria-hidden="true">
      <path ref={upperRing} d="M 785 -105 C 830 160, 945 292, 1160 325 C 1360 356, 1480 256, 1550 415" />
      <path ref={lowerRing} d="M -105 375 C 110 292, 365 346, 475 510 C 538 604, 548 676, 570 795" />
    </svg>
    <div className="party-profile"><img src="https://framerusercontent.com/images/DxEColy2Zkko0WyVGe1jwbs7BpI.png?height=354&width=278" alt="Watchparty host"/><div><strong>Watchparty</strong><p>Open a room, invite your people, and stream YouTube together in sync.</p><span>✦ &nbsp; READY WHEN YOU ARE</span></div><b className="party-like">↗ &nbsp; LET’S GO</b></div>
    <button className="party-contact-button" onClick={onCreate} aria-label="Start a Watchparty"><span className="party-arrow"><span>»</span></span><strong>LET’S PARTY</strong><span className="party-arrow"><span>»</span></span></button>
    <span className="party-caption">YOUR PEOPLE. YOUR VIDEO. ONE SHARED MOMENT.</span>
  </section>;
}

function CustomCursor() {
  const dot = useRef<HTMLSpanElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!dot.current || !label.current || !window.matchMedia('(pointer: fine)').matches) return;
    const dotNode = dot.current;
    const labelNode = label.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const xTo = gsap.quickTo(labelNode, 'x', { duration: reducedMotion ? 0.01 : 0.34, ease: 'power3.out' });
    const yTo = gsap.quickTo(labelNode, 'y', { duration: reducedMotion ? 0.01 : 0.34, ease: 'power3.out' });
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      gsap.set(dotNode, { x: event.clientX, y: event.clientY, xPercent: -50, yPercent: -50 });
      xTo(event.clientX + 10);
      yTo(event.clientY + 16);
      dotNode.dataset.visible = 'true';
      labelNode.dataset.visible = 'true';
    };
    const leave = () => { dotNode.dataset.visible = 'false'; labelNode.dataset.visible = 'false'; };
    document.body.classList.add('watchparty-cursor-enabled');
    window.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', leave);
    window.addEventListener('blur', leave);
    return () => {
      document.body.classList.remove('watchparty-cursor-enabled');
      window.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', leave);
      window.removeEventListener('blur', leave);
      gsap.killTweensOf(labelNode);
      gsap.killTweensOf(dotNode);
    };
  }, []);
  return <div className="custom-you-cursor" aria-hidden="true"><span className="cursor-you-dot" ref={dot}/><span className="cursor-you-label" ref={label}>YOU</span></div>;
}

function EntryModal({ mode, onClose, onComplete }: { mode: 'create' | 'join'; onClose: () => void; onComplete: (s: Session) => void }) {
  const [name, setName] = useState(sessionStorage.getItem(accountNameKey) || '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountToken, setAccountToken] = useState(sessionStorage.getItem(accountTokenKey) || '');
  const [accountChecked, setAccountChecked] = useState(!sessionStorage.getItem(accountTokenKey));
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
  const [code, setCode] = useState(new URLSearchParams(window.location.search).get('code') || window.location.pathname.match(/^\/room\/([A-Z0-9_-]+)/i)?.[1] || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!accountToken) { setAccountChecked(true); return; }
    let active = true;
    fetch(`${apiUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${accountToken}` } })
      .then(async (response) => {
        const data = await response.json();
        if (!active) return;
        if (!response.ok) {
          sessionStorage.removeItem(accountTokenKey);
          sessionStorage.removeItem(accountNameKey);
          setAccountToken(''); setName(''); setAuthMode('login');
          return;
        }
        setName(data.account.name);
        sessionStorage.setItem(accountNameKey, data.account.name);
      })
      .catch(() => { if (active) setError('Could not check your sign-in. Check your connection and try again.'); })
      .finally(() => { if (active) setAccountChecked(true); });
    return () => { active = false; };
  }, [accountToken]);
  useEffect(() => { if (!accountToken) input.current?.focus(); }, [accountToken]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true);
    try {
      let token = accountToken;
      let accountName = name;
      if (!token) {
        const authResponse = await fetch(`${apiUrl}/api/auth/${authMode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(authMode === 'register' ? { name, email, password } : { email, password }) });
        const authData = await authResponse.json().catch(() => ({ error: 'The server returned an unexpected response. Check that Watchparty is running and try again.' }));
        if (!authResponse.ok) throw new Error(authData.error || 'Could not sign in.');
        token = authData.token;
        accountName = authData.account.name;
        sessionStorage.setItem(accountTokenKey, token);
        sessionStorage.setItem(accountNameKey, accountName);
        setAccountToken(token);
        setName(accountName);
        if (!name) setName(authData.account.name);
      }
      const response = await fetch(`${apiUrl}/api/rooms${mode === 'create' ? '' : '/join'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(mode === 'create' ? { username: accountName } : { username: accountName, code }),
      });
      const data = await response.json().catch(() => ({ error: 'The server returned an unexpected response. Check that Watchparty is running and try again.' }));
      if (response.status === 401) {
        sessionStorage.removeItem(accountTokenKey);
        sessionStorage.removeItem(accountNameKey);
        setAccountToken(''); setName(''); setAuthMode('login');
        throw new Error('Your sign-in expired. Sign in again to continue.');
      }
      if (!response.ok) throw new Error(data.error || 'Something went wrong. Try again.');
      onComplete(data as Session);
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      setError(message.includes('fetch') || message.includes('NetworkError') ? 'Could not reach Watchparty. Check your connection and try again.' : message || 'Could not connect. Try again in a moment.');
    }
    finally { setLoading(false); }
  };
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="entry-modal w-full max-w-[426px]" role="dialog" aria-modal="true" aria-labelledby="entry-title">
      <button className="modal-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
      <div className="modal-stamp"><Play size={18} fill="currentColor" /></div><span className="micro-label">{mode === 'create' ? 'YOUR YOUTUBE ROOM' : 'COME ON IN'}</span>
      <h2 id="entry-title">{mode === 'create' ? <>Start a YouTube<br /><em>watchparty.</em></> : <>There's room<br /><em>for one more.</em></>}</h2>
      <form onSubmit={submit}>
        {!accountToken && <><label htmlFor="account-email">{authMode === 'register' ? 'Create account' : 'Sign in'}</label>{authMode === 'register' && <input ref={input} value={name} onChange={(e) => { setName(e.target.value); sessionStorage.setItem(accountNameKey, e.target.value); }} placeholder="Your name" maxLength={32} required autoComplete="name" />}<input id="account-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" required autoComplete="email" /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+ characters)" minLength={authMode === 'register' ? 8 : 1} required autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} /><button type="button" className="auth-switch" onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}>{authMode === 'register' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button></>}
        {accountToken && <div className="signed-in-note"><span>Signed in as <b>{accountChecked ? name : 'checking…'}</b></span><button type="button" onClick={() => { sessionStorage.removeItem(accountTokenKey); sessionStorage.removeItem(accountNameKey); setAccountToken(''); setName(''); setAuthMode('login'); setError(''); }}>Switch account</button></div>}
        {mode === 'join' && <><label htmlFor="room-code">Room code</label><input id="room-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} placeholder="E.g. SUNSET" maxLength={8} required className="code-input" /></>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-dark modal-submit" type="submit" disabled={loading || !accountChecked}>{loading || !accountChecked ? <><LoaderCircle size={16} className="spin" /> One sec...</> : mode === 'create' ? <>Let's get this going <ArrowRight size={16} /></> : <>Join the party <ArrowRight size={16} /></>}</button>
      </form>
      <p className="modal-foot">A LITTLE ACCOUNT. A LOT OF GOOD COMPANY.</p>
    </section>
  </div>;
}

function Room({ session, onLeave, showToast, initialVideoId, onInitialVideoHandled }: { session: Session; onLeave: () => void; showToast: (m: string) => void; initialVideoId?: string | null; onInitialVideoHandled: () => void }) {
  const [state, setState] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState<Request[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [chat, setChat] = useState<{ name: string; text: string; at: string }[]>([]);
  const [reactions, setReactions] = useState<{ id: string; emoji: string; username: string }[]>([]);
  const [chatText, setChatText] = useState('');
  const [copied, setCopied] = useState(false);
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const [roleMenu, setRoleMenu] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [startedVideoId, setStartedVideoId] = useState<string | null>(null);
  const socket = useRef<Socket | null>(null);
  const player = useRef<YTPlayer | null>(null);
  const videoHost = useRef<HTMLDivElement>(null);
  const lastVideo = useRef<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const initialVideoSent = useRef(false);
  const canControl = session.role === 'host' || session.role === 'moderator';

  useEffect(() => {
    const client = io(socketUrl, { auth: { code: session.code, token: session.token, accountToken: session.accountToken }, reconnectionAttempts: 8, reconnectionDelayMax: 4000 });
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
    client.on('reaction', (reaction: { id: string; emoji: string; username: string }) => {
      setReactions((old) => [...old, reaction]);
      window.setTimeout(() => setReactions((old) => old.filter((item) => item.id !== reaction.id)), 2400);
    });
    client.on('host_transferred', ({ to }: { to: string }) => showToast(`The host seat is now ${to}'s.`));
    return () => { client.disconnect(); player.current?.destroy(); player.current = null; setPlayerReady(false); };
  }, [session, onLeave, showToast]);

  useEffect(() => {
    if (!state?.videoId) return;
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
          width: '100%', height: '100%', videoId: snapshot.videoId || undefined,
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
          }, onStateChange: (event: { data: number }) => {
            const playing = event.data === window.YT?.PlayerState.PLAYING;
            setPlayerPlaying(playing);
            if (lastVideo.current && [window.YT?.PlayerState.PLAYING, window.YT?.PlayerState.PAUSED, window.YT?.PlayerState.ENDED].includes(event.data)) setStartedVideoId(lastVideo.current);
          }, onError: () => showToast('YouTube could not load that video. Try another link.') },
        });
      }
    }
  }, [state?.videoId]);

  useEffect(() => {
    if (!state || !playerReady || !player.current) return;
    const active = state.isPlaying ? state.currentTime + Math.max(0, (Date.now() - state.updatedAt) / 1000) : state.currentTime;
    if (state.videoId && lastVideo.current !== state.videoId && typeof player.current.loadVideoById === 'function' && typeof player.current.cueVideoById === 'function') {
      setStartedVideoId(null);
      lastVideo.current = state.videoId;
      if (state.isPlaying) player.current.loadVideoById(state.videoId); else player.current.cueVideoById(state.videoId);
      return;
    }
    const actual = player.current.getCurrentTime?.() || 0;
    if (Math.abs(actual - active) > 3 && state.videoId && typeof player.current.seekTo === 'function') player.current.seekTo(active, true);
    if (state.isPlaying && typeof player.current.playVideo === 'function') player.current.playVideo();
    else if (!state.isPlaying && typeof player.current.pauseVideo === 'function') player.current.pauseVideo();
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
    if (action !== 'change_video' && !state?.videoId) { showToast('Add a YouTube video before starting playback.'); return; }
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
  useEffect(() => {
    if (!initialVideoId || !state || initialVideoSent.current) return;
    initialVideoSent.current = true;
    handleAction('change_video', { videoId: initialVideoId });
    showToast('Your featured video is ready to stream.');
    onInitialVideoHandled();
  }, [initialVideoId, state]);
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
    <header className="folio-nav room-nav">
      <a className="folio-logo" href="/" aria-label="Watchparty home" onClick={(e) => { e.preventDefault(); onLeave(); }}><img src="/assets/nudge-logo.svg" alt="" /></a>
      <nav className={`folio-links room-links ${roomMenuOpen ? 'open' : ''}`} aria-label="Room navigation">
        <a className="active" href="#room-watch" onClick={() => setRoomMenuOpen(false)}><span>▶</span> THE ROOM</a>
      </nav>
      <div className="folio-nav-actions room-nav-actions"><div className="room-live-pill"><span className={`live-dot ${connected ? '' : 'offline'}`} />{connected ? 'PARTY IS LIVE' : 'RECONNECTING'}</div><span className="folio-avatar room-avatar" aria-label={`Signed in as ${session.username}`}>{initials(session.username)}</span><button className="room-leave" onClick={onLeave}><LogOut size={15} /> Leave room</button></div>
      <button className="mobile-menu folio-menu room-menu-button" aria-label={roomMenuOpen ? 'Close room menu' : 'Open room menu'} aria-expanded={roomMenuOpen} onClick={() => setRoomMenuOpen(!roomMenuOpen)}>{roomMenuOpen ? <X /> : <Menu />}</button>
    </header>
    <div className="room-body page-width">
      <div className="room-topline"><div><div className="micro-label">THE YOUTUBE ROOM <span className="coral-period">✳</span></div><h1 className="room-title">YouTube <em>is on.</em></h1></div><div className="room-invite"><div className="invite-code-label">ROOM CODE</div><strong>{session.code}</strong><button onClick={copyInvite}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy invite'}</button></div></div>
      {error && <div className="connection-note"><span className="live-dot offline" /> {error} <button onClick={() => socket.current?.connect()}>Try again</button></div>}
      <div className="room-grid">
        <section className="player-column" id="room-watch">
          <div className="player-shell"><div className="player-topbar"><div className="topbar-now"><span className="live-dot" /> NOW STREAMING <span className="player-video-label">{state?.videoId ? 'YOUR PICK' : 'PASTE A YOUTUBE LINK TO BEGIN'}</span></div><button className="player-more" onClick={() => void copyInvite()}><Link2 size={15} /> Invite someone</button></div><div className="player-frame"><div ref={videoHost} className="youtube-stage"/><div className={`player-cover ${state?.videoId ? 'has-video' : ''} ${state?.videoId && (state.isPlaying || startedVideoId === state.videoId) ? 'playing' : ''}`} aria-hidden="true">{state?.videoId ? <img className="player-thumbnail" src={`https://img.youtube.com/vi/${state.videoId}/hqdefault.jpg`} alt="" /> : <><div className="cover-stars">✦ &nbsp; ✳ &nbsp; ✦</div><div className="cover-center"><span>WATCHPARTY</span><b>YOUTUBE<br />TOGETHER</b><i>everybody hits play at once</i></div><div className="cover-bottom"><span>WITH YOUR PEOPLE</span><span>WP — {session.code}</span></div></>}</div><div className="reaction-floats" aria-live="polite">{reactions.map((reaction) => <span key={reaction.id} title={`${reaction.username} reacted`}>{reaction.emoji}</span>)}</div><div className="player-overlay-controls"><button className="big-play" aria-label={state?.isPlaying ? 'Pause video' : 'Play video'} onClick={() => handleAction(state?.isPlaying ? 'pause' : 'play')}><span>{state?.isPlaying ? <Pause fill="currentColor" size={24} /> : <Play fill="currentColor" size={24} />}</span></button></div>{state?.isPlaying && !playerPlaying && <button className="sync-nudge" onClick={() => { player.current?.unMute(); player.current?.playVideo(); }}><Play size={12} fill="currentColor" /> Tap to start your video</button>}<div className="reaction-picker" aria-label="Send a reaction">{['👏', '❤️', '😂', '🔥', '✨', '🍿'].map((reaction) => <button key={reaction} onClick={() => socket.current?.emit('reaction', { emoji: reaction })} aria-label={`React ${reaction}`}>{reaction}</button>)}</div></div>
            <div className="player-controls"><button className="control-play" onClick={() => handleAction(state?.isPlaying ? 'pause' : 'play')}>{state?.isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}{state?.isPlaying ? 'Pause for everyone' : 'Play for everyone'}</button><span className="time-readout">{formatTime(currentTime)} <span>/</span> {formatTime(duration)}</span><input className="timeline" type="range" min="0" max={duration || 1} step="0.25" value={Math.min(currentTime, duration || 1)} aria-label="Seek video for everyone" disabled={!duration} onChange={(e) => setCurrentTime(Number(e.target.value))} onMouseUp={(e) => handleAction('seek', { time: Number(e.currentTarget.value) })} onTouchEnd={(e) => handleAction('seek', { time: Number(e.currentTarget.value) })} onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) handleAction('seek', { time: Number(e.currentTarget.value) }); }} /><a className="chat-toggle" href="#room-chat"><MessageCircle size={16} /> Chat <span className="chat-count">{chat.length}</span></a></div>
            <div className="video-form"><div className="form-scribble">{emoji[2]}</div><div className="video-form-copy"><b>Got something in mind?</b><span>{controlsAllowed ? 'Paste a YouTube link and switch it up.' : 'Suggest a video for the host to pop on.'}</span></div><div className="video-input"><input aria-label="YouTube URL" placeholder="Paste a YouTube link..." value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') updateVideo(); }} /><button onClick={updateVideo} aria-label="Submit video"><ArrowUpRight size={16} /></button></div></div>
          </div>
          <div className="room-bottom-grid"><div className="room-note"><span className="micro-label">A NOTE FROM THE ROOM</span><p>“The best part of being together is forgetting how far apart you are.”</p><span className="note-byline">— SOMEONE VERY WISE <span className="coral-period">♥</span></span></div><div className="room-vibe"><span className="micro-label">THE VIBE CHECK</span><div className="vibe-icons"><span>🍿</span><span>🧦</span><span>🛋️</span></div><p>Comfy, we hope.</p></div></div>
        </section>
        <aside className="sidebar-column">
          <section className="people-card" id="room-people"><div className="side-card-heading"><div><span className="micro-label">IN THE ROOM</span><h2>Your people <span>{state?.participants.length || 0}</span></h2></div><Users size={19} /></div><div className="people-list">{state?.participants.map((participant, index) => <div className="person-row" key={participant.id}><div className={`avatar ${avatarTones[index % avatarTones.length]}`}>{initials(participant.name)}{participant.role === 'host' && <span className="host-star"><Crown size={10} fill="currentColor" /></span>}</div><div className="person-info"><b>{participant.name}{participant.id === session.userId ? ' (you)' : ''}</b><span>{participant.role === 'host' ? 'Host' : participant.role === 'moderator' ? 'Moderator' : 'Just vibing'}</span></div>{participant.id === session.userId ? <span className="you-pill">YOU</span> : <span className="online-mark" />}{myRole === 'host' && participant.id !== session.userId && <div className="person-menu-wrap"><button className="person-menu" aria-label={`Manage ${participant.name}`} onClick={() => setRoleMenu(roleMenu === participant.id ? null : participant.id)}><ChevronDown size={14} /></button>{roleMenu === participant.id && <div className="person-menu-pop"><button onClick={() => { socket.current?.emit('transfer_host', { userId: participant.id }); setRoleMenu(null); }}>Make host</button><button onClick={() => { socket.current?.emit('assign_role', { userId: participant.id, role: participant.role === 'moderator' ? 'participant' : 'moderator' }); setRoleMenu(null); }}>{participant.role === 'moderator' ? 'Make participant' : 'Make moderator'}</button><button className="danger-action" onClick={() => { socket.current?.emit('remove_participant', { userId: participant.id }); setRoleMenu(null); }}>Remove from room</button></div>}</div>}</div>)}</div><button className="invite-people" onClick={() => void copyInvite()}><Plus size={15} /> Invite more people</button></section>
          <section className="requests-card" id="room-requests"><div className="side-card-heading"><div><span className="micro-label">A LITTLE DEMOCRACY</span><h2>Requests <span className="request-count">{requests.length}</span></h2></div><Sparkles size={19} /></div>{requests.length === 0 ? <div className="empty-requests"><span className="empty-star">✳</span><p>{controlsAllowed ? 'All caught up.' : 'Want to change it up? Ask the host.'}</p><span>Requests from the room show up here.</span></div> : <div className="request-list">{requests.map((request) => <div className="request-row" key={request.id}><div className="request-copy"><b>{request.username}</b><span>{describeAction(request)}</span></div>{controlsAllowed ? <div className="request-actions"><button aria-label="Approve request" onClick={() => resolve(request, true)}><Check size={15} /></button><button aria-label="Decline request" onClick={() => resolve(request, false)}><X size={15} /></button></div> : <span className="pending-pill">PENDING</span>}</div>)}</div>}</section>
          <section className="chat-panel" id="room-chat"><div className="chat-header"><div><span className="micro-label">THE GROUP CHAT</span><strong>Say a little something</strong></div><span className="chat-count">{chat.length}</span></div><div className="chat-messages" aria-live="polite">{chat.length ? chat.map((message, i) => <div key={`${i}-${message.at}`} className="chat-message"><b>{message.name}</b><p>{message.text}</p><time>{message.at}</time></div>) : <div className="chat-empty"><MessageCircle size={20} /><p>Quiet room. Be the first to say something.</p></div>}</div><form className="chat-form" onSubmit={(e) => { e.preventDefault(); showChat(chatText); }}><input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Type a message..." maxLength={500} aria-label="Type a chat message" /><button aria-label="Send message"><Send size={16} /></button></form></section>
          <div className="roles-note"><LockKeyhole size={14} /><span>{controlsAllowed ? myRole === 'host' ? 'You’re the host. It’s your living room.' : 'You’re a moderator. Keep the good times rolling.' : 'Playback changes go through the host. Request away!'}</span></div>
        </aside>
      </div>
    </div>
    <CustomCursor />
  </main>;
}

function describeAction(request: Request) {
  if (request.action === 'play') return 'wants to press play';
  if (request.action === 'pause') return 'wants to pause for a sec';
  if (request.action === 'seek') return `wants to skip to ${formatTime(request.payload?.time || 0)}`;
  return 'wants to change the video';
}
function Toast({ text }: { text: string }) { return <div className="toast-message" role="status"><span>✳</span>{text}</div>; }
