
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import { GameState, Plane, Ring, Mine, OpposingObstacle, Cloud, Particle, ScoreVisual } from './types';

const CANVAS_WIDTH = window.innerWidth;
const CANVAS_HEIGHT = window.innerHeight;
const BASE_RING_SPAWN_INTERVAL = 1500;
const BASE_MINE_SPAWN_INTERVAL = 2500;
const BASE_OPPOSING_SPAWN_INTERVAL = 3000;
const CLOUD_SPAWN_INTERVAL = 1000;
const GAME_SPEED_START = 7;
const TILT_ANGLE = 0.35; // ~20 degrees

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>(GameState.START);
  const [score, setScore] = useState(0);
  const [aiReport, setAiReport] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState(false);
  const [gameSpeed, setGameSpeed] = useState(GAME_SPEED_START);
  const [isFlashing, setIsFlashing] = useState(false);

  // Audio Context Ref
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Game Engine Refs
  const planeRef = useRef<Plane>({
    y: CANVAS_HEIGHT / 2,
    targetY: CANVAS_HEIGHT / 2,
    velocity: 0,
    width: 80,
    height: 40,
    angle: 0
  });
  const ringsRef = useRef<Ring[]>([]);
  const minesRef = useRef<Mine[]>([]);
  const opposingRef = useRef<OpposingObstacle[]>([]);
  const cloudsRef = useRef<Cloud[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const trailsRef = useRef<Particle[]>([]);
  const visualsRef = useRef<ScoreVisual[]>([]);
  const frameId = useRef<number>(0);
  const lastRingSpawn = useRef<number>(0);
  const lastMineSpawn = useRef<number>(0);
  const lastOpposingSpawn = useRef<number>(0);
  const lastCloudSpawn = useRef<number>(0);
  
  const groundOffset = useRef<number>(0);
  const shakeIntensity = useRef<number>(0);

  // Pre-generate city data for consistent scrolling
  const cityData = useRef<{x: number, w: number, h: number, windows: {x: number, y: number}[]}[]>([]);
  useEffect(() => {
    const buildings = [];
    let currentX = 0;
    while (currentX < CANVAS_WIDTH * 2) {
      const w = 60 + Math.random() * 120;
      const h = 80 + Math.random() * 200;
      const windows = [];
      for (let row = 0; row < h / 20 - 1; row++) {
        for (let col = 0; col < w / 15 - 1; col++) {
          if (Math.random() > 0.4) {
            windows.push({ x: 5 + col * 15, y: 10 + row * 20 });
          }
        }
      }
      buildings.push({ x: currentX, w, h, windows });
      currentX += w + 10;
    }
    cityData.current = buildings;
  }, []);

  // Sound Synthesis Helpers
  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  const playDing = () => {
    console.log('PLAY_RING_SOUND');
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  };

  const playCrash = () => {
    console.log('PLAY_CRASH_SOUND');
    if (!audioCtxRef.current) return;
    const ctx = audioCtxRef.current;
    const bufferSize = ctx.sampleRate * 0.5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.5);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
    noise.stop(ctx.currentTime + 0.5);
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.4);
    oscGain.gain.setValueAtTime(0.6, ctx.currentTime);
    oscGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  };

  useEffect(() => {
    if (score > 0 && score % 5 === 0) {
      setGameSpeed(prev => prev * 1.15);
      setIsFlashing(true);
      const timer = setTimeout(() => setIsFlashing(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [score]);

  const generateFlightReport = async (finalScore: number) => {
    setLoadingAi(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `The pilot crashed with a score of ${finalScore}. 
                  Provide a very short, humorous, 1-sentence flight summary or crash investigation report from 'Sky Command'.`,
      });
      setAiReport(response.text || "Command lost connection. Keep flying!");
    } catch (e) {
      setAiReport("Engine failure! No report available.");
    } finally {
      setLoadingAi(false);
    }
  };

  const resetGame = useCallback(() => {
    planeRef.current = {
      y: CANVAS_HEIGHT / 2,
      targetY: CANVAS_HEIGHT / 2,
      velocity: 0,
      width: 80,
      height: 40,
      angle: 0
    };
    ringsRef.current = [];
    minesRef.current = [];
    opposingRef.current = [];
    cloudsRef.current = [];
    particlesRef.current = [];
    trailsRef.current = [];
    visualsRef.current = [];
    setScore(0);
    setGameSpeed(GAME_SPEED_START);
    setAiReport('');
    setIsFlashing(false);
    shakeIntensity.current = 0;
    lastRingSpawn.current = performance.now();
    lastMineSpawn.current = performance.now();
    lastOpposingSpawn.current = performance.now();
    lastCloudSpawn.current = performance.now();
  }, []);

  const startGame = () => {
    initAudio();
    resetGame();
    setGameState(GameState.PLAYING);
  };

  const endGame = () => {
    if (gameState === GameState.GAMEOVER) return;
    playCrash();
    shakeIntensity.current = 20;
    setGameState(GameState.GAMEOVER);
    generateFlightReport(score);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (gameState === GameState.PLAYING) planeRef.current.targetY = e.clientY;
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (gameState === GameState.PLAYING && e.touches[0]) planeRef.current.targetY = e.touches[0].clientY;
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, [gameState]);

  const update = useCallback((time: number) => {
    if (gameState !== GameState.PLAYING) {
      const ctx = canvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#4db8ff';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
      frameId.current = requestAnimationFrame(update);
      return;
    };

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const plane = planeRef.current;
    const lerpFactor = 0.15; 
    const prevY = plane.y;
    plane.y += (plane.targetY - plane.y) * lerpFactor;
    
    const deltaY = plane.y - prevY;
    if (Math.abs(deltaY) > 1) {
      const targetAngle = deltaY > 0 ? TILT_ANGLE : -TILT_ANGLE;
      plane.angle += (targetAngle - plane.angle) * 0.1;
    } else {
      plane.angle *= 0.9;
    }

    if (frameId.current % 2 === 0) {
      trailsRef.current.push({
        x: 100, 
        y: plane.y + (Math.random() - 0.5) * 10,
        vx: -gameSpeed * 0.5,
        vy: (Math.random() - 0.5) * 2,
        life: 1.0,
        color: 'rgba(255, 255, 255, 0.4)',
        size: 3 + Math.random() * 5
      });
    }

    if (shakeIntensity.current > 0) shakeIntensity.current *= 0.9;

    groundOffset.current = (groundOffset.current + gameSpeed * 0.8);

    const speedMult = gameSpeed / GAME_SPEED_START;
    const ringInt = BASE_RING_SPAWN_INTERVAL / speedMult;
    const mineInt = BASE_MINE_SPAWN_INTERVAL / speedMult;
    const oppInt = BASE_OPPOSING_SPAWN_INTERVAL / (speedMult * 1.5);

    if (time - lastRingSpawn.current > ringInt) {
      ringsRef.current.push({ id: Date.now(), x: CANVAS_WIDTH + 100, y: 100 + Math.random() * (CANVAS_HEIGHT - 350), radius: 60, thickness: 12, passed: false });
      lastRingSpawn.current = time;
    }
    if (time - lastMineSpawn.current > mineInt) {
      minesRef.current.push({ id: Date.now() + 1, x: CANVAS_WIDTH + 100, y: 50 + Math.random() * (CANVAS_HEIGHT - 300), radius: 30, rotation: 0 });
      lastMineSpawn.current = time;
    }
    if (score >= 10 && time - lastOpposingSpawn.current > oppInt) {
      opposingRef.current.push({ id: Date.now() + 2, x: CANVAS_WIDTH + 100, y: 50 + Math.random() * (CANVAS_HEIGHT - 300), radius: 30, rotation: 0, flicker: 0 });
      lastOpposingSpawn.current = time;
    }
    if (time - lastCloudSpawn.current > CLOUD_SPAWN_INTERVAL) {
      const isFar = Math.random() > 0.6;
      cloudsRef.current.push({
        id: Date.now() + 3,
        x: CANVAS_WIDTH + 300,
        y: Math.random() * (CANVAS_HEIGHT - 200),
        scale: isFar ? 0.5 + Math.random() * 0.5 : 1.0 + Math.random() * 1.5,
        speed: gameSpeed * (isFar ? 0.1 : 0.3),
        layer: isFar ? 'far' : 'mid'
      });
      lastCloudSpawn.current = time;
    }

    const px = 150;
    const py = plane.y;

    for (let i = ringsRef.current.length - 1; i >= 0; i--) {
      const r = ringsRef.current[i];
      r.x -= gameSpeed;
      const dx = px - r.x; const dy = py - r.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (!r.passed && px > r.x) {
        if (dist < r.radius - 10) {
          r.passed = true;
          setScore(s => s + 1);
          playDing();
          shakeIntensity.current = 8;
          visualsRef.current.push({ x: r.x, y: r.y, text: "DING!", life: 1.0 });
          for (let p = 0; p < 15; p++) particlesRef.current.push({ x: r.x, y: r.y, vx: (Math.random()-0.5)*12, vy: (Math.random()-0.5)*12, life: 1.0, color: '#fbbf24' });
        } else if (dist < r.radius + r.thickness) { endGame(); return; }
      }
      if (r.x < -150) ringsRef.current.splice(i, 1);
    }

    for (let i = minesRef.current.length - 1; i >= 0; i--) {
      const m = minesRef.current[i];
      m.x -= gameSpeed; m.rotation += 0.05;
      const dx = px - m.x; const dy = py - m.y;
      if (Math.sqrt(dx*dx + dy*dy) < m.radius + 15) { endGame(); return; }
      if (m.x < -150) minesRef.current.splice(i, 1);
    }

    for (let i = opposingRef.current.length - 1; i >= 0; i--) {
      const d = opposingRef.current[i];
      d.x -= gameSpeed * 1.5; d.rotation += 0.1; d.flicker = (d.flicker + 1) % 10;
      const dx = px - d.x; const dy = py - d.y;
      if (Math.sqrt(dx*dx + dy*dy) < d.radius + 15) { endGame(); return; }
      if (d.x < -150) opposingRef.current.splice(i, 1);
    }

    if (plane.y < 0 || plane.y > CANVAS_HEIGHT - 120) { endGame(); return; }

    cloudsRef.current.forEach((c, i) => { c.x -= c.speed; if (c.x < -400) cloudsRef.current.splice(i, 1); });
    particlesRef.current.forEach((p, i) => { p.x += p.vx; p.y += p.vy; p.life -= 0.02; if (p.life <= 0) particlesRef.current.splice(i, 1); });
    trailsRef.current.forEach((p, i) => { p.x += p.vx; p.y += p.vy; p.life -= 0.03; if (p.life <= 0) trailsRef.current.splice(i, 1); });
    visualsRef.current.forEach((v, i) => { v.y -= 1.5; v.life -= 0.02; if (v.life <= 0) visualsRef.current.splice(i, 1); });

    ctx.save();
    if (shakeIntensity.current > 0) {
      ctx.translate((Math.random()-0.5)*shakeIntensity.current, (Math.random()-0.5)*shakeIntensity.current);
    }

    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.fillStyle = '#4db8ff';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    cloudsRef.current.filter(c => c.layer === 'far').forEach(c => {
      ctx.beginPath(); ctx.arc(c.x, c.y, 30 * c.scale, 0, Math.PI * 2); ctx.arc(c.x + 40 * c.scale, c.y - 15 * c.scale, 35 * c.scale, 0, Math.PI * 2); ctx.arc(c.x + 80 * c.scale, c.y, 30 * c.scale, 0, Math.PI * 2); ctx.fill();
    });

    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    cloudsRef.current.filter(c => c.layer === 'mid').forEach(c => {
      ctx.beginPath(); ctx.arc(c.x, c.y, 30 * c.scale, 0, Math.PI * 2); ctx.arc(c.x + 40 * c.scale, c.y - 15 * c.scale, 35 * c.scale, 0, Math.PI * 2); ctx.arc(c.x + 80 * c.scale, c.y, 30 * c.scale, 0, Math.PI * 2); ctx.fill();
    });

    // Realistic Cityscape Logic
    const groundY = CANVAS_HEIGHT - 120;
    const scrollX = groundOffset.current;
    
    cityData.current.forEach(b => {
      let drawX = (b.x - scrollX) % (CANVAS_WIDTH * 2);
      if (drawX < -b.w) drawX += CANVAS_WIDTH * 2;

      ctx.fillStyle = '#1e293b'; 
      ctx.fillRect(drawX, groundY - b.h, b.w, b.h);
      
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.strokeRect(drawX, groundY - b.h, b.w, b.h);

      ctx.fillStyle = '#fef08a';
      b.windows.forEach(w => {
        ctx.fillRect(drawX + w.x, groundY - b.h + w.y, 4, 6);
      });

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(drawX + b.w * 0.2, groundY - b.h - 15, 10, 15);
    });

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, groundY, CANVAS_WIDTH, 120);

    trailsRef.current.forEach(p => {
      ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size || 5, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;

    ringsRef.current.forEach(r => {
      ctx.lineWidth = r.thickness; ctx.strokeStyle = r.passed ? '#4ade80' : '#ffd700'; ctx.beginPath(); ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2); ctx.stroke();
    });

    // --- BOMB (MINE) RENDERER ---
    minesRef.current.forEach(m => {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.rotation);
      
      // Bomb Body
      ctx.fillStyle = '#1c1917'; // Almost black
      ctx.beginPath();
      ctx.arc(0, 0, m.radius, 0, Math.PI * 2);
      ctx.fill();
      
      // Highlight on body
      ctx.fillStyle = '#44403c';
      ctx.beginPath();
      ctx.arc(-m.radius/3, -m.radius/3, m.radius/3, 0, Math.PI * 2);
      ctx.fill();

      // Top Fuse Holder
      ctx.fillStyle = '#44403c';
      ctx.fillRect(-m.radius/4, -m.radius - 5, m.radius/2, 10);
      
      // Fuse
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -m.radius - 5);
      ctx.quadraticCurveTo(10, -m.radius - 15, 5, -m.radius - 25);
      ctx.stroke();

      // Spark
      const sparkSize = 4 + Math.sin(Date.now() * 0.02) * 2;
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(5, -m.radius - 25, sparkSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.arc(5, -m.radius - 25, sparkSize * 0.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    });

    // --- DRONE RENDERER (SHORT/SLEEK) ---
    opposingRef.current.forEach(d => {
      ctx.save();
      ctx.translate(d.x, d.y);
      
      // Sleek Horizontal Body
      ctx.fillStyle = '#334155';
      // Main body is wider than it is tall
      ctx.fillRect(-d.radius * 1.2, -d.radius/4, d.radius * 2.4, d.radius/2);
      
      // Central Lens/Eye
      ctx.fillStyle = d.flicker > 5 ? '#f87171' : '#ef4444';
      ctx.beginPath();
      ctx.arc(0, 0, d.radius/3, 0, Math.PI * 2);
      ctx.fill();
      
      // Rotors
      const rotorSize = d.radius * 0.45;
      ctx.fillStyle = '#1e293b';
      // 4 rotors at the ends of thin arms
      [[-d.radius * 1.0, -d.radius * 0.3], [d.radius * 1.0, -d.radius * 0.3], [-d.radius * 1.0, d.radius * 0.3], [d.radius * 1.0, d.radius * 0.3]].forEach(pos => {
        // Rotor Hub
        ctx.beginPath();
        ctx.arc(pos[0], pos[1], rotorSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Spinning Blades
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.35;
        const bladeRot = d.rotation * 10;
        ctx.beginPath();
        ctx.moveTo(pos[0] + Math.cos(bladeRot) * (rotorSize-1), pos[1] + Math.sin(bladeRot) * (rotorSize-1));
        ctx.lineTo(pos[0] - Math.cos(bladeRot) * (rotorSize-1), pos[1] - Math.sin(bladeRot) * (rotorSize-1));
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      
      ctx.restore();
    });

    visualsRef.current.forEach(v => {
      ctx.fillStyle = `rgba(255, 255, 255, ${v.life})`; ctx.font = 'bold 32px "Poppins"'; ctx.textAlign = 'center'; ctx.fillText(v.text, v.x, v.y);
    });

    ctx.save();
    ctx.translate(150, plane.y);
    ctx.rotate(plane.angle);
    ctx.fillStyle = "white";
    ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(-40, -15); ctx.lineTo(-40, 15); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-40, 0); ctx.lineTo(-55, -20); ctx.lineTo(-55, 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#cbd5e1"; ctx.fillRect(-15, -45, 12, 90);
    ctx.restore();

    ctx.restore();

    frameId.current = requestAnimationFrame(update);
  }, [gameState, endGame, gameSpeed, score]);

  useEffect(() => {
    frameId.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId.current);
  }, [update]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-sky-400">
      <canvas ref={canvasRef} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="block w-full h-full cursor-none" />

      {/* HUD */}
      {gameState !== GameState.START && (
        <div className="absolute top-0 left-0 w-full p-8 flex flex-col items-start gap-2 pointer-events-none">
          <div className="flex items-center gap-4">
            <div className={`text-6xl font-black drop-shadow-xl transition-all duration-300 ${isFlashing ? 'text-yellow-400 scale-110' : 'text-white'}`}>
              {score}
            </div>
          </div>
          {isFlashing && <div className="text-sm font-bold animate-pulse text-yellow-400 mt-1 uppercase tracking-widest">Speed Increase!</div>}
        </div>
      )}

      {/* START SCREEN */}
      {gameState === GameState.START && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white pointer-events-none px-4">
          <h1 className="text-8xl font-black mb-4 drop-shadow-2xl animate-bounce">RING PILOT</h1>
          <p className="text-2xl mb-12 drop-shadow-md font-medium max-w-lg">
            Fly through the <span className="text-yellow-400 font-bold">GOLD RINGS</span>. Avoid <span className="text-red-500 font-bold">BOMBS</span> and sleek <span className="text-slate-800 font-bold">DRONES</span>!
          </p>
          <button onClick={startGame} className="pointer-events-auto px-12 py-5 bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-black rounded-full text-3xl transition-all transform hover:scale-110 active:scale-95 shadow-2xl border-b-8 border-yellow-600">
            LAUNCH MISSION
          </button>
        </div>
      )}

      {/* GAME OVER SCREEN */}
      {gameState === GameState.GAMEOVER && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm transition-all duration-700">
          <div className="bg-white/10 p-12 rounded-3xl border border-white/20 shadow-2xl flex flex-col items-center max-w-lg w-full">
            <h2 className="text-6xl font-black text-red-500 mb-2 drop-shadow-lg text-center leading-none">FLIGHT TERMINATED</h2>
            <div className="text-white text-2xl mb-8 tracking-widest font-bold">CRASH REPORT</div>
            <div className="text-sm text-sky-100 uppercase font-bold tracking-widest mb-1">Mission Score</div>
            <div className="text-8xl font-black text-yellow-400 mb-6 drop-shadow-lg">{score}</div>
            <div className="w-full h-px bg-white/20 my-6"></div>
            <div className="text-center italic text-white text-lg px-4 mb-10 leading-relaxed min-h-[60px]">
              {loadingAi ? <div className="flex items-center justify-center space-x-2 animate-pulse"><div className="w-3 h-3 bg-white rounded-full"></div><div className="w-3 h-3 bg-white rounded-full"></div><div className="w-3 h-3 bg-white rounded-full"></div></div> : <span>"{aiReport || "Radar signal lost. Pilot missing in action."}"</span>}
            </div>
            <button onClick={startGame} className="px-14 py-6 bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-black rounded-full text-2xl transition-all transform hover:scale-105 active:scale-95 shadow-xl border-b-8 border-yellow-600">
              RETRY MISSION
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
