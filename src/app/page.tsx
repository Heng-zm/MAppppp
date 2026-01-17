'use client';

// ==========================================
// 1. IMPORTS
// ==========================================
import React, { useRef, useEffect, useState, useCallback, memo, useMemo } from 'react';
import mapboxgl, { GeolocateControl, Marker, LngLatBounds, Map as MapboxMap, GeoJSONSource, MapMouseEvent } from 'mapbox-gl';
import { Kantumruy_Pro } from 'next/font/google';
import { createClient } from '@supabase/supabase-js'; 
import { QRCodeSVG } from 'qrcode.react'; 
import 'mapbox-gl/dist/mapbox-gl.css';

// AI & TensorFlow
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

// UI Components
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel
} from "@/components/ui/dropdown-menu";

// Icons
import {
  X, MapPin, Navigation, LocateFixed, Volume2, VolumeX, Compass, Loader2, AlertTriangle,
  Fuel, Utensils, Coffee, Search, Mic, Layers, Zap, CornerUpLeft, CornerUpRight, ArrowUp,
  Sun, Cloud, CloudRain, CloudLightning, Snowflake, Wind, ArrowRight, Clock, History, 
  Navigation as NavIcon, Crosshair, Banknote, ChevronDown, ChevronUp, 
  Trash2, Map as MapIcon, CarFront, ExternalLink, Camera, 
  Mountain, Shield, Copy, Siren, Construction, 
  Video, Users, LogOut, Radio, Satellite,
  Briefcase, Home, Stethoscope, Sparkles, CheckCircle2, ChevronRight, BatteryCharging, Mic2,
  Gauge, Activity, Target, ChevronLeft, ChevronRight as ChevronRightIcon, Menu, Smartphone, RefreshCw
} from 'lucide-react';

// ==========================================
// 2. CONFIG & HELPERS
// ==========================================

interface ArLastMileViewProps { 
    userLocation: [number, number]; 
    destination: [number, number]; 
    routePath?: number[][]; 
    onClose: () => void; 
    hasParentPermission: boolean; 
    setParentPermission: (val: boolean) => void; 
}

const kantumruy = Kantumruy_Pro({
  subsets: ['khmer', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const WEATHER_API_KEY = process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY;
const GEOAPIFY_API_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (MAPBOX_TOKEN) {
    mapboxgl.accessToken = MAPBOX_TOKEN;
    try {
        // @ts-ignore
        if (mapboxgl.config) mapboxgl.config.DISABLE_TELEMETRY = true;
    } catch (e) {}
}

const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const DEFAULT_CENTER: [number, number] = [104.9282, 11.5564]; // Phnom Penh
const DEFAULT_ZOOM = 15;
const WEATHER_REFRESH_RATE = 15 * 60 * 1000;
const REROUTE_THRESHOLD_METERS = 50;
const REROUTE_COOLDOWN_MS = 5000;
const AR_PERMISSION_KEY = "map_ar_permission_v1";
const ARRIVAL_THRESHOLD_METERS = 30;
const IDLE_TIMEOUT_MS = 30000; // 30s for Battery Saver

const FUEL_STATS: any = { moto: 2.5, car: 10, suv: 14 };
const GAS_PRICE_KHR = 4500;

const STYLES = {
  DARK: 'mapbox://styles/mapbox/dark-v11',
  LIGHT: 'mapbox://styles/mapbox/streets-v12',
  SATELLITE: 'mapbox://styles/mapbox/satellite-streets-v12',
  OUTDOORS: 'mapbox://styles/mapbox/outdoors-v12'
};

const KHMER_SEARCH_ALIASES: Record<string, string> = {
    'ហាងកាហ្វេ': 'coffee shop', 'កាហ្វេ': 'coffee', 'ហាងបាយ': 'restaurant',
    'អាហារ': 'food', 'ភោជនីយដ្ឋាន': 'restaurant', 'គុយទាវ': 'noodle',
    'ធនាគារ': 'bank', 'អេធីអឹម': 'atm', 'លុយ': 'financial',
    'ពេទ្យ': 'hospital', 'មន្ទីរពេទ្យ': 'hospital', 'គ្លីនិក': 'clinic', 'ឱសថស្ថាន': 'pharmacy',
    'សាំង': 'gas station', 'ប្រេង': 'gas station', 'ស្ថានីយ៍ប្រេង': 'gas station',
    'ការាស': 'garage', 'ផ្ញើឡាន': 'parking',
    'សាលា': 'school', 'សកលវិទ្យាល័យ': 'university', 'វត្ត': 'pagoda',
    'ផ្សារ': 'market', 'ផ្សារទំនើប': 'mall', 'ម៉ាត': 'convenience store',
    'សណ្ឋាគារ': 'hotel', 'ផ្ទះសំណាក់': 'guesthouse', 'បុរី': 'borey',
};

const isCoordinate = (query: string) => /^(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)$/.test(query.trim());

// --- MATH & UTILS ---
function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; const dLat = (lat2 - lat1) * (Math.PI / 180); const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); return (R * c) * 1000;
}
function getBearing(startLat: number, startLng: number, destLat: number, destLng: number) {
  const startLatRad = startLat * (Math.PI / 180); const startLngRad = startLng * (Math.PI / 180); const destLatRad = destLat * (Math.PI / 180); const destLngRad = destLng * (Math.PI / 180);
  const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
  const x = Math.cos(startLatRad) * Math.sin(destLatRad) - Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);
  const brng = Math.atan2(y, x); return ((brng * 180 / Math.PI) + 360) % 360;
}

function lerpAngle(start: number, end: number, amount: number) {
    let difference = Math.abs(end - start);
    if (difference > 180) {
        if (end > start) start += 360; else end += 360;
    }
    const value = (start + ((end - start) * amount));
    return ((value % 360) + 360) % 360;
}

// Robust Low-Pass Filter for Compass Smoothing
function smoothAngle(current: number, target: number, factor: number) {
    let delta = target - current;
    while (delta <= -180) delta += 360;
    while (delta > 180) delta -= 360;
    if (Math.abs(delta) < 0.1) return current; // Deadzone for jitter
    return current + delta * factor;
}

function getMinDistanceToRoute(userLat: number, userLng: number, routeCoords: number[][]) { if (!routeCoords.length) return Infinity; let minDistance = Infinity; const step = Math.max(1, Math.ceil(routeCoords.length / 50)); for (let i = 0; i < routeCoords.length; i += step) { const dist = getDistanceFromLatLonInMeters(userLat, userLng, routeCoords[i][1], routeCoords[i][0]); if (dist < minDistance) minDistance = dist; if (minDistance < 10) return minDistance; } return minDistance; }
const lerp = (start: number, end: number, amt: number) => (1 - amt) * start + amt * end;
const formatDistance = (d: number) => d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${d.toFixed(0)} m`;
const formatDuration = (s: number) => { if (s < 0) s = 0; const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`; };
const simplifyGeometry = (coordinates: number[][]) => { if (!coordinates || coordinates.length === 0) return ""; const step = Math.max(1, Math.floor(coordinates.length / 80)); const simplified = coordinates.filter((_, i) => i % step === 0 || i === coordinates.length - 1); return `line_string:${simplified.map(c => `${c[0]},${c[1]}`).join(',')}`; };
const HighlightMatch = ({ text, match }: { text: string, match: string }) => { if (!match || !text) return <span>{text}</span>; const parts = text.split(new RegExp(`(${match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')); return <span>{parts.map((part, i) => part.toLowerCase() === match.toLowerCase() ? <span key={i} className="text-indigo-400 font-bold">{part}</span> : part)}</span>; };
const triggerHaptic = () => { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(10); };

type SearchResult = { lng: number, lat: number, name: string, type: string, address: string };
const mapFeaturesToResults = (features: any[]): SearchResult[] => features.map((f: any) => { const name = f.text_km || f.text_en || f.text; let rawAddress = (f.properties?.address || f.place_name_km || f.place_name || "").toString(); if (rawAddress.startsWith(name)) rawAddress = rawAddress.substring(name.length).replace(/^,\s*/, "").trim(); const cleanAddress = rawAddress.replace(/,\s*Cambodia/i, "").replace(/,\s*កម្ពុជា/i, "").replace(/,\s*Phnom Penh/i, "").trim().replace(/^,\s*/, ""); return { lng: f.center[0], lat: f.center[1], name: name, address: cleanAddress || "ទីតាំងផែនទី", type: f.properties?.category || f.place_type[0] || "general" } });
const getWeatherIcon = (condition: string) => { const c = condition.toLowerCase(); if (c.includes('rain') || c.includes('drizzle')) return <CloudRain className="h-5 w-5 text-blue-400" />; if (c.includes('thunder')) return <CloudLightning className="h-5 w-5 text-yellow-400" />; if (c.includes('snow')) return <Snowflake className="h-5 w-5 text-white" />; if (c.includes('cloud')) return <Cloud className="h-5 w-5 text-gray-400" />; if (c.includes('clear') || c.includes('sun')) return <Sun className="h-5 w-5 text-orange-400" />; return <Wind className="h-5 w-5 text-zinc-400" />; };
const ManeuverIcon = memo(({ instruction }: { instruction: string }) => { const text = instruction.toLowerCase(); const iconClass = "h-8 w-8 text-white"; if (text.includes('left')) return <CornerUpLeft className={iconClass} />; if (text.includes('right')) return <CornerUpRight className={iconClass} />; if (text.includes('straight') || text.includes('continue')) return <ArrowUp className={iconClass} />; if (text.includes('uturn')) return <Zap className={iconClass} />; return <NavIcon className={iconClass} />; });
ManeuverIcon.displayName = 'ManeuverIcon';

type WeatherData = { temp: number; condition: string; description: string };
type RouteDetails = { distance: number; duration: number; instruction: string; arrivalTime: string; totalDistance: number; initialTotalDistance?: number };
type Incident = { id: number, type: 'police' | 'traffic' | 'accident' | 'pothole', lat: number, lng: number };
type ConvoyMember = { user_id: string, lat: number, lng: number, heading: number, speed: number, last_updated: string };

// ==========================================
// 3. HYPER-THREADED AI DASHCAM (TTC LOGIC)
// ==========================================
const AiDashcam = ({ onClose, onDetect }: { onClose: () => void, onDetect: (type: string) => void }) => {
    // ... (Dashcam logic kept optimized)
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
    const [dangerLevel, setDangerLevel] = useState<0 | 1 | 2>(0); 
    const lastSpeakTime = useRef<number>(0);
    const lastDetectTime = useRef<number>(0);
    const previousBoxes = useRef<Map<string, { w: number, h: number, time: number }>>(new Map());
    const isActive = useRef(true);

    const speakAlert = (text: string) => {
        const now = Date.now();
        if (now - lastSpeakTime.current > 3500) { 
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 1.4;
            u.pitch = 1.2;
            window.speechSynthesis.speak(u);
            lastSpeakTime.current = now;
        }
    };

    useEffect(() => {
        isActive.current = true;
        tf.ready().then(() => cocoSsd.load({ base: 'lite_mobilenet_v2' }).then(m => { if(isActive.current) setModel(m); }));
        return () => { isActive.current = false; setModel(null); }
    }, []);

    useEffect(() => {
        let stream: MediaStream | null = null;
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
            .then(s => { stream = s; if (videoRef.current && isActive.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(()=>{}); } })
            .catch(e => console.error(e));
        return () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
    }, []);

    const takeSnapshot = () => {
        if (!canvasRef.current || !videoRef.current) return;
        try {
            triggerHaptic();
            const link = document.createElement('a');
            link.download = `dashcam-${Date.now()}.png`;
            link.href = canvasRef.current.toDataURL();
            link.click();
            onDetect('snapshot'); 
        } catch(e) {}
    };

    useEffect(() => {
        if (!model || !videoRef.current || !canvasRef.current) return;
        let animationId: number;

        const renderFrame = async () => {
            if (!isActive.current) return;
            const ctx = canvasRef.current!.getContext('2d');
            if (ctx && videoRef.current && videoRef.current.readyState === 4) {
                const vid = videoRef.current;
                const cw = ctx.canvas.width;
                const ch = ctx.canvas.height;
                ctx.clearRect(0, 0, cw, ch);
                ctx.drawImage(vid, 0, 0, cw, ch);

                ctx.strokeStyle = "rgba(0, 255, 255, 0.2)";
                ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(cw * 0.1, ch); ctx.lineTo(cw * 0.45, ch * 0.55); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(cw * 0.9, ch); ctx.lineTo(cw * 0.55, ch * 0.55); ctx.stroke();

                const now = Date.now();
                if (now - lastDetectTime.current > 100) { 
                    lastDetectTime.current = now;
                    try {
                        const predictions = await model.detect(vid);
                        if (!isActive.current) return;
                        let maxDanger = 0;

                        predictions.forEach((p, idx) => {
                            if (['car', 'truck', 'bus', 'person', 'motorcycle'].includes(p.class)) {
                                const [x, y, w, h] = p.bbox;
                                const area = w * h;
                                const id = `${p.class}-${idx}`;
                                
                                let expandingRate = 0;
                                const prev = previousBoxes.current.get(id);
                                if (prev) {
                                    const areaDiff = area - (prev.w * prev.h);
                                    if (areaDiff > 0) expandingRate = areaDiff; 
                                }
                                previousBoxes.current.set(id, { w, h, time: now });

                                const isCentered = x + w/2 > cw * 0.3 && x + w/2 < cw * 0.7;
                                const isClose = area > (cw * ch) * 0.25;
                                const isRapidlyApproaching = expandingRate > 3000; 

                                let color = '#10b981'; 
                                
                                if (isRapidlyApproaching && isCentered) {
                                    color = '#ef4444'; 
                                    maxDanger = 2;
                                } else if (isClose && isCentered) {
                                    color = '#eab308'; 
                                    if (maxDanger < 1) maxDanger = 1;
                                }

                                ctx.lineWidth = maxDanger === 2 ? 4 : 2;
                                ctx.strokeStyle = color;
                                ctx.strokeRect(x, y, w, h);
                                ctx.fillStyle = color;
                                ctx.fillText(`${p.class} ${isRapidlyApproaching ? '!!!' : ''}`, x, y > 10 ? y - 5 : 10);
                            }
                        });

                        if (previousBoxes.current.size > 20) previousBoxes.current.clear();

                        setDangerLevel(maxDanger as any);
                        if (maxDanger === 2) { speakAlert("Caution!"); onDetect('traffic_danger'); }

                    } catch(e) {}
                }
            }
            animationId = requestAnimationFrame(renderFrame);
        };
        renderFrame();
        return () => cancelAnimationFrame(animationId);
    }, [model, onDetect]);

    return (
        <div className={`fixed top-4 right-4 bg-zinc-950 rounded-2xl overflow-hidden shadow-2xl z-[50] border-2 transition-all duration-300 animate-in slide-in-from-right-4 ${dangerLevel === 2 ? 'border-red-500 shadow-red-900/50 scale-105' : 'border-zinc-800'}`} style={{ top: 'max(1rem, env(safe-area-inset-top))', width: '180px', height: '240px' }}>
            <video ref={videoRef} className="absolute opacity-0 pointer-events-none" muted playsInline />
            <canvas ref={canvasRef} width={320} height={480} className="absolute inset-0 w-full h-full object-cover" />
            
            <div className="absolute inset-0 flex flex-col justify-between p-3 pointer-events-none">
                <div className="flex justify-between items-start">
                    <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2 py-1 rounded-md border border-white/10">
                        <div className={`w-2 h-2 rounded-full ${dangerLevel === 2 ? 'bg-red-500 animate-ping' : 'bg-green-500 animate-pulse'}`}></div>
                        <span className="text-[10px] font-mono font-bold text-white tracking-wider">AI.REC</span>
                    </div>
                    <button onClick={onClose} className="pointer-events-auto bg-black/50 hover:bg-red-500/50 text-white rounded-full p-1.5 transition-colors"><X className="h-3.5 w-3.5" /></button>
                </div>

                <div className="space-y-1">
                    {dangerLevel === 2 && (
                        <div className="bg-red-600/90 text-white text-center font-black text-xl py-1 animate-bounce uppercase tracking-widest border-2 border-white rounded-lg shadow-lg">BRAKE!</div>
                    )}
                    <div className="flex justify-between items-end">
                        <div className="text-[8px] font-mono text-zinc-400">FPS: 60</div>
                        <button onClick={takeSnapshot} className="pointer-events-auto p-2 bg-white/10 hover:bg-white/30 backdrop-blur-md rounded-full border border-white/20 active:scale-95 transition-all"><Camera className="h-4 w-4 text-white" /></button>
                    </div>
                </div>
            </div>
            <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px] opacity-20"></div>
        </div>
    );
};

// ==========================================
// 4. AR COMPONENT (SMART ENGINE V4)
// ==========================================
const ArLastMileView = ({ userLocation, destination, routePath, onClose, hasParentPermission, setParentPermission }: ArLastMileViewProps) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const worldRef = useRef<HTMLDivElement>(null);
    const requestRef = useRef<number>(0);
    const [sensorsActive, setSensorsActive] = useState(false);
    const [permissionGranted, setPermissionGranted] = useState(hasParentPermission);
    const [debugMsg, setDebugMsg] = useState("");
    const [perspective, setPerspective] = useState("800px");
    const [currentCompassHeading, setCurrentCompassHeading] = useState(0);
    const [calibrationOffset, setCalibrationOffset] = useState(0);
    
    // Sensor fusion refs
    const sensorData = useRef({ alpha: 0, beta: 90, smoothAlpha: 0, smoothBeta: 90 });

    useEffect(() => {
        if (typeof window !== 'undefined') setPerspective(`${window.innerHeight}px`);
    }, []);

    const visiblePathSegments = useMemo(() => {
        if (!routePath || routePath.length === 0) return [];
        const segments: { x: number; z: number; dist: number; index: number }[] = [];
        const step = 3; 
        let count = 0;
        
        for (let i = 0; i < routePath.length; i += step) {
            const pt = routePath[i];
            const dist = getDistanceFromLatLonInMeters(userLocation[1], userLocation[0], pt[1], pt[0]);
            if (dist < 200 && count < 40) { 
                const bearing = getBearing(userLocation[1], userLocation[0], pt[1], pt[0]);
                const rad = bearing * (Math.PI / 180);
                segments.push({ x: dist * Math.sin(rad), z: -(dist * Math.cos(rad)), dist: dist, index: i });
                count++;
            }
        }
        return segments.sort((a, b) => b.dist - a.dist);
    }, [routePath, userLocation]);

    const destStats = useMemo(() => {
        const dist = getDistanceFromLatLonInMeters(userLocation[1], userLocation[0], destination[1], destination[0]);
        const bearing = getBearing(userLocation[1], userLocation[0], destination[1], destination[0]);
        const rad = bearing * (Math.PI / 180);
        return { x: dist * Math.sin(rad), z: -(dist * Math.cos(rad)), dist, bearing };
    }, [userLocation, destination]);

    const handleOrientation = useCallback((e: DeviceOrientationEvent) => {
        let heading = 0;
        // iOS Compass
        // @ts-ignore
        if ((e as any).webkitCompassHeading) { 
            // @ts-ignore
            heading = (e as any).webkitCompassHeading;
        } 
        // Android Absolute
        else if (e.absolute && e.alpha !== null) { 
            heading = 360 - e.alpha; 
        }
        // Fallback
        else if (e.alpha !== null) {
            heading = 360 - e.alpha; 
        }

        // Weighted buffer for alpha (heading)
        sensorData.current.alpha = heading;
        
        // Beta is front-back tilt. We clamp it for safety.
        if (e.beta !== null) {
            sensorData.current.beta = Math.max(0, Math.min(180, e.beta));
        }

        if (!sensorsActive && heading !== 0) setSensorsActive(true);
    }, [sensorsActive]);

    useEffect(() => {
        let stream: MediaStream | null = null;
        
        const startCamera = async () => {
            const constraintsOptions = [
                { video: { facingMode: { exact: "environment" }, width: { ideal: 1280 } } },
                { video: { facingMode: "environment" } },
                { video: true }
            ];

            for (const constraints of constraintsOptions) {
                try {
                    stream = await navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints);
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                        setDebugMsg("");
                        return; // Success
                    }
                } catch (e) {
                    console.log("Cam constraint failed", e);
                }
            }
            setDebugMsg("Camera access denied or unavailable.");
        };

        if (permissionGranted) {
            startCamera();
            window.addEventListener('deviceorientation', handleOrientation);
            // @ts-ignore
            window.addEventListener('deviceorientationabsolute', handleOrientation);
        }

        return () => {
            window.removeEventListener('deviceorientation', handleOrientation);
            // @ts-ignore
            window.removeEventListener('deviceorientationabsolute', handleOrientation);
            if (stream) stream.getTracks().forEach(t => t.stop());
            cancelAnimationFrame(requestRef.current);
        };
    }, [permissionGranted, handleOrientation]);

    useEffect(() => {
        if (!permissionGranted) return;
        
        const updateLoop = () => {
            const data = sensorData.current;
            
            // 1. Heading Smoothing (Strong exponential moving average)
            const adjustedAlpha = (data.alpha + calibrationOffset) % 360;
            // Lower factor = smoother but slower. 0.08 is a good balance.
            data.smoothAlpha = smoothAngle(data.smoothAlpha, adjustedAlpha, 0.08); 
            setCurrentCompassHeading(Math.round(data.smoothAlpha));

            // 2. Horizon Locking (Beta Smoothing)
            data.smoothBeta = data.smoothBeta * 0.9 + data.beta * 0.1;
            // 90deg is upright (0 shift). <90 tilts back, >90 tilts forward.
            // Approx 15px shift per degree of tilt maintains horizon.
            const horizonShift = (data.smoothBeta - 90) * 15; 
            
            if (worldRef.current) {
                // Combine rotation and vertical shift
                worldRef.current.style.transform = `translateY(${horizonShift}px) translateZ(600px) rotateY(${-data.smoothAlpha}deg)`;
            }
            
            requestRef.current = requestAnimationFrame(updateLoop);
        };
        
        requestRef.current = requestAnimationFrame(updateLoop);
        return () => cancelAnimationFrame(requestRef.current);
    }, [permissionGranted, calibrationOffset]);

    const requestAccess = async () => {
        // @ts-ignore
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                // @ts-ignore
                const perm = await DeviceOrientationEvent.requestPermission();
                if (perm === 'granted') {
                    setPermissionGranted(true);
                    setParentPermission(true);
                    window.location.reload(); 
                } else { alert("Permission denied. AR requires compass access."); }
            } catch (e) { console.error(e); }
        } else {
            setPermissionGranted(true);
            setParentPermission(true);
        }
    };

    const compassShift = (currentCompassHeading % 360) * 4; 

    return (
        <div className="fixed inset-0 z-[60] bg-black overflow-hidden perspective-container">
            <style jsx>{`
                .perspective-container { perspective: ${perspective}; perspective-origin: 50% 50%; }
                .world-3d { position: absolute; top: 50%; left: 50%; width: 0; height: 0; transform-style: preserve-3d; will-change: transform; }
                .ar-chevron { position: absolute; width: 60px; height: 30px; border-bottom: 6px solid rgba(16, 185, 129, 0.9); border-left: 6px solid transparent; border-right: 6px solid transparent; transform-origin: center bottom; transform: translate(-50%, -100%); box-shadow: 0 0 15px rgba(16, 185, 129, 0.6); filter: drop-shadow(0 0 5px #10b981); }
                .dest-pin { position: absolute; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%); }
                .pin-head { width: 40px; height: 40px; background: #ef4444; border: 3px solid white; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); box-shadow: 0 0 20px rgba(239, 68, 68, 0.8); display: flex; align-items: center; justify-content: center; }
                .pin-icon { transform: rotate(45deg); }
                .pin-stick { width: 4px; height: 40px; background: white; margin-top: -10px; box-shadow: 0 0 10px white; }
                .pin-pulse { width: 20px; height: 10px; background: rgba(239,68,68,0.5); border-radius: 50%; animation: pinPulse 1s infinite alternate; filter: blur(4px); }
                @keyframes pinPulse { from { transform: scale(1); opacity: 0.8; } to { transform: scale(2); opacity: 0.2; } }
                .compass-track { width: 1440px; height: 40px; background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent); display: flex; align-items: center; color: white; font-family: monospace; font-weight: bold; font-size: 14px; position: absolute; left: 50%; top: 0; mask-image: linear-gradient(to right, transparent, black 40%, black 60%, transparent); }
                .tick { width: 4px; height: 10px; background: rgba(255,255,255,0.3); margin-right: 32px; position: relative; }
                .tick.major { height: 20px; background: white; width: 2px; }
                .tick-label { position: absolute; top: 22px; left: -10px; width: 24px; text-align: center; font-size: 12px; text-shadow: 0 0 4px black; }
            `}</style>

            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
            
            {!permissionGranted && (
                <div className="absolute inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm">
                    <div className="text-center p-6 max-w-sm">
                        <Compass className="h-16 w-16 text-indigo-500 mx-auto mb-4 animate-pulse"/>
                        <h3 className="text-white text-xl font-bold mb-2">Enable AR View</h3>
                        <p className="text-zinc-400 mb-6 text-sm">Access to camera & compass is required for the HUD.</p>
                        <Button onClick={requestAccess} className="bg-indigo-600 hover:bg-indigo-700 text-white w-full rounded-xl h-12">Start Camera</Button>
                        <Button variant="ghost" onClick={onClose} className="mt-4 text-zinc-400 w-full">Cancel</Button>
                    </div>
                </div>
            )}

            {permissionGranted && (
                <>
                <div className="absolute inset-0 pointer-events-none z-[61]">
                    {/* Compass Strip */}
                    <div className="absolute top-8 left-0 right-0 h-16 overflow-hidden flex justify-center items-start">
                        <div className="compass-track" style={{ transform: `translateX(-50%) translateX(${-compassShift}px)` }}>
                            {Array.from({ length: 36 }).map((_, i) => {
                                const deg = i * 10;
                                let label = "";
                                if (deg === 0) label = "N"; else if (deg === 90) label = "E"; else if (deg === 180) label = "S"; else if (deg === 270) label = "W";
                                return ( <div key={i} className={`tick ${label ? 'major' : ''}`}>{label && <span className="tick-label text-emerald-400">{label}</span>}</div> );
                            })}
                        </div>
                        <div className="absolute top-0 w-0.5 h-8 bg-red-500 shadow-[0_0_10px_red]"></div>
                    </div>

                    {/* Calibration Control */}
                    <div className="absolute top-24 right-4 pointer-events-auto flex flex-col gap-2">
                        <Button size="icon" className="h-8 w-8 rounded-full bg-black/40 text-white border border-white/10" onClick={() => setCalibrationOffset(p => p + 5)}><RefreshCw className="h-3 w-3" /></Button>
                    </div>

                    {/* Target Reticle */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                        <div className="w-16 h-16 border border-white/20 rounded-full flex items-center justify-center"><div className="w-1 h-1 bg-emerald-400 rounded-full"></div></div>
                        <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-emerald-500/50"></div>
                        <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-emerald-500/50"></div>
                    </div>

                    {/* HUD Stats */}
                    <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md border border-emerald-500/30 p-3 rounded-lg text-emerald-400 font-mono text-xs shadow-lg space-y-1">
                        <div className="flex items-center gap-2"><Target className="h-3 w-3" /> <span>DST: {Math.round(destStats.dist)}m</span></div>
                        <div className="flex items-center gap-2"><Compass className="h-3 w-3" /> <span>HDG: {Math.round(currentCompassHeading)}°</span></div>
                    </div>

                    {/* Off-screen Guidance */}
                    {Math.abs(destStats.bearing - currentCompassHeading) > 40 && (
                        <div className={`absolute top-1/2 -translate-y-1/2 ${destStats.bearing - currentCompassHeading > 0 ? 'right-4' : 'left-4'} animate-pulse`}>
                            {destStats.bearing - currentCompassHeading > 0 ? <ChevronRightIcon className="h-12 w-12 text-red-500 drop-shadow-[0_0_10px_rgba(255,0,0,0.8)]" /> : <ChevronLeft className="h-12 w-12 text-red-500 drop-shadow-[0_0_10px_rgba(255,0,0,0.8)]" />}
                        </div>
                    )}
                </div>

                <div ref={worldRef} className="world-3d">
                    {visiblePathSegments.map((seg, i) => {
                        const opacity = Math.max(0.1, 1 - (seg.dist / 150)); 
                        const PIXEL_PER_METER = 35;
                        return ( <div key={`seg-${i}`} className="ar-chevron" style={{ transform: `translateX(${seg.x * PIXEL_PER_METER}px) translateY(150px) translateZ(${seg.z * PIXEL_PER_METER}px)`, opacity: opacity, borderColor: `rgba(16, 185, 129, ${opacity})` }}></div> )
                    })}
                    
                    <div className="dest-pin" style={{ transform: `translateX(${destStats.x * 35}px) translateY(120px) translateZ(${destStats.z * 35}px)` }}>
                        <div className="bg-red-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded mb-1 whitespace-nowrap border border-red-400">{formatDistance(destStats.dist)}</div>
                        <div className="pin-head"><MapPin className="h-5 w-5 text-white pin-icon" fill="currentColor" /></div>
                        <div className="pin-stick"></div>
                        <div className="pin-pulse"></div>
                    </div>
                </div>

                <div className="absolute top-4 right-4 z-[62]">
                    <Button onClick={onClose} size="icon" className="rounded-full bg-red-500/80 backdrop-blur text-white border border-white/20 h-10 w-10 shadow-xl"><X className="h-5 w-5" /></Button>
                </div>

                {/* Radar Map */}
                <div className="absolute bottom-6 left-6 z-[62]" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
                    <div className="w-28 h-28 rounded-full bg-black/70 backdrop-blur border-2 border-emerald-500/50 relative overflow-hidden shadow-[0_0_20px_rgba(16,185,129,0.2)]">
                        <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,rgba(16,185,129,0.1)_360deg)] animate-spin-slow opacity-50"></div>
                        <div className="absolute top-1/2 left-1/2 w-3 h-3 bg-blue-500 rounded-full transform -translate-x-1/2 -translate-y-1/2 border-2 border-white z-10 shadow-lg"></div>
                        <div className="absolute top-1/2 left-1/2 w-0 h-0 border-l-[40px] border-l-transparent border-r-[40px] border-r-transparent border-t-[60px] border-t-emerald-500/10 transform -translate-x-1/2 -translate-y-full origin-bottom"></div>
                        {visiblePathSegments.map((seg, i) => {
                            const scale = 0.5; const cx = 56 + (seg.x * scale); const cy = 56 - (Math.abs(seg.z) * scale);
                            if (cx < 0 || cx > 112 || cy < 0 || cy > 112) return null;
                            return <div key={`r-${i}`} className="absolute w-1.5 h-1.5 bg-emerald-400 rounded-full shadow-[0_0_4px_#34d399]" style={{ left: cx, top: cy }}></div>
                        })}
                    </div>
                </div>
                
                {debugMsg && <div className="absolute bottom-20 left-0 right-0 text-center text-red-400 text-xs bg-black/50 p-1">{debugMsg}</div>}
                
                {!sensorsActive && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 text-white px-6 py-4 rounded-xl text-center pointer-events-none animate-pulse z-[70]">
                        <div className="text-4xl mb-2 flex justify-center"><Smartphone className="h-10 w-10 animate-bounce" /></div>
                        <p className="font-bold">Move phone in Figure 8</p>
                        <p className="text-xs text-zinc-400">Calibrating Compass...</p>
                    </div>
                )}
                </>
            )}
        </div>
    );
};

// ==========================================
// 5. MAIN PAGE (OPTIMIZED)
// ==========================================
export default function MapExplorerPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapboxMap | null>(null);
  const geolocateControl = useRef<GeolocateControl | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const destinationMarker = useRef<Marker | null>(null);
  const puckMarker = useRef<Marker | null>(null);
  const puckElement = useRef<HTMLDivElement | null>(null);
  const searchMarkers = useRef<Marker[]>([]);
  const incidentMarkers = useRef<Marker[]>([]);
  const convoyMarkers = useRef<Record<string, Marker>>({});
  
  const routeGeoJSON = useRef<any>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const userLocation = useRef<[number, number] | null>(null);
  const activeDestination = useRef<[number, number] | null>(null);
  const watchId = useRef<number | null>(null);
  const lastInteractionTime = useRef(Date.now());
  const idleTimer = useRef<NodeJS.Timeout>();
  
  const isRecalculating = useRef<boolean>(false);
  const userIsInteracting = useRef<boolean>(false);
  const isMounted = useRef<boolean>(false);
  const showRecenterBtnRef = useRef(false);
  const lastSpokenInstruction = useRef<string>("");
  const lastWeatherFetchTime = useRef<number>(0);
  const addressAbortController = useRef<AbortController | null>(null);
  const lastRerouteTime = useRef<number>(0);
  const isNavigatingRef = useRef(false);
  const currentSpeedRef = useRef(0);
  const lastSafetyUpdate = useRef<number>(0);
  const hasLoggedSupabaseError = useRef(false);
  const supabaseErrorCount = useRef(0);

  // Sync Refs
  const activeConvoyRef = useRef<string | null>(null);
  const isSafetyModeActiveRef = useRef<boolean>(false);
  const currentTripIdRef = useRef<string | null>(null);
  
  const currentPuckPos = useRef<[number, number]>(DEFAULT_CENTER);
  const targetPuckPos = useRef<[number, number]>(DEFAULT_CENTER);
  const currentHeading = useRef<number>(0);
  const targetHeading = useRef<number>(0);
  const compassHeading = useRef<number>(0);
  const gpsHeading = useRef<number>(0);
  const animationFrameId = useRef<number>(0);

  const { toast } = useToast();
  
  // UI State
  const [isNavigating, setIsNavigating] = useState(false);
  const [isBatterySaver, setIsBatterySaver] = useState(false);
  const [locationDetails, setLocationDetails] = useState<{lng: number, lat: number} | null>(null);
  const [addressDetails, setAddressDetails] = useState<any>(null);
  const [richPlaceDetails, setRichPlaceDetails] = useState<any>(null);
  const [isFetchingAddress, setIsFetchingAddress] = useState(false);
  const [isFetchingRichDetails, setIsFetchingRichDetails] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showRecenterBtn, setShowRecenterBtn] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isTrafficVisible, setIsTrafficVisible] = useState(true);
  const [isRainMode, setIsRainMode] = useState(false);
  const [isWindMode, setIsWindMode] = useState(false);
  const [showAR, setShowAR] = useState(false);
  const [hasArPermission, setHasArPermission] = useState(false);
  const [currentUserLocationForAR, setCurrentUserLocationForAR] = useState<[number, number] | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [routeDetails, setRouteDetails] = useState<RouteDetails | null>(null);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [currentStyle, setCurrentStyle] = useState(STYLES.DARK);
  
  // Advanced Features State
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [vehicleType, setVehicleType] = useState<'moto' | 'car' | 'suv'>('moto');
  const [estimatedCost, setEstimatedCost] = useState<number>(0);
  
  // Convoy & Dashcam
  const [showDashcam, setShowDashcam] = useState(false);
  const [convoyCode, setConvoyCode] = useState("");
  const [activeConvoy, setActiveConvoy] = useState<string | null>(null);
  const [convoyMembers, setConvoyMembers] = useState<ConvoyMember[]>([]);
  const [showConvoyDialog, setShowConvoyDialog] = useState(false);

  // Safety
  const [isSafetyModeActive, setIsSafetyModeActive] = useState(false);
  const [currentTripId, setCurrentTripId] = useState<string | null>(null);
  const [showShareDialog, setShowShareDialog] = useState(false);

  // Refs sync
  useEffect(() => { showRecenterBtnRef.current = showRecenterBtn; }, [showRecenterBtn]);
  useEffect(() => { isNavigatingRef.current = isNavigating; }, [isNavigating]);
  useEffect(() => { currentSpeedRef.current = currentSpeed; }, [currentSpeed]);
  
  useEffect(() => {
    activeConvoyRef.current = activeConvoy;
    isSafetyModeActiveRef.current = isSafetyModeActive;
    currentTripIdRef.current = currentTripId;
  }, [activeConvoy, isSafetyModeActive, currentTripId]);

  // Initial Setup
  useEffect(() => { 
      const saved = localStorage.getItem(AR_PERMISSION_KEY); 
      if (saved === 'true') setHasArPermission(true); 
  }, []);
  
  // Voice Setup
  useEffect(() => { 
      const updateVoices = () => { if (typeof window !== 'undefined' && window.speechSynthesis) { const voices = window.speechSynthesis.getVoices(); if (voices.length > 0) setAvailableVoices(voices); } }; 
      if (typeof window !== 'undefined' && window.speechSynthesis) { window.speechSynthesis.onvoiceschanged = updateVoices; updateVoices(); } 
      return () => { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.onvoiceschanged = null; }; 
  }, []);

  const speak = useCallback((text: string) => { 
      if (typeof window === 'undefined' || isMuted || !window.speechSynthesis) return; 
      if (window.speechSynthesis.speaking && lastSpokenInstruction.current === text) return; 
      window.speechSynthesis.cancel(); 
      utteranceRef.current = new SpeechSynthesisUtterance(text); 
      const preferredVoice = availableVoices.find(v => v.lang.includes('km')) || availableVoices.find(v => v.name.includes('Google') && v.lang.includes('en')); 
      if (preferredVoice) utteranceRef.current.voice = preferredVoice; 
      utteranceRef.current.rate = 1.0; 
      window.speechSynthesis.speak(utteranceRef.current); 
  }, [isMuted, availableVoices]);

  // --- BATTERY SAVER LOGIC (OLED SAVER) ---
  const resetIdleTimer = useCallback(() => {
      lastInteractionTime.current = Date.now();
      if (isBatterySaver) setIsBatterySaver(false);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      // If navigating, screen dims after 30s of no touch
      if (isNavigating) {
          idleTimer.current = setTimeout(() => setIsBatterySaver(true), IDLE_TIMEOUT_MS);
      }
  }, [isNavigating, isBatterySaver]);

  useEffect(() => {
      window.addEventListener('touchstart', resetIdleTimer);
      window.addEventListener('click', resetIdleTimer);
      return () => {
          window.removeEventListener('touchstart', resetIdleTimer);
          window.removeEventListener('click', resetIdleTimer);
      };
  }, [resetIdleTimer]);

  // --- VOICE COMMANDS ---
  const handleVoiceCommand = () => {
      // @ts-ignore
      const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
      recognition.lang = 'en-US';
      recognition.start();
      triggerHaptic();
      recognition.onresult = (event: any) => {
          const cmd = event.results[0][0].transcript.toLowerCase();
          if (cmd.includes('stop')) { setIsNavigating(false); setRouteDetails(null); speak("Navigation stopped"); }
          else if (cmd.includes('traffic')) { toggleLayer('traffic'); speak("Traffic toggled"); }
          else if (cmd.includes('dashcam')) { setShowDashcam(true); speak("Dashcam active"); }
      };
  };

  // --- CORE FUNCTIONS ---
  const fetchIncidents = useCallback(async () => {
    if (!supabase) return;
    try {
        const { data, error } = await supabase.from('incidents').select('*').gt('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()); 
        if (data) { setIncidents(data as Incident[]); }
    } catch (e) {}
  }, []);

  const reportIncident = async (type: string) => {
    triggerHaptic();
    if (!supabase || !userLocation.current) { toast({ title: "Error", description: "GPS required." }); return; }
    const { error } = await supabase.from('incidents').insert({ type, lat: userLocation.current[1], lng: userLocation.current[0] });
    if (error) { toast({ title: "Failed", description: "Backend config error (RLS)", variant: "destructive" }); }
    else { toast({ title: "Reported!", description: "Thank you." }); }
    setShowReportDialog(false);
  };

  useEffect(() => {
    fetchIncidents();
    if (!supabase) return;
    const channel = supabase.channel('incidents_realtime').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incidents' }, (payload) => {
        setIncidents(prev => [...prev, payload.new as Incident]);
    }).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchIncidents]);

  useEffect(() => {
      if (!map.current) return;
      incidentMarkers.current.forEach(m => m.remove());
      incidentMarkers.current = [];
      incidents.forEach(inc => {
          const el = document.createElement('div');
          el.className = 'incident-marker';
          el.innerHTML = `<div class="w-8 h-8 rounded-full border-2 border-white shadow-lg flex items-center justify-center ${inc.type === 'police' ? 'bg-blue-600' : inc.type === 'accident' ? 'bg-red-600' : 'bg-orange-500'} text-white">${inc.type === 'police' ? '👮' : inc.type === 'accident' ? '💥' : '⚠️'}</div>`;
          incidentMarkers.current.push(new Marker({ element: el }).setLngLat([inc.lng, inc.lat]).addTo(map.current!));
      });
  }, [incidents]);

  const joinConvoy = async () => {
      if (!convoyCode || !supabase) return;
      triggerHaptic();
      const { data: existing, error } = await supabase.from('convoys').select('code').eq('code', convoyCode).maybeSingle();
      
      if (!existing && !error) {
          const { error: insertError } = await supabase.from('convoys').insert({ code: convoyCode });
          if(insertError) { toast({ title: "Error", description: "Failed to create convoy", variant: "destructive" }); return; }
      }
      
      const myId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(); 
      localStorage.setItem('convoy_user_id', myId);
      setActiveConvoy(convoyCode);
      setShowConvoyDialog(false);
      toast({ title: "Joined Convoy", description: `Code: ${convoyCode}` });
  };

  const leaveConvoy = async () => {
      triggerHaptic();
      const myId = localStorage.getItem('convoy_user_id');
      if (myId && activeConvoy && supabase) await supabase.from('convoy_members').delete().eq('user_id', myId);
      setActiveConvoy(null);
      setConvoyMembers([]);
      Object.values(convoyMarkers.current).forEach(m => m.remove());
      convoyMarkers.current = {};
      toast({ title: "Left Convoy" });
  };

  useEffect(() => {
      if (!activeConvoy || !supabase) return;
      const channel = supabase.channel(`convoy-${activeConvoy}`).on('postgres_changes', { event: '*', schema: 'public', table: 'convoy_members', filter: `convoy_code=eq.${activeConvoy}` }, 
          () => { supabase.from('convoy_members').select('*').eq('convoy_code', activeConvoy).then(({ data }) => { if (data) setConvoyMembers(data as any); }); }
      ).subscribe();
      return () => { supabase.removeChannel(channel); };
  }, [activeConvoy]);

  useEffect(() => {
      if (!map.current) return;
      const myId = typeof window !== 'undefined' ? localStorage.getItem('convoy_user_id') : null;
      convoyMembers.forEach(member => {
          if (member.user_id === myId) return;
          if (convoyMarkers.current[member.user_id]) {
              const marker = convoyMarkers.current[member.user_id];
              const currentLngLat = marker.getLngLat();
              // LERP Animation for smoother movement
              let start = Date.now();
              const animate = () => {
                  let now = Date.now();
                  let t = Math.min(1, (now - start) / 1000);
                  let newLng = lerp(currentLngLat.lng, member.lng, t);
                  let newLat = lerp(currentLngLat.lat, member.lat, t);
                  marker.setLngLat([newLng, newLat]);
                  if (t < 1) requestAnimationFrame(animate);
              };
              animate();
          } else {
              const el = document.createElement('div');
              el.innerHTML = `<div class="flex flex-col items-center"><div class="bg-indigo-600 text-white text-[10px] font-bold px-1.5 rounded mb-1 shadow">Friend</div><div class="w-8 h-8 bg-indigo-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center">🚗</div></div>`;
              convoyMarkers.current[member.user_id] = new Marker({ element: el }).setLngLat([member.lng, member.lat]).addTo(map.current!);
          }
      });
  }, [convoyMembers]);

  useEffect(() => {
      if (routeDetails?.totalDistance) {
          const liters = (routeDetails.totalDistance / 100000) * FUEL_STATS[vehicleType];
          setEstimatedCost(Math.round(liters * GAS_PRICE_KHR));
      }
  }, [routeDetails, vehicleType]);

  const requestWakeLock = async () => { try { if ('wakeLock' in navigator) wakeLock.current = await navigator.wakeLock.request('screen'); } catch (err) {} };
  const releaseWakeLock = async () => { if(wakeLock.current) { await wakeLock.current.release().catch(() => {}); wakeLock.current = null; } };

  const fetchWeather = useCallback(async (lat: number, lon: number) => {
      const now = Date.now(); if (!WEATHER_API_KEY || (now - lastWeatherFetchTime.current < WEATHER_REFRESH_RATE && weather)) return; lastWeatherFetchTime.current = now;
      try { const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&lang=km&appid=${WEATHER_API_KEY}`); const data = await res.json(); if (data.main && data.weather) setWeather({ temp: Math.round(data.main.temp), condition: data.weather[0].main, description: data.weather[0].description }); } catch (err) {}
  }, [weather]);

  const searchPlaces = async (query: string, center: [number, number], bboxOnly: boolean = false, signal?: AbortSignal) => {
    if (!MAPBOX_TOKEN) return [];
    let searchQuery = query.trim();
    if (isCoordinate(searchQuery)) { const [lat, lng] = searchQuery.split(',').map(n => parseFloat(n.trim())); const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&language=km,en`; try { const res = await fetch(url, { signal }); const data = await res.json(); return mapFeaturesToResults(data.features || []); } catch (e) { return []; } }
    if (KHMER_SEARCH_ALIASES[searchQuery.toLowerCase()]) searchQuery = KHMER_SEARCH_ALIASES[searchQuery.toLowerCase()]; else if (searchQuery.match(/gas|fuel|station|បូមសាំង/i)) searchQuery = "gas station";
    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${MAPBOX_TOKEN}&language=km,en&country=kh&limit=10&fuzzyMatch=true&proximity=${center[0]},${center[1]}&types=poi,address,neighborhood,locality,place`;
    if (bboxOnly) { const radiusKm = 10; const latDelta = radiusKm / 111; const lonDelta = radiusKm / (111 * Math.cos(center[1] * (Math.PI / 180))); url += `&bbox=${center[0] - lonDelta},${center[1] - latDelta},${center[0] + lonDelta},${center[1] + latDelta}`; }
    try { const res = await fetch(url, { signal }); const data = await res.json(); return mapFeaturesToResults(data.features || []); } catch (err) { return []; }
  };

  const restoreMapLayers = useCallback((instance: MapboxMap, currentTraffic: boolean, currentRain: boolean, currentWind: boolean) => {
      if(!instance || !instance.getStyle()) return;
      const layers = instance.getStyle().layers;
      const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;
      if (!instance.getLayer('3d-buildings')) instance.addLayer({ 'id': '3d-buildings', 'source': 'composite', 'source-layer': 'building', 'filter': ['==', 'extrude', 'true'], 'type': 'fill-extrusion', 'minzoom': 14, 'paint': { 'fill-extrusion-color': '#2a2a2e', 'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'height']], 'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'min_height']], 'fill-extrusion-opacity': 0.8 } }, labelLayerId);
      if(!instance.getLayer('sky')) instance.addLayer({ 'id': 'sky', 'type': 'sky', 'paint': { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 0.0], 'sky-atmosphere-sun-intensity': 15 } });
      if (currentTraffic) { if (!instance.getSource('mapbox-traffic')) instance.addSource('mapbox-traffic', { type: 'vector', url: 'mapbox://mapbox.mapbox-traffic-v1' }); if (!instance.getLayer('traffic')) instance.addLayer({ 'id': 'traffic', 'type': 'line', 'source': 'mapbox-traffic', 'source-layer': 'traffic', 'minzoom': 12, 'layout': { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'visible' }, 'paint': { 'line-width': 2.5, 'line-color': ['case', ['==', ['get', 'congestion'], 'low'], '#22c55e', ['==', ['get', 'congestion'], 'moderate'], '#eab308', ['==', ['get', 'congestion'], 'heavy'], '#ef4444', ['==', ['get', 'congestion'], 'severe'], '#7f1d1d', 'rgba(0,0,0,0)'], 'line-opacity': 0.8 } }); }
      if (currentRain && WEATHER_API_KEY) { if (!instance.getSource('rain-source')) instance.addSource('rain-source', { type: 'raster', tiles: [`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${WEATHER_API_KEY}`], tileSize: 256 }); if (!instance.getLayer('rain-layer')) instance.addLayer({ id: 'rain-layer', type: 'raster', source: 'rain-source', paint: { 'raster-opacity': 0.7 }, layout: { visibility: 'visible' } }, labelLayerId); }
      if (currentWind && WEATHER_API_KEY) { if (!instance.getSource('wind-source')) instance.addSource('wind-source', { type: 'raster', tiles: [`https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${WEATHER_API_KEY}`], tileSize: 256 }); if (!instance.getLayer('wind-layer')) instance.addLayer({ id: 'wind-layer', type: 'raster', source: 'wind-source', paint: { 'raster-opacity': 0.6 }, layout: { visibility: 'visible' } }, labelLayerId); }
      if (routeGeoJSON.current) { if (!instance.getSource('custom-route-source')) instance.addSource('custom-route-source', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: routeGeoJSON.current } } }); if (!instance.getLayer('custom-route-casing')) instance.addLayer({ id: 'custom-route-casing', type: 'line', source: 'custom-route-source', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1557b0', 'line-width': [ 'interpolate', ['linear'], ['zoom'], 12, 7, 18, 20 ], 'line-opacity': 0.9 } }, labelLayerId); if (!instance.getLayer('custom-route-core')) instance.addLayer({ id: 'custom-route-core', type: 'line', source: 'custom-route-source', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#4285F4', 'line-width': [ 'interpolate', ['linear'], ['zoom'], 12, 4, 18, 14 ], 'line-opacity': 1 } }, labelLayerId); }
  }, []);

  const drawBlueRoute = useCallback((instance: MapboxMap, geojson: any) => {
      if (!geojson || !geojson.geometry) return;
      const source = instance.getSource('custom-route-source') as GeoJSONSource;
      if (source) source.setData(geojson);
      else { const layers = instance.getStyle().layers; const labelLayerId = layers?.find((layer) => layer.type === 'symbol')?.id; instance.addSource('custom-route-source', { type: 'geojson', data: geojson }); instance.addLayer({ id: 'custom-route-casing', type: 'line', source: 'custom-route-source', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1557b0', 'line-width': [ 'interpolate', ['linear'], ['zoom'], 12, 7, 18, 20 ], 'line-opacity': 0.9 } }, labelLayerId); instance.addLayer({ id: 'custom-route-core', type: 'line', source: 'custom-route-source', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#4285F4', 'line-width': [ 'interpolate', ['linear'], ['zoom'], 12, 4, 18, 14 ], 'line-opacity': 1 } }, labelLayerId); }
  }, []);

  const removeRouteLayers = useCallback((instance: MapboxMap) => { const source = instance?.getSource('custom-route-source') as GeoJSONSource; if (source) source.setData({ type: 'FeatureCollection', features: [] }); }, []);

  const fetchRoute = useCallback(async (start: [number, number], end: [number, number], isSilentRecalc = false): Promise<boolean> => {
      if (!MAPBOX_TOKEN) return false;
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${start[0]},${start[1]};${end[0]},${end[1]}?steps=true&geometries=geojson&language=km&overview=full&access_token=${MAPBOX_TOKEN}`;
      try {
          const res = await fetch(url); const data = await res.json();
          if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) { if(!isSilentRecalc) toast({ title: "កំហុស", description: "រកផ្លូវមិនឃើញ", variant: "destructive" }); return false; }
          const route = data.routes[0]; routeGeoJSON.current = route.geometry.coordinates;
          if (map.current) drawBlueRoute(map.current, { type: 'Feature', properties: {}, geometry: route.geometry });
          const leg = route.legs[0]; const instructionText = (leg.steps[0]?.distance < 30 && leg.steps[1]) ? leg.steps[1].maneuver.instruction : (leg.steps[0]?.maneuver.instruction || "ធ្វើដំណើរតាមផ្លូវ");
          setRouteDetails({ distance: route.distance, duration: route.duration, instruction: instructionText, arrivalTime: new Date(Date.now() + route.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), totalDistance: route.distance, initialTotalDistance: route.distance });
          resetIdleTimer();
          return true;
      } catch (error) { if(!isSilentRecalc) toast({ title: "កំហុសបណ្តាញ", description: "សូមពិនិត្យអ៊ីនធឺណិតរបស់អ្នក", variant: "destructive" }); return false; }
  }, [toast, drawBlueRoute]);

  const fetchRichDetails = async (lat: number, lng: number) => {
    if (!GEOAPIFY_API_KEY) return; setIsFetchingRichDetails(true); setRichPlaceDetails(null);
    try { const url = `https://api.geoapify.com/v2/place-details?lat=${lat}&lon=${lng}&features=details,contact,opening_hours&apiKey=${GEOAPIFY_API_KEY}`; const res = await fetch(url); const data = await res.json(); if (data.features?.length > 0) setRichPlaceDetails(data.features[0].properties); } catch (e) {} finally { setIsFetchingRichDetails(false); }
  };

  const animatePuck = useCallback(() => {
      if (!puckMarker.current || !isMounted.current || !map.current) { animationFrameId.current = 0; return; }
      
      // Interpolate Position
      currentPuckPos.current[0] = lerp(currentPuckPos.current[0], targetPuckPos.current[0], 0.12);
      currentPuckPos.current[1] = lerp(currentPuckPos.current[1], targetPuckPos.current[1], 0.12);
      
      // Smart Interpolate Heading (Smoother and shortest path)
      currentHeading.current = lerpAngle(currentHeading.current, targetHeading.current, 0.08);
      
      puckMarker.current.setLngLat(currentPuckPos.current); 
      puckMarker.current.setRotation(currentHeading.current);
      
      // Smooth Camera Follow
      if (map.current && isNavigatingRef.current && !userIsInteracting.current && !showRecenterBtnRef.current) {
          const speed = currentSpeedRef.current;
          map.current.easeTo({ 
              center: currentPuckPos.current, 
              bearing: currentHeading.current, 
              pitch: speed > 30 ? 60 : 45, 
              zoom: speed > 50 ? 16 : 18, 
              duration: 0, 
              padding: { top: 0, bottom: 200, left: 0, right: 0 } 
          });
      }
      animationFrameId.current = requestAnimationFrame(animatePuck);
  }, []);

  const handleStyleChange = (style: string) => { 
      if (!map.current || style === currentStyle) return; 
      
      // Wait for style load to re-add sources
      map.current.once('style.load', () => { 
          if (map.current) { 
              if(!map.current.getSource('mapbox-dem')) {
                   map.current.addSource('mapbox-dem', { 'type': 'raster-dem', 'url': 'mapbox://mapbox.mapbox-terrain-dem-v1', 'tileSize': 512, 'maxzoom': 14 }); 
              }
              // Catching privacy-blocking errors here
              try {
                  map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 }); 
              } catch (e) { console.warn("Terrain disabled due to browser privacy settings"); }
              
              restoreMapLayers(map.current, isTrafficVisible, isRainMode, isWindMode); 
          } 
      }); 
      map.current.setStyle(style); 
      setCurrentStyle(style); 
  };
  
  const clearSearchMarkers = useCallback(() => { searchMarkers.current.forEach(m => m.remove()); searchMarkers.current = []; }, []);
  const handleMapSelection = useCallback((lngLat: { lng: number, lat: number }) => { if(!map.current) return; clearRoute(); if (destinationMarker.current) destinationMarker.current.remove(); destinationMarker.current = new Marker({ color: '#ef4444' }).setLngLat(lngLat).addTo(map.current); setLocationDetails(lngLat); setIsDrawerOpen(true); fetchRichDetails(lngLat.lat, lngLat.lng); map.current.flyTo({ center: lngLat, zoom: 16, padding: { top: 0, bottom: 250, left: 0, right: 0 }, essential: true, duration: 1500 }); }, []);
  const plotSearchResults = useCallback((results: SearchResult[], type: string) => { if(!map.current) return; const bounds = new LngLatBounds(); results.forEach(r => { const el = document.createElement('div'); el.className = 'marker-pin'; el.innerHTML = `<div class="bg-indigo-500 w-4 h-4 rounded-full border-2 border-white shadow-lg"></div>`; const marker = new Marker({ element: el }).setLngLat([r.lng, r.lat]).setPopup(new mapboxgl.Popup({ offset: 25, closeButton: false }).setHTML(`<b>${r.name}</b><br>${r.address}`)).addTo(map.current!); marker.getElement().addEventListener('click', (e) => { e.stopPropagation(); handleMapSelection({ lng: r.lng, lat: r.lat }); }); searchMarkers.current.push(marker); bounds.extend([r.lng, r.lat]); }); if (results.length > 0) map.current.fitBounds(bounds, { padding: 100, maxZoom: 16 }); else toast({ title: "No results", description: "Nothing found nearby." }); }, [handleMapSelection, toast]);
  
  const handleCategorySearch = useCallback(async (query: string) => { 
      const geoKey = GEOAPIFY_API_KEY; 
      const center = userLocation.current || (map.current ? map.current.getCenter().toArray() as [number, number] : DEFAULT_CENTER); 
      clearSearchMarkers(); 
      if (isNavigating && routeGeoJSON.current && geoKey) { 
          let category = "commercial"; 
          if (query === "gas station") category = "service.vehicle.fuel"; 
          else if (query === "restaurant") category = "catering.restaurant"; 
          else if (query === "coffee") category = "catering.cafe"; 
          else if (query === "bank") category = "service.financial"; 
          else if (query === "school") category = "education"; 
          
          try { 
              const url = `https://api.geoapify.com/v2/places?categories=${category}&filter=geometry:${simplifyGeometry(routeGeoJSON.current)}&limit=10&apiKey=${geoKey}`; 
              const res = await fetch(url); 
              const data = await res.json(); 
              const results = data.features.map((f: any) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], name: f.properties.name || f.properties.address_line1 || "Unknown", address: f.properties.address_line2 || "", type: query })); 
              plotSearchResults(results, query); 
          } catch (e) { 
              const fallbackResults = await searchPlaces(query, center, true); 
              plotSearchResults(fallbackResults, query); 
          } 
      } else { 
          const results = await searchPlaces(query, center, true); 
          plotSearchResults(results, query); 
      } 
  }, [clearSearchMarkers, plotSearchResults, toast, isNavigating]);

  // --- INIT MAP ---
  useEffect(() => {
    isMounted.current = true;
    if (!MAPBOX_TOKEN || !mapContainer.current || map.current) return;
    const mapInstance = new mapboxgl.Map({ 
        container: mapContainer.current, 
        style: currentStyle, 
        center: DEFAULT_CENTER, 
        zoom: DEFAULT_ZOOM, 
        pitch: 45, 
        bearing: 0, 
        attributionControl: false, 
        antialias: true, 
        logoPosition: 'bottom-left',
        cooperativeGestures: false, // CHANGED: Allow one-finger pan (disables overlay)
        dragRotate: true,
        touchZoomRotate: true,
        pitchWithRotate: true,
    });
    map.current = mapInstance;
    mapInstance.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    const geolocate = new GeolocateControl({ positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }, trackUserLocation: false, showUserHeading: false, showUserLocation: false, showAccuracyCircle: false });
    geolocateControl.current = geolocate;
    mapInstance.addControl(geolocate, 'top-right');
    const el = document.createElement('div'); el.className = 'navigation-puck'; el.style.display = 'none'; el.innerHTML = `<div class="puck-pulse"></div>`;
    puckElement.current = el;
    puckMarker.current = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(DEFAULT_CENTER).addTo(mapInstance);
    const handleOrientation = (event: DeviceOrientationEvent) => { if (event.alpha !== null) compassHeading.current = (event as any).webkitCompassHeading || (360 - event.alpha); };
    const handleVisibilityChange = () => { if (document.visibilityState === 'visible' && isNavigatingRef.current) requestWakeLock(); };
    if (typeof window !== 'undefined') { window.addEventListener('deviceorientation', handleOrientation); document.addEventListener('visibilitychange', handleVisibilityChange); }
    
    mapInstance.on('load', () => {
        if (!isMounted.current) return; setIsMapLoaded(true); geolocate.trigger(); 
        
        // Add 3D Terrain safely
        if (!mapInstance.getSource('mapbox-dem')) mapInstance.addSource('mapbox-dem', { 'type': 'raster-dem', 'url': 'mapbox://mapbox.mapbox-terrain-dem-v1', 'tileSize': 512, 'maxzoom': 14 }); 
        try {
             mapInstance.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 }); 
        } catch (e) {
            console.warn("Terrain disabled due to browser privacy settings");
        }
        
        restoreMapLayers(mapInstance, isTrafficVisible, isRainMode, isWindMode); 
        if (!animationFrameId.current) animationFrameId.current = requestAnimationFrame(animatePuck);
        
        // --- FIXED GEOLOCATION WATCHER ---
        if ('geolocation' in navigator) {
            watchId.current = navigator.geolocation.watchPosition(async (pos) => {
                if (!isMounted.current) return;
                const { latitude, longitude, heading, speed } = pos.coords;
                if (puckElement.current) puckElement.current.style.display = 'block';
                
                // Update internal refs
                userLocation.current = [longitude, latitude];
                setCurrentUserLocationForAR([longitude, latitude]);
                targetPuckPos.current = [longitude, latitude];
                
                const speedKmh = speed ? Math.round(speed * 3.6) : 0;
                setCurrentSpeed(prev => (Math.abs(prev - speedKmh) > 2 ? speedKmh : prev)); // Debounce UI updates
                
                if (heading !== null && !isNaN(heading)) gpsHeading.current = heading;
                const isMoving = speedKmh > 5;
                targetHeading.current = isMoving && heading !== null ? heading : compassHeading.current;
                
                if (!animationFrameId.current) animationFrameId.current = requestAnimationFrame(animatePuck);
                fetchWeather(latitude, longitude);
                
                // --- FIX: USE REFS TO AVOID STALE STATE ---
                const activeConvoy = activeConvoyRef.current;
                const isSafety = isSafetyModeActiveRef.current;
                const tripId = currentTripIdRef.current;

                // Safety Mode & Convoy Updates (Throttled & Circuit Breaker)
                if ((isSafety && tripId) || activeConvoy) {
                    // Stop trying if DB is broken to avoid 400 error spam
                    if (supabaseErrorCount.current > 3) return;

                    const now = Date.now();
                    if (now - lastSafetyUpdate.current > 3000 && supabase) {
                        const payload = { lat: latitude, lng: longitude, heading: heading || 0, speed: speed || 0, last_updated: new Date().toISOString() };
                        
                        // Safety Trip
                        if (isSafety && tripId) {
                            supabase.from('active_trips').update({ current_lat: latitude, current_lng: longitude, heading: heading||0, speed: speed||0, last_updated: new Date().toISOString() })
                                .eq('id', tripId).then(({ error }) => { 
                                    if (error) { 
                                        supabaseErrorCount.current++;
                                        if (!hasLoggedSupabaseError.current) { console.warn("Trip update failed:", error.message); hasLoggedSupabaseError.current = true; } 
                                    } 
                                });
                        }
                        
                        // Convoy
                        if (activeConvoy) { 
                            const myId = localStorage.getItem('convoy_user_id'); 
                            if(myId) {
                                supabase.from('convoy_members').upsert({ convoy_code: activeConvoy, user_id: myId, ...payload }, { onConflict: 'user_id' })
                                    .then(({ error }) => { 
                                        if (error) { 
                                            supabaseErrorCount.current++;
                                            if (!hasLoggedSupabaseError.current) { console.warn("Convoy update failed (Check RLS/Constraints):", error.message); hasLoggedSupabaseError.current = true; } 
                                        } 
                                    });
                            }
                        }
                        lastSafetyUpdate.current = now;
                    }
                }
                
                // Geofencing Arrival
                if (isNavigatingRef.current && activeDestination.current) {
                    const dist = getDistanceFromLatLonInMeters(latitude, longitude, activeDestination.current[1], activeDestination.current[0]);
                    
                    setRouteDetails(prev => prev ? { ...prev, distance: dist, duration: (dist / 1000) / (Math.max(20, speedKmh) / 60) * 60 } : null);

                    if (dist < ARRIVAL_THRESHOLD_METERS) stopSafetyMode('arrived');

                    if (routeGeoJSON.current && !isRecalculating.current && (Date.now() - lastRerouteTime.current > REROUTE_COOLDOWN_MS)) { 
                         const distanceToPath = getMinDistanceToRoute(latitude, longitude, routeGeoJSON.current); 
                         if (distanceToPath > REROUTE_THRESHOLD_METERS) { 
                             isRecalculating.current = true; lastRerouteTime.current = Date.now(); 
                             toast({ title: "Rerouting...", description: "កំពុងគណនាផ្លូវថ្មី", duration: 2000 }); 
                             fetchRoute([longitude, latitude], activeDestination.current, true).then(() => { isRecalculating.current = false; }); 
                        } 
                    }
                }
            }, (err) => { console.warn("GPS Warning:", err); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
        }
    });
    const handleInteractionStart = () => { if (isNavigatingRef.current) { userIsInteracting.current = true; setShowRecenterBtn(true); } }; const handleMapClick = (e: MapMouseEvent) => { if (!isNavigatingRef.current) handleMapSelection(e.lngLat); }; mapInstance.on('touchstart', handleInteractionStart); mapInstance.on('dragstart', handleInteractionStart); mapInstance.on('pitchstart', handleInteractionStart); mapInstance.on('zoomstart', handleInteractionStart); mapInstance.on('wheel', handleInteractionStart); mapInstance.on('click', handleMapClick);
    return () => { isMounted.current = false; if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); if (typeof window !== 'undefined') { window.removeEventListener('deviceorientation', handleOrientation); document.removeEventListener('visibilitychange', handleVisibilityChange); if (window.speechSynthesis) window.speechSynthesis.cancel(); } if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); releaseWakeLock(); if (map.current) map.current.remove(); map.current = null; }
  }, []);

  useEffect(() => { let frameId: number; const animateWindLayer = () => { if (isWindMode && map.current?.getLayer('wind-layer')) { const time = Date.now() / 2000; map.current.setPaintProperty('wind-layer', 'raster-opacity', 0.6 + Math.sin(time) * 0.1); } frameId = requestAnimationFrame(animateWindLayer); }; if (isWindMode) animateWindLayer(); return () => cancelAnimationFrame(frameId); }, [isWindMode]);
  useEffect(() => { if (routeDetails?.instruction && isNavigating && lastSpokenInstruction.current !== routeDetails.instruction) { speak(routeDetails.instruction); lastSpokenInstruction.current = routeDetails.instruction; } }, [routeDetails, speak, isNavigating]);
  
  useEffect(() => { 
      if (locationDetails) { 
          if (addressAbortController.current) addressAbortController.current.abort(); 
          const controller = new AbortController(); 
          addressAbortController.current = controller; 
          setIsFetchingAddress(true); 
          setAddressDetails(null); 
          const timeoutId = setTimeout(async () => { 
              if (!GEOAPIFY_API_KEY) { 
                  if (!controller.signal.aborted) {
                      setAddressDetails({ formatted: `${locationDetails.lat.toFixed(5)}, ${locationDetails.lng.toFixed(5)}` }); 
                      setIsFetchingAddress(false);
                  }
                  return; 
              } 
              try { 
                  const res = await fetch(`https://api.geoapify.com/v1/geocode/reverse?lat=${locationDetails.lat}&lon=${locationDetails.lng}&apiKey=${GEOAPIFY_API_KEY}&lang=km`, { signal: controller.signal }); 
                  const data = await res.json(); 
                  if (isMounted.current && !controller.signal.aborted) setAddressDetails((data.features?.length) ? data.features[0].properties : { formatted: "ទីតាំងមិនស្គាល់" }); 
              } catch (error: any) { 
                  if (error.name !== 'AbortError' && isMounted.current) setAddressDetails({ formatted: "ទីតាំងមិនស្គាល់" }); 
              } finally { 
                  if (isMounted.current && !controller.signal.aborted) setIsFetchingAddress(false); 
              } 
          }, 600); 
          return () => clearTimeout(timeoutId); 
      } 
  }, [locationDetails]);

  const handleStartNavigation = async () => { 
      triggerHaptic();
      if (!userLocation.current || !locationDetails) { toast({ title: "Error", description: "No GPS" }); return; } 
      setIsRouting(true); 
      // Initialize audio context on user click (Silent utterance trick)
      const u = new SpeechSynthesisUtterance(" ");
      window.speechSynthesis.speak(u);
      speak("Starting navigation");
      
      const start = userLocation.current; 
      const end: [number, number] = [locationDetails.lng, locationDetails.lat]; 
      const success = await fetchRoute(start, end); 
      if (success) { 
          setIsNavigating(true); 
          activeDestination.current = end; 
          setIsDrawerOpen(false); 
          setShowRecenterBtn(false); 
          requestWakeLock(); 
          if(map.current) map.current.flyTo({ center: start, zoom: 18, pitch: 60, bearing: targetHeading.current, duration: 2000 }); 
      } 
      setIsRouting(false); 
  };

  const clearRoute = useCallback(() => { setIsNavigating(false); activeDestination.current = null; routeGeoJSON.current = null; releaseWakeLock(); if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel(); if (destinationMarker.current) { destinationMarker.current.remove(); destinationMarker.current = null; } if(map.current) removeRouteLayers(map.current); clearSearchMarkers(); setRouteDetails(null); setLocationDetails(null); setIsDrawerOpen(false); setShowRecenterBtn(false); if(map.current && userLocation.current) map.current.flyTo({ center: userLocation.current, zoom: 15, pitch: 0, bearing: 0, duration: 1500 }); }, [clearSearchMarkers, removeRouteLayers]);
  const toggleLayer = useCallback((layerName: 'rain' | 'wind' | 'traffic') => { if (!map.current) return; let isActive: boolean, setIsActive: Function, layerId: string; switch(layerName) { case 'traffic': isActive = isTrafficVisible; setIsActive = setIsTrafficVisible; layerId = 'traffic'; break; case 'rain': isActive = isRainMode; setIsActive = setIsRainMode; layerId = 'rain-layer'; break; case 'wind': isActive = isWindMode; setIsActive = setIsWindMode; layerId = 'wind-layer'; break; } const newState = !isActive; setIsActive(newState); if (map.current.getLayer(layerId)) map.current.setLayoutProperty(layerId, 'visibility', newState ? 'visible' : 'none'); else if (newState) restoreMapLayers(map.current, layerName === 'traffic' ? true : isTrafficVisible, layerName === 'rain' ? true : isRainMode, layerName === 'wind' ? true : isWindMode); }, [isTrafficVisible, isRainMode, isWindMode, restoreMapLayers]);
  const toggleAR = useCallback(() => { triggerHaptic(); if (!userLocation.current || !locationDetails) { toast({ title: "Error", description: "Set destination first" }); return; } setShowAR(prev => !prev); }, [locationDetails, toast]);
  const handleAutocomplete = useCallback(async (query: string, signal: AbortSignal) => { if (!query.trim()) return []; const center = map.current ? map.current.getCenter().toArray() as [number, number] : (userLocation.current || DEFAULT_CENTER); return await searchPlaces(query, center, false, signal); }, []);
  const resetCompass = useCallback(() => { triggerHaptic(); if(map.current) map.current.easeTo({ bearing: 0, pitch: 45, duration: 800 }); }, []);
  const handleRecenter = () => { triggerHaptic(); if(!userLocation.current || !map.current) return; userIsInteracting.current = false; setShowRecenterBtn(false); showRecenterBtnRef.current = false; map.current.flyTo({ center: userLocation.current, zoom: 19, pitch: 70, bearing: targetHeading.current, padding: { top: 0, bottom: 200, left: 0, right: 0 }, duration: 1200 }); };
  const handleUserLocationClick = useCallback(() => { triggerHaptic(); if(!userLocation.current || !map.current) { geolocateControl.current?.trigger(); toast({ title: "ស្វែងរកទីតាំង...", duration: 1000 }); return; } map.current.flyTo({ center: userLocation.current, zoom: 16, duration: 1200 }); }, [toast]);

  // Safety
  const startSafetyMode = async () => { 
      triggerHaptic();
      if (!supabase || !userLocation.current) return; 
      const { data, error } = await supabase.from('active_trips').insert({ current_lat: userLocation.current[1], current_lng: userLocation.current[0], status: 'active' }).select().single(); 
      if(error) { toast({ title: "Error", description: "Check Supabase Permissions", variant: "destructive" }); return; }
      if(data) { setCurrentTripId(data.id); setIsSafetyModeActive(true); setShowShareDialog(true); } 
  };
  const stopSafetyMode = async (status = 'ended') => { triggerHaptic(); if (currentTripId && supabase) await supabase.from('active_trips').update({ status }).eq('id', currentTripId); setIsSafetyModeActive(false); setCurrentTripId(null); setShowShareDialog(false); };

  if (!MAPBOX_TOKEN) return <div className={`flex h-screen w-full items-center justify-center bg-zinc-950 text-white p-6 ${kantumruy.className}`}><Card className="w-full max-w-md bg-zinc-900 border-red-900/50"><CardContent className="flex flex-col items-center gap-4 p-6"><AlertTriangle className="h-8 w-8 text-red-500" /><h2 className="text-xl font-bold">Missing Token</h2></CardContent></Card></div>;

  return (
    <div className={`relative h-[100dvh] w-full overflow-hidden bg-zinc-950 text-zinc-50 ${kantumruy.className}`}>
        <style jsx global>{` .navigation-puck { width: 24px; height: 24px; background-color: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(59, 130, 246, 0.5); position: relative; z-index: 50; } .puck-pulse { position: absolute; width: 60px; height: 60px; top: -21px; left: -21px; border-radius: 50%; background: rgba(59, 130, 246, 0.4); animation: pulse 2s infinite; z-index: -1; } @keyframes pulse { 0% { transform: scale(0.5); opacity: 1; } 100% { transform: scale(1.5); opacity: 0; } } `}</style>
        
        <div ref={mapContainer} className="absolute inset-0 w-full h-full touch-none" style={{ touchAction: 'none' }} />
        
        <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 text-white transition-opacity duration-700 pointer-events-none ${isMapLoaded ? 'opacity-0' : 'opacity-100'}`}><Loader2 className="h-10 w-10 animate-spin text-indigo-500 mb-4" /></div>
        
        <WelcomeWizard onComplete={() => {}} />
        <WeatherWidget weather={weather} isNavigating={isNavigating} />
        {/* Battery Saver Overlay */}
        <div className={`absolute inset-0 bg-black z-[100] flex flex-col items-center justify-center transition-opacity duration-1000 pointer-events-none ${isBatterySaver ? 'opacity-100' : 'opacity-0'}`}>
            <BatteryCharging className="h-16 w-16 text-emerald-500 animate-pulse mb-4" />
            <h1 className="text-4xl font-bold font-mono text-center px-4">{routeDetails?.instruction || "Proceed"}</h1>
            <p className="text-zinc-500 mt-2">Tap to wake</p>
        </div>

        {showAR && currentUserLocationForAR && locationDetails && <ArLastMileView userLocation={currentUserLocationForAR} destination={[locationDetails.lng, locationDetails.lat]} routePath={routeGeoJSON.current} onClose={() => setShowAR(false)} hasParentPermission={hasArPermission} setParentPermission={setHasArPermission} />}
        {showDashcam && <AiDashcam onClose={() => setShowDashcam(false)} onDetect={() => {}} />}

        {/* Top Right Controls (Convoy & Dashcam) */}
        <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 pointer-events-auto" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <Button onClick={() => setShowDashcam(!showDashcam)} className={`h-11 w-11 rounded-full shadow-xl border ${showDashcam ? 'bg-red-600 border-red-500 animate-pulse' : 'bg-zinc-900 border-zinc-700 text-white animate-in zoom-in slide-in-from-right-10 duration-700'}`}><Video className="h-5 w-5" /></Button>
            <Button onClick={() => setShowConvoyDialog(true)} className={`h-11 w-11 rounded-full shadow-xl border ${activeConvoy ? 'bg-indigo-600 border-indigo-500' : 'bg-zinc-900 border-zinc-700 text-white animate-in zoom-in slide-in-from-right-10 duration-1000 delay-100'}`}>{activeConvoy ? <Users className="h-5 w-5" /> : <Radio className="h-5 w-5" />}</Button>
            <Button onClick={handleVoiceCommand} className="h-11 w-11 rounded-full shadow-xl border bg-zinc-900 border-zinc-700 text-blue-400"><Mic2 className="h-5 w-5" /></Button>
        </div>

        {activeConvoy && <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-indigo-600/90 backdrop-blur-md px-4 py-2 rounded-full flex items-center gap-3 shadow-lg border border-white/20 animate-in slide-in-from-top-4" style={{ marginTop: 'env(safe-area-inset-top)' }}><Users className="h-4 w-4 text-white" /><span className="text-xs font-bold text-white uppercase tracking-wider">Code: {activeConvoy}</span><span className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-mono">{convoyMembers.length} Members</span></div>}

        {isNavigating && routeDetails ? <NavigationHUD routeDetails={routeDetails} isMuted={isMuted} setIsMuted={setIsMuted} currentSpeed={currentSpeed} onClearRoute={clearRoute} /> : <BottomControls isTrafficVisible={isTrafficVisible} toggleTraffic={() => toggleLayer('traffic')} isRainMode={isRainMode} toggleRainMode={() => toggleLayer('rain')} isWindMode={isWindMode} toggleWindMode={() => toggleLayer('wind')} isSafetyModeActive={isSafetyModeActive} startSafetyMode={startSafetyMode} showShareDialog={() => setShowShareDialog(true)} resetCompass={resetCompass} handleCategorySearch={handleCategorySearch} handleAutocomplete={handleAutocomplete} onSelectLocation={handleMapSelection} userLocation={userLocation.current} handleUserLocationClick={handleUserLocationClick} handleStyleChange={handleStyleChange} currentStyle={currentStyle} canShowAR={!!locationDetails} toggleAR={toggleAR} isDrawerOpen={isDrawerOpen} onReportClick={() => setShowReportDialog(true)} />}
        
        {isNavigating && showRecenterBtn && <div className="absolute bottom-32 right-4 z-20 pointer-events-auto pb-[safe-area-inset-bottom] animate-in zoom-in-50 duration-300"><Button onClick={handleRecenter} className="h-14 w-14 rounded-full bg-zinc-900 border border-zinc-700 shadow-2xl text-blue-500 flex flex-col items-center justify-center gap-0 hover:bg-zinc-800 transition-transform active:scale-90"><LocateFixed className="h-6 w-6" /><span className="text-[9px] font-bold uppercase">Me</span></Button></div>}

        {/* Dialogs */}
        <Dialog open={showReportDialog} onOpenChange={setShowReportDialog}><DialogContent className="bg-zinc-900 border-zinc-800 text-white w-[90%] max-w-sm rounded-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="text-yellow-500" /> Report</DialogTitle></DialogHeader><div className="grid grid-cols-3 gap-3 py-2"><Button onClick={() => reportIncident('police')} variant="outline" className="h-20 flex-col gap-1 border-zinc-700 bg-zinc-800 hover:bg-blue-900/50 hover:border-blue-500"><Siren className="h-6 w-6 text-blue-500" /><span>Police</span></Button><Button onClick={() => reportIncident('accident')} variant="outline" className="h-20 flex-col gap-1 border-zinc-700 bg-zinc-800 hover:bg-red-900/50 hover:border-red-500"><CarFront className="h-6 w-6 text-red-500" /><span>Crash</span></Button><Button onClick={() => reportIncident('traffic')} variant="outline" className="h-20 flex-col gap-1 border-zinc-700 bg-zinc-800 hover:bg-orange-900/50 hover:border-orange-500"><Construction className="h-6 w-6 text-orange-500" /><span>Traffic</span></Button></div></DialogContent></Dialog>
        <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}><DialogContent className="bg-zinc-900 border-zinc-800 text-white w-[90%] max-w-sm rounded-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Shield className="text-red-500" /> Live Trip</DialogTitle></DialogHeader>{currentTripId && <div className="flex flex-col items-center gap-4 py-4"><div className="bg-white p-2 rounded-lg"><QRCodeSVG value={`${typeof window !== 'undefined' ? window.location.origin : ''}/track/${currentTripId}`} size={150} /></div><Button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/track/${currentTripId}`); toast({ title: "Copied!" }); }}><Copy className="h-4 w-4 mr-2" /> Copy Link</Button><Button variant="destructive" className="w-full" onClick={() => stopSafetyMode('ended')}>Stop Sharing</Button></div>}</DialogContent></Dialog>
        <Dialog open={showConvoyDialog} onOpenChange={setShowConvoyDialog}><DialogContent className="bg-zinc-900 border-zinc-800 text-white w-[90%] max-w-sm rounded-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><Users className="text-indigo-500" /> Convoy Mode</DialogTitle></DialogHeader>{!activeConvoy ? <div className="flex flex-col gap-4 py-2"><Input placeholder="Enter Code (e.g. TRIP-99)" className="bg-zinc-800 border-zinc-700 text-white uppercase font-mono tracking-widest text-center" value={convoyCode} onChange={(e) => setConvoyCode(e.target.value.toUpperCase())} /><Button onClick={joinConvoy} className="bg-indigo-600 hover:bg-indigo-500 text-white w-full">Join / Create</Button></div> : <div className="flex flex-col gap-4 py-2"><div className="bg-zinc-800 p-4 rounded-lg text-center border border-zinc-700"><p className="text-xs text-zinc-500 uppercase mb-1">Code</p><p className="text-2xl font-mono font-bold text-indigo-400 tracking-widest">{activeConvoy}</p></div><div className="space-y-2"><p className="text-xs text-zinc-500 font-bold uppercase">Members ({convoyMembers.length})</p>{convoyMembers.map((m, i) => (<div key={i} className="flex justify-between items-center text-sm p-2 bg-zinc-800/50 rounded"><span>Member #{i+1}</span><span className="text-zinc-500 text-xs">{m.speed ? Math.round(m.speed * 3.6) + ' km/h' : 'Stationary'}</span></div>))}</div><Button onClick={leaveConvoy} variant="destructive" className="w-full"><LogOut className="mr-2 h-4 w-4" /> Leave</Button></div>}</DialogContent></Dialog>

        <Sheet open={isDrawerOpen} onOpenChange={(open) => !open && !isNavigating && setIsDrawerOpen(false)}>
          <SheetContent side="bottom" className={`rounded-t-3xl p-6 border-t border-zinc-800 bg-[#18181b]/95 backdrop-blur-xl text-white ring-1 ring-white/10 z-50 pb-[safe-area-inset-bottom] ${kantumruy.className}`}>
            {locationDetails && (
              <div className="space-y-6 pb-2">
                <SheetHeader className="text-left space-y-1"><div className="flex items-center gap-3 mb-2"><div className="h-10 w-10 rounded-full bg-indigo-500/20 flex items-center justify-center"><MapPin className="h-5 w-5 text-indigo-400" /></div><div className="flex-1 min-w-0"><SheetTitle asChild className="text-xl font-bold line-clamp-1 text-white"><div role="heading" aria-level={2}>{isFetchingAddress ? <Skeleton className="h-6 w-32 bg-zinc-800" /> : (addressDetails?.name || addressDetails?.address_line1 || "Selected Location")}</div></SheetTitle><SheetDescription asChild className="text-zinc-400 text-xs line-clamp-1"><div>{isFetchingAddress ? <Skeleton className="h-4 w-48 bg-zinc-800 mt-1" /> : (addressDetails?.formatted || "")}</div></SheetDescription></div></div></SheetHeader>
                {routeDetails && (<div className="bg-zinc-800/50 p-3 rounded-xl border border-zinc-700/50 flex justify-between items-center mb-2"><div className="flex items-center gap-2"><Select value={vehicleType} onValueChange={(v: any) => setVehicleType(v)}><SelectTrigger className="w-[110px] h-8 bg-zinc-900 border-zinc-700 text-xs"><SelectValue placeholder="Vehicle" /></SelectTrigger><SelectContent className="bg-zinc-900 border-zinc-700 text-white"><SelectItem value="moto">Moto</SelectItem><SelectItem value="car">Car</SelectItem><SelectItem value="suv">SUV</SelectItem></SelectContent></Select></div><div className="flex flex-col items-end"><span className="text-[10px] text-zinc-400 font-bold uppercase">Est. Cost</span><span className="text-lg font-bold text-emerald-400 font-mono">{estimatedCost.toLocaleString()}៛</span></div></div>)}
                <div className="mt-2 grid grid-cols-2 gap-3"><div className="col-span-2"><p className="text-[10px] text-zinc-500 font-bold uppercase mb-2 tracking-wider">Ride Hailing</p><div className="grid grid-cols-3 gap-2"><Button onClick={() => window.open(`grab://open?screenType=GRABRIDE&dropOffLatitude=${locationDetails.lat}&dropOffLongitude=${locationDetails.lng}`)} variant="outline" className="h-12 border-zinc-700 bg-zinc-800/50 hover:bg-[#00B14F]/20 hover:border-[#00B14F] hover:text-[#00B14F] transition-all flex flex-col gap-0.5"><CarFront className="h-4 w-4" /> <span className="text-[10px] font-bold">Grab</span></Button><Button onClick={() => window.open("passapp://")} variant="outline" className="h-12 border-zinc-700 bg-zinc-800/50 hover:bg-[#1D8F48]/20 hover:border-[#1D8F48] hover:text-[#1D8F48] transition-all flex flex-col gap-0.5"><CarFront className="h-4 w-4" /> <span className="text-[10px] font-bold">PassApp</span></Button><Button onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${locationDetails.lat},${locationDetails.lng}`)} variant="outline" className="h-12 border-zinc-700 bg-zinc-800/50 hover:bg-blue-500/20 hover:border-blue-500 hover:text-blue-500 transition-all flex flex-col gap-0.5"><ExternalLink className="h-4 w-4" /> <span className="text-[10px] font-bold">Google</span></Button></div></div></div>
                <SheetFooter className="flex flex-col sm:flex-col sm:space-x-0 gap-2 mt-4"><Button className="w-full gap-2 bg-zinc-800 hover:bg-zinc-700 text-white h-12 text-base font-semibold border border-zinc-700 rounded-xl" onClick={toggleAR} ><Camera className="h-5 w-5" /> Live View (AR)</Button><Button className="w-full gap-2 bg-indigo-600 hover:bg-indigo-700 text-white h-12 text-base font-semibold shadow-lg shadow-indigo-900/20 rounded-xl transition-all active:scale-[0.98]" onClick={handleStartNavigation} disabled={isFetchingAddress || !userLocation.current || isRouting} >{isRouting ? <><Loader2 className="h-5 w-5 animate-spin" /> Calculating...</> : <><Navigation className="h-5 w-5" /> Start Navigation</>}</Button></SheetFooter>
              </div>
            )}
          </SheetContent>
        </Sheet>
    </div>
  );
}

// ==========================================
// SUB-COMPONENTS
// ==========================================

const WeatherWidget = memo(({ weather, isNavigating }: { weather: WeatherData | null, isNavigating: boolean }) => {
    if (isNavigating || !weather) return null;
    return (
        <div className="absolute top-4 left-4 z-20 pointer-events-none" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <div className="bg-[#18181b]/80 backdrop-blur-xl border border-white/10 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-2xl animate-in fade-in zoom-in-95">
                {getWeatherIcon(weather.condition)}<div className="flex flex-col"><span className="text-sm font-bold text-white leading-none">{weather.temp}°</span><span className="text-[10px] text-zinc-400 capitalize">{weather.description}</span></div>
            </div>
        </div>
    );
});
WeatherWidget.displayName = "WeatherWidget";

const NavigationHUD = memo(({ routeDetails, isMuted, setIsMuted, currentSpeed, onClearRoute }: any) => {
    const progress = routeDetails.initialTotalDistance 
        ? Math.max(0, Math.min(100, 100 - (routeDetails.distance / routeDetails.initialTotalDistance * 100))) 
        : 0;

    return (
        <>
        <div className="absolute top-0 left-0 right-0 z-30 pt-2 px-2 pointer-events-none pb-[safe-area-inset-top]" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
            <div className="w-full max-w-md mx-auto shadow-2xl bg-[#18181b] border-b-4 border-emerald-500 rounded-xl overflow-hidden pointer-events-auto ring-1 ring-white/10">
                <div className="flex items-center p-4 gap-4">
                    <div className="bg-emerald-600 h-14 w-14 rounded-lg flex items-center justify-center shadow-lg shrink-0"><ManeuverIcon instruction={routeDetails.instruction} /></div>
                    <div className="flex-1 min-w-0"><div className="text-2xl font-bold leading-tight break-words text-white">{routeDetails.instruction}</div></div>
                    <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} className="h-10 w-10 rounded-full bg-zinc-800/50 hover:bg-zinc-700">{isMuted ? <VolumeX className="h-5 w-5 text-zinc-400" /> : <Volume2 className="h-5 w-5 text-emerald-400" />}</Button>
                </div>
            </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 z-30 pb-[safe-area-inset-bottom]">
            <div className="h-1.5 w-full bg-zinc-800">
                <div className="h-full bg-emerald-500 transition-all duration-1000 ease-out" style={{ width: `${progress}%` }}></div>
            </div>
            <div className="bg-[#18181b]/95 backdrop-blur-xl border-t border-zinc-800 p-5 flex items-center justify-between shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
                <div className="flex flex-col gap-1"><div className="flex items-baseline gap-2"><span className="text-4xl font-bold text-emerald-400 leading-none tracking-tight">{formatDuration(routeDetails.duration)}</span><span className="text-sm text-zinc-400 font-medium">remaining</span></div><div className="flex items-center gap-2 text-zinc-400 text-sm font-medium"><span className="text-white">{formatDistance(routeDetails.distance)}</span><span className="w-1 h-1 rounded-full bg-zinc-600"></span><span>{routeDetails.arrivalTime}</span></div></div>
                <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center justify-center bg-zinc-900 h-14 w-14 rounded-full border-2 border-zinc-700 ring-2 ring-black/50 shadow-inner relative"><span className="text-xl font-bold text-white leading-none z-10">{currentSpeed}</span><span className="text-[8px] text-zinc-500 font-bold uppercase z-10 mt-0.5">km/h</span><svg className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"><circle cx="28" cy="28" r="26" fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="163" strokeDashoffset={163 - (Math.min(currentSpeed, 120)/120)*163} className="transition-all duration-500" /></svg></div>
                    <Button size="icon" onClick={onClearRoute} className="h-12 w-12 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50 shadow-lg"><X className="h-6 w-6" /></Button>
                </div>
            </div>
        </div>
        </>
    );
});
NavigationHUD.displayName = "NavigationHUD";

const WelcomeWizard = ({ onComplete }: { onComplete: () => void }) => {
    const [step, setStep] = useState(0);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const hasSeen = localStorage.getItem('has_seen_onboarding_v2');
        if (!hasSeen) {
            setTimeout(() => setIsOpen(true), 1500);
        }
    }, []);

    const handleNext = () => {
        triggerHaptic();
        if (step < 3) {
            setStep(prev => prev + 1);
        } else {
            localStorage.setItem('has_seen_onboarding_v2', 'true');
            setIsOpen(false);
            onComplete();
        }
    };

    const handleLocationPerm = () => {
        triggerHaptic();
        if ('geolocation' in navigator) {
            navigator.geolocation.getCurrentPosition(() => handleNext(), () => handleNext());
        } else {
            handleNext();
        }
    };

    const steps = [
        {
            icon: <MapPin className="h-10 w-10 text-emerald-500" />,
            title: "Welcome to Map Explorer",
            desc: "The ultimate navigation tool for Cambodia. Let's get you set up.",
            action: <Button onClick={handleLocationPerm} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2"><LocateFixed className="h-4 w-4" /> Enable Location</Button>
        },
        {
            icon: <Camera className="h-10 w-10 text-indigo-500" />,
            title: "AR Navigation",
            desc: "See your destination in the real world. Just tap 'Live View' when navigating.",
            action: <Button onClick={handleNext} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">Got it</Button>
        },
        {
            icon: <Shield className="h-10 w-10 text-red-500" />,
            title: "Safety & Dashcam",
            desc: "AI Traffic detection and live location sharing keep you safe on the road.",
            action: <Button onClick={handleNext} className="w-full bg-red-600 hover:bg-red-700 text-white">Next</Button>
        },
        {
            icon: <CheckCircle2 className="h-10 w-10 text-blue-500" />,
            title: "You're Ready!",
            desc: "Explore nearby places, join convoys, and drive safely.",
            action: <Button onClick={handleNext} className="w-full bg-blue-600 hover:bg-blue-700 text-white">Start Exploring</Button>
        }
    ];

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-800 text-white p-0 overflow-hidden gap-0">
                <div className="h-2 w-full bg-zinc-800">
                    <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 transition-all duration-500" style={{ width: `${((step + 1) / 4) * 100}%` }}></div>
                </div>
                <div className="p-6 text-center flex flex-col items-center gap-4">
                    <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center mb-2 animate-in zoom-in duration-500">
                        {steps[step].icon}
                    </div>
                    <DialogTitle className="text-2xl font-bold">{steps[step].title}</DialogTitle>
                    <DialogDescription className="text-zinc-400 text-base">{steps[step].desc}</DialogDescription>
                </div>
                <DialogFooter className="p-6 pt-0 sm:justify-center">
                    {steps[step].action}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const BottomControls = memo(({
    isTrafficVisible, toggleTraffic, isRainMode, toggleRainMode, isWindMode, toggleWindMode,
    isSafetyModeActive, startSafetyMode, showShareDialog,
    resetCompass, handleCategorySearch, handleAutocomplete, onSelectLocation, userLocation, handleUserLocationClick,
    handleStyleChange, currentStyle, canShowAR, toggleAR, isDrawerOpen, onReportClick
}: any) => {
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [history, setHistory] = useState<SearchResult[]>([]);
    const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
    const [isInputActive, setIsInputActive] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { try { const saved = localStorage.getItem('map_history'); if (saved) setHistory(JSON.parse(saved)); } catch (e) { localStorage.removeItem('map_history'); } }, []);
    const updateHistory = (newHistory: SearchResult[]) => { setHistory(newHistory); localStorage.setItem('map_history', JSON.stringify(newHistory)); };
    const removeFromHistory = (e: React.MouseEvent, itemToRemove: SearchResult) => { e.stopPropagation(); const newHistory = history.filter(item => item.name !== itemToRemove.name); updateHistory(newHistory); };
    useEffect(() => { const controller = new AbortController(); if (query.trim().length <= 1) { setSuggestions([]); setIsSearching(false); return; } const timeoutId = setTimeout(async () => { setIsSearching(true); const results = await handleAutocomplete(query, controller.signal); if (!controller.signal.aborted) { setSuggestions(results); setIsSearching(false); } }, 400); return () => { clearTimeout(timeoutId); controller.abort(); }; }, [query, handleAutocomplete]);
    const handleSelect = (s: SearchResult) => { setQuery(""); setSuggestions([]); setIsInputActive(false); const newHistory = [s, ...history.filter(h => h.name !== s.name)].slice(0, 5); updateHistory(newHistory); onSelectLocation(s); inputRef.current?.blur(); }
    const handleClearInput = (e: React.MouseEvent) => { e.stopPropagation(); setQuery(""); inputRef.current?.focus(); }
    const handleVoiceSearch = () => { /* Logic */ };
    const calcDist = (lat: number, lng: number) => { if(!userLocation) return null; return formatDistance(getDistanceFromLatLonInMeters(userLocation[1], userLocation[0], lat, lng)); }
    const showCard = isInputActive && ((query.length === 0 && history.length > 0) || suggestions.length > 0);

    if (isDrawerOpen && !isInputActive) return null; 

    return (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col pointer-events-none" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
            <div className={`flex justify-end gap-3 px-4 mb-3 pointer-events-auto transition-opacity duration-300 ${isInputActive ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                 <Button size="icon" onClick={onReportClick} className="h-11 w-11 rounded-full bg-yellow-500 border border-yellow-400 text-black shadow-xl hover:bg-yellow-400 animate-in zoom-in"><AlertTriangle className="h-5 w-5" /></Button>

                 {/* Consolidated Layers Menu */}
                 <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="icon" aria-label="Map Layers" className="h-11 w-11 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800"><Layers className="h-5 w-5" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="top" className="w-56 bg-[#18181b]/95 border-zinc-800 text-white backdrop-blur-xl mb-2 p-1.5 rounded-xl">
                        <DropdownMenuLabel className="text-xs text-zinc-500 uppercase tracking-wider">Map Style</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => handleStyleChange(STYLES.DARK)} className="cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800"><Layers className="mr-2 h-4 w-4" /> Dark {currentStyle === STYLES.DARK && <div className="ml-auto w-2 h-2 rounded-full bg-indigo-500" />}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStyleChange(STYLES.LIGHT)} className="cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800"><MapIcon className="mr-2 h-4 w-4" /> Street {currentStyle === STYLES.LIGHT && <div className="ml-auto w-2 h-2 rounded-full bg-indigo-500" />}</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleStyleChange(STYLES.SATELLITE)} className="cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800"><Satellite className="mr-2 h-4 w-4" /> Satellite {currentStyle === STYLES.SATELLITE && <div className="ml-auto w-2 h-2 rounded-full bg-indigo-500" />}</DropdownMenuItem>
                        
                        <DropdownMenuSeparator className="bg-zinc-800" />
                        <DropdownMenuLabel className="text-xs text-zinc-500 uppercase tracking-wider">Overlays</DropdownMenuLabel>
                        <DropdownMenuItem onClick={toggleTraffic} className="cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800"><Zap className="mr-2 h-4 w-4" /> Traffic {isTrafficVisible && <div className="ml-auto w-2 h-2 rounded-full bg-green-500" />}</DropdownMenuItem>
                        <DropdownMenuItem onClick={toggleRainMode} className="cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800"><CloudRain className="mr-2 h-4 w-4" /> Rain Radar {isRainMode && <div className="ml-auto w-2 h-2 rounded-full bg-blue-500" />}</DropdownMenuItem>
                        <DropdownMenuItem onClick={toggleWindMode} className="cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800"><Wind className="mr-2 h-4 w-4" /> Wind Map {isWindMode && <div className="ml-auto w-2 h-2 rounded-full bg-cyan-500" />}</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                 <Button size="icon" onClick={handleUserLocationClick} aria-label="My Location" className="h-11 w-11 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800"><Crosshair className="h-5 w-5" /></Button>
                
                {/* SAFETY BUTTON */}
                <Button size="icon" onClick={() => isSafetyModeActive ? showShareDialog() : startSafetyMode()} aria-label="Safety Share" className={`h-11 w-11 rounded-full border shadow-xl backdrop-blur-md transition-all ${isSafetyModeActive ? 'bg-red-600 border-red-500 text-white animate-pulse' : 'bg-zinc-900/80 border-zinc-700 text-zinc-300'}`}><Shield className="h-5 w-5" /></Button>

                {canShowAR && <Button size="icon" onClick={toggleAR} aria-label="Open AR" className="h-11 w-11 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800"><Camera className="h-5 w-5" /></Button>}
                <Button size="icon" className="h-11 w-11 rounded-full bg-zinc-900/80 backdrop-blur-md border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800" onClick={resetCompass} aria-label="Reset Compass"><Compass className="h-5 w-5" /></Button>
            </div>

            {/* Quick Action Chips */}
            <div className={`flex gap-2 overflow-x-auto no-scrollbar pointer-events-auto px-4 mb-3 transition-all duration-300 ease-out ${isInputActive || query.length > 0 ? 'opacity-0 translate-y-4 pointer-events-none h-0 mb-0' : 'opacity-100 translate-y-0 h-10'}`}>
                <Button onClick={() => handleCategorySearch("home")} className="rounded-full shadow-lg bg-zinc-900/80 backdrop-blur-md border border-zinc-700 px-4 h-10 text-xs font-medium shrink-0 hover:bg-zinc-800 text-white active:scale-95"><Home className="h-3.5 w-3.5 mr-2 text-indigo-400" /> Home</Button>
                <Button onClick={() => handleCategorySearch("work")} className="rounded-full shadow-lg bg-zinc-900/80 backdrop-blur-md border border-zinc-700 px-4 h-10 text-xs font-medium shrink-0 hover:bg-zinc-800 text-white active:scale-95"><Briefcase className="h-3.5 w-3.5 mr-2 text-blue-400" /> Work</Button>
                <Button onClick={() => handleCategorySearch("gas station")} className="rounded-full shadow-lg bg-zinc-900/80 backdrop-blur-md border border-zinc-700 px-4 h-10 text-xs font-medium shrink-0 hover:bg-zinc-800 text-white active:scale-95"><Fuel className="h-3.5 w-3.5 mr-2 text-orange-400" /> Gas</Button>
                <Button onClick={() => handleCategorySearch("bank")} className="rounded-full shadow-lg bg-zinc-900/80 backdrop-blur-md border border-zinc-700 px-4 h-10 text-xs font-medium shrink-0 hover:bg-zinc-800 text-white active:scale-95"><Banknote className="h-3.5 w-3.5 mr-2 text-emerald-400" /> ATM</Button>
                <Button onClick={() => handleCategorySearch("hospital")} className="rounded-full shadow-lg bg-zinc-900/80 backdrop-blur-md border border-zinc-700 px-4 h-10 text-xs font-medium shrink-0 hover:bg-zinc-800 text-white active:scale-95"><Stethoscope className="h-3.5 w-3.5 mr-2 text-red-400" /> Hospital</Button>
            </div>

            <div className="px-4 pointer-events-auto relative group">
                {isInputActive && <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[-1] animate-in fade-in" onClick={() => { setIsInputActive(false); inputRef.current?.blur(); }} />}
                {showCard && (
                    <Card className="absolute bottom-16 left-4 right-4 bg-[#18181b] border-zinc-800 shadow-2xl z-30 animate-in fade-in slide-in-from-bottom-4 duration-300 rounded-2xl overflow-hidden">
                        <CardContent className="p-0 max-h-[40dvh] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
                            {query.length === 0 && history.length > 0 && (
                                <div className="border-b border-white/5 transition-all duration-300">
                                    <div onClick={() => setIsHistoryExpanded(!isHistoryExpanded)} className="px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors bg-zinc-900/50 sticky top-0 backdrop-blur-md z-10">
                                        <div className="flex items-center gap-2"><History className="h-3.5 w-3.5 text-indigo-400" /><span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Recent History ({history.length})</span></div>
                                        {isHistoryExpanded ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
                                    </div>
                                    <div className={`overflow-hidden transition-all duration-300 ${isHistoryExpanded ? 'max-h-60 opacity-100' : 'max-h-0 opacity-0'}`}>
                                        {history.map((s, i) => (
                                            <div key={`hist-${i}`} onClick={() => handleSelect(s)} className="p-2.5 hover:bg-white/5 cursor-pointer transition-colors flex items-center gap-3 group relative pl-4 border-b border-white/5 last:border-0">
                                                <div className="bg-zinc-800/50 p-1.5 rounded-full shrink-0 group-hover:bg-zinc-700 transition-colors"><Clock className="h-3.5 w-3.5 text-zinc-400" /></div>
                                                <div className="min-w-0 flex-1 pr-8"><div className="text-sm font-medium text-zinc-200 truncate leading-tight">{s.name}</div><div className="text-[10px] text-zinc-500 truncate mt-0.5">{s.address}</div></div>
                                                <button onClick={(e) => removeFromHistory(e, s)} className="absolute right-2 p-2 rounded-full hover:bg-red-500/20 text-zinc-600 hover:text-red-400 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {suggestions.map((s, i) => (
                                <div key={i} onClick={() => handleSelect(s)} className="p-3 border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors flex items-center gap-3 group last:border-0">
                                    <div className="bg-zinc-800/80 p-2 rounded-full shrink-0 group-hover:bg-indigo-500/20 transition-colors"><MapPin className="h-4 w-4 text-zinc-400 group-hover:text-indigo-400" /></div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex justify-between items-center mb-0.5"><div className="text-sm font-semibold text-zinc-200 truncate pr-2"><HighlightMatch text={s.name} match={query} /></div>{calcDist(s.lat, s.lng) && <span className="text-[10px] font-bold bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded-md border border-indigo-500/20 shrink-0">{calcDist(s.lat, s.lng)}</span>}</div>
                                        <div className="text-xs text-zinc-500 truncate">{s.address}</div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-zinc-600 ml-auto shrink-0 group-hover:text-zinc-400" />
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                )}

                <div className="relative shadow-2xl transition-all duration-300 ease-out active:scale-[0.99]">
                    <Search className={`absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 transition-colors ${isSearching ? 'text-indigo-400' : 'text-zinc-400'}`} />
                    <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onFocus={() => setIsInputActive(true)} placeholder="ស្វែងរកទីតាំង, ហាង..." inputMode="search" className="w-full h-14 pl-12 pr-24 rounded-2xl bg-[#18181b]/80 backdrop-blur-xl border border-zinc-700 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-base shadow-inner transition-all focus:bg-[#18181b]" />
                    
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        {isSearching ? <Loader2 className="h-5 w-5 text-indigo-500 animate-spin mr-2" />
                        : query.length > 0 && <button onClick={handleClearInput} className="p-1.5 bg-zinc-800 rounded-full hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"><X className="h-3.5 w-3.5" /></button>}
                        <div className="h-8 w-[1px] bg-zinc-700 mx-1"></div>
                        <button onClick={handleVoiceSearch} className={`p-2 rounded-full transition-colors ${isListening ? 'bg-red-500/20 text-red-500 animate-pulse' : 'hover:bg-zinc-700 text-zinc-400'}`}><Mic className="h-5 w-5" /></button>
                    </div>
                </div>
            </div>
        </div>
    );
});
BottomControls.displayName = "BottomControls";