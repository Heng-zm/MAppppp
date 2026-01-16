'use client';

import { useEffect, useRef, useState, use, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { createClient } from '@supabase/supabase-js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { 
  Loader2, ShieldCheck, AlertTriangle, 
  Phone, Share2, Star, 
  CarFront, LocateFixed, Gauge, Radio
} from 'lucide-react';

// --- CONFIGURATION ---
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

// Safe Client Initialization
const supabase = (SUPABASE_URL && SUPABASE_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_KEY) 
    : null;

// --- MATH HELPERS ---
const lerp = (start: number, end: number, t: number) => start * (1 - t) + end * t;

const lerpAngle = (current: number, target: number, t: number) => {
    let delta = ((target - current + 540) % 360) - 180;
    return (current + delta * t + 360) % 360;
};

const getBearing = (startLat: number, startLng: number, destLat: number, destLng: number) => {
  const startLatRad = startLat * (Math.PI / 180);
  const startLngRad = startLng * (Math.PI / 180);
  const destLatRad = destLat * (Math.PI / 180);
  const destLngRad = destLng * (Math.PI / 180);

  const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
  const x = Math.cos(startLatRad) * Math.sin(destLatRad) -
        Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);
  const brng = Math.atan2(y, x);
  return ((brng * 180 / Math.PI) + 360) % 360;
};

// --- MOCK DRIVER DATA ---
const DRIVER_INFO = {
    name: "Sokha",
    rating: 4.98,
    car: "Toyota Prius (White)",
    plate: "2B-9981",
    trips: 1250
};

export default function TrackingPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: tripId } = use(params);

    // --- REFS ---
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const marker = useRef<mapboxgl.Marker | null>(null);
    const markerEl = useRef<HTMLDivElement | null>(null);
    const destinationMarker = useRef<mapboxgl.Marker | null>(null);
    const isMapLoaded = useRef(false);
    
    // Animation Refs
    const currentPos = useRef<[number, number]>([104.9282, 11.5564]); 
    const targetPos = useRef<[number, number]>([104.9282, 11.5564]);
    const currentBearing = useRef<number>(0);
    const targetBearing = useRef<number>(0);
    const animationFrameId = useRef<number>(0);
    const isUserInteractingRef = useRef(false);

    // --- STATE ---
    const [status, setStatus] = useState<'loading' | 'active' | 'ended' | 'error'>('loading');
    const [errorMsg, setErrorMsg] = useState('');
    const [showRecenterBtn, setShowRecenterBtn] = useState(false);
    const [trailCoordinates, setTrailCoordinates] = useState<number[][]>([]);
    const [currentSpeed, setCurrentSpeed] = useState(0);
    const [isPulsing, setIsPulsing] = useState(false);

    // --- 1. ANIMATION LOOP ---
    const animate = useCallback(() => {
        // Stop animation if map/marker destroyed or component unmounted
        if (!map.current || !marker.current) {
            // Only request next frame if map is expected to be loaded
            if (status === 'active' || status === 'loading') {
                 animationFrameId.current = requestAnimationFrame(animate);
            }
            return;
        }

        // Interpolate Position
        const lng = lerp(currentPos.current[0], targetPos.current[0], 0.08);
        const lat = lerp(currentPos.current[1], targetPos.current[1], 0.08);
        
        // Interpolate Bearing
        const newBearing = lerpAngle(currentBearing.current, targetBearing.current, 0.05);

        // Update Refs
        currentPos.current = [lng, lat];
        currentBearing.current = newBearing;

        // Update Marker UI
        marker.current.setLngLat([lng, lat]);
        if (markerEl.current) {
            markerEl.current.style.transform = `rotate(${newBearing}deg)`;
        }

        // Camera Follow
        if (!isUserInteractingRef.current) {
            map.current.easeTo({
                center: [lng, lat],
                bearing: newBearing, 
                pitch: 50,
                padding: { top: 0, bottom: 250, left: 0, right: 0 },
                duration: 0 
            });
        }

        animationFrameId.current = requestAnimationFrame(animate);
    }, [status]);

    // --- 2. DATA HANDLER ---
    const handleNewLocationPacket = useCallback((lng: number, lat: number, heading?: number, speed?: number) => {
        setIsPulsing(true);
        setTimeout(() => setIsPulsing(false), 1000);

        if (speed !== undefined) setCurrentSpeed(Math.round(speed * 3.6));

        // Calculate distance from last target
        const dist = Math.sqrt(Math.pow(lng - targetPos.current[0], 2) + Math.pow(lat - targetPos.current[1], 2));
        
        // Only update bearing if moving
        let finalBearing = targetBearing.current;
        if (dist > 0.00002) {
             const calculatedBearing = getBearing(targetPos.current[1], targetPos.current[0], lat, lng);
             finalBearing = (heading && heading !== 0) ? heading : calculatedBearing;
        }

        targetPos.current = [lng, lat];
        targetBearing.current = finalBearing;

        setTrailCoordinates(prev => [...prev, [lng, lat]].slice(-50));
    }, []);

    // --- 3. INITIALIZATION & CONNECTION ---
    useEffect(() => {
        // CRITICAL CHECK: Env vars
        if (!supabase) {
            console.error("❌ Supabase client missing. Check NEXT_PUBLIC_SUPABASE_URL and KEY.");
            setStatus('error');
            setErrorMsg("Service Unavailable (Config Error)");
            return;
        }

        // 1. Setup Map
        if (!map.current && mapContainer.current) {
            try {
                map.current = new mapboxgl.Map({
                    container: mapContainer.current,
                    style: 'mapbox://styles/mapbox/navigation-night-v1', 
                    center: currentPos.current,
                    zoom: 15,
                    pitch: 50,
                    attributionControl: false,
                    logoPosition: 'top-left',
                    cooperativeGestures: true
                });

                // Interaction Listeners
                const startInteraction = () => { isUserInteractingRef.current = true; setShowRecenterBtn(true); };
                map.current.on('mousedown', startInteraction);
                map.current.on('touchstart', startInteraction);
                map.current.on('dragstart', startInteraction);

                map.current.on('load', () => {
                    if (!map.current) return;
                    isMapLoaded.current = true;

                    // 3D Buildings Layer
                    const layers = map.current.getStyle().layers;
                    const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;
                    if (!map.current.getLayer('3d-buildings')) {
                        map.current.addLayer({
                            'id': '3d-buildings',
                            'source': 'composite',
                            'source-layer': 'building',
                            'filter': ['==', 'extrude', 'true'],
                            'type': 'fill-extrusion',
                            'minzoom': 14,
                            'paint': {
                                'fill-extrusion-color': '#27272a',
                                'fill-extrusion-height': ['get', 'height'],
                                'fill-extrusion-base': ['get', 'min_height'],
                                'fill-extrusion-opacity': 0.8
                            }
                        }, labelLayerId);
                    }

                    // Trail Layer
                    map.current.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }, lineMetrics: true });
                    map.current.addLayer({
                        id: 'route',
                        type: 'line',
                        source: 'route',
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: {
                            'line-color': '#6366f1',
                            'line-width': 6,
                            'line-opacity': 0.8,
                            'line-gradient': [ 'interpolate', ['linear'], ['line-progress'], 0, "rgba(99, 102, 241, 0)", 0.2, "#818cf8", 1, "#ffffff" ]
                        }
                    }, '3d-buildings');
                });

                // Car Marker
                const el = document.createElement('div');
                el.className = 'car-marker-container';
                el.innerHTML = `<div id="car-rotator" style="transition: transform 0.1s linear; will-change: transform;"><div class="relative"><div class="absolute inset-0 bg-indigo-500/40 blur-xl rounded-full"></div><div class="relative w-12 h-12 bg-zinc-100 rounded-full border-2 border-indigo-600 shadow-2xl flex items-center justify-center z-10"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /></svg></div><div class="absolute -top-3 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[8px] border-b-indigo-500"></div></div></div>`;
                markerEl.current = el.querySelector('#car-rotator');
                marker.current = new mapboxgl.Marker({ element: el }).setLngLat(currentPos.current).addTo(map.current);

                // Start Animation
                animationFrameId.current = requestAnimationFrame(animate);
            } catch (e) {
                console.error("Mapbox Init Error:", e);
            }
        }

        // 2. Fetch Initial Data
        const fetchDataAndSubscribe = async () => {
            console.log("🔍 Fetching trip:", tripId);
            
            // Initial Fetch
            const { data, error } = await supabase
                .from('active_trips')
                .select('*')
                .eq('id', tripId)
                .single();
            
            if (error) {
                console.error("Supabase Error:", error);
                setStatus('error');
                if (error.code === 'PGRST116') setErrorMsg("Trip not found");
                else if (error.code === '401') setErrorMsg("Unauthorized Access");
                else setErrorMsg(error.message);
                return;
            }

            if (!data) {
                setStatus('error');
                setErrorMsg("No data returned for this ID");
                return;
            }

            if (data.status === 'ended') {
                setStatus('ended');
                return;
            }
            
            setStatus('active');
            
            // Set initial position
            currentPos.current = [data.current_lng, data.current_lat];
            targetPos.current = [data.current_lng, data.current_lat];
            currentBearing.current = data.heading || 0;
            targetBearing.current = data.heading || 0;
            if (data.speed) setCurrentSpeed(Math.round(data.speed * 3.6));

            // Plot Destination if available
            if (map.current && data.dest_lat && data.dest_lng) {
                if (!destinationMarker.current) {
                    const destEl = document.createElement('div');
                    destEl.innerHTML = `<div class="w-8 h-8 bg-red-500 rounded-full border-2 border-white shadow-lg flex items-center justify-center animate-bounce"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></div>`;
                    destinationMarker.current = new mapboxgl.Marker({ element: destEl }).setLngLat([data.dest_lng, data.dest_lat]).addTo(map.current);
                }
                const bounds = new mapboxgl.LngLatBounds().extend([data.current_lng, data.current_lat]).extend([data.dest_lng, data.dest_lat]);
                map.current.fitBounds(bounds, { padding: 100, animate: false });
            } else if (map.current) {
                map.current.jumpTo({ center: currentPos.current, zoom: 16 });
            }

            // 3. Subscribe to Realtime
            const channel = supabase.channel(`tracking-${tripId}`)
                .on('postgres_changes', 
                    { event: 'UPDATE', schema: 'public', table: 'active_trips', filter: `id=eq.${tripId}` }, 
                    (payload) => {
                        const trip = payload.new as any;
                        if (trip.status === 'ended') setStatus('ended');
                        else handleNewLocationPacket(trip.current_lng, trip.current_lat, trip.heading, trip.speed);
                    }
                )
                .subscribe();

            return () => {
                supabase.removeChannel(channel);
            };
        };

        const cleanupSubscription = fetchDataAndSubscribe();

        return () => {
            if (cleanupSubscription && typeof cleanupSubscription === 'function') {
                // @ts-ignore
                cleanupSubscription.then(cleanup => cleanup && cleanup());
            }
            cancelAnimationFrame(animationFrameId.current);
            if(map.current) map.current.remove();
        };

    }, [tripId, handleNewLocationPacket, animate]);

    // --- TRAIL UPDATE ---
    useEffect(() => {
        if (!map.current || !isMapLoaded.current || trailCoordinates.length < 2) return;
        const source = map.current.getSource('route') as mapboxgl.GeoJSONSource;
        if (source) source.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trailCoordinates } });
    }, [trailCoordinates]);

    const handleRecenter = () => {
        isUserInteractingRef.current = false;
        setShowRecenterBtn(false);
        map.current?.flyTo({ center: currentPos.current, bearing: targetBearing.current, pitch: 50, zoom: 17, duration: 1000 });
    };

    if (status === 'error') return <ErrorScreen title="Connection Failed" desc={errorMsg || "Could not load trip details."} />;
    if (status === 'ended') return <ErrorScreen title="Arrived" desc="The driver has completed this trip." icon={<ShieldCheck className="h-16 w-16 text-emerald-500 mb-4"/>} />;

    return (
        <div className="relative h-[100dvh] w-full bg-zinc-950 text-white overflow-hidden font-sans">
            <div ref={mapContainer} className="absolute inset-0 z-0" style={{ width: '100%', height: '100%' }} />

            {/* HEADER OVERLAY */}
            <div className="absolute top-0 left-0 right-0 z-10 p-4 pt-[max(1rem,env(safe-area-inset-top))] flex justify-center pointer-events-none">
                <div className="bg-[#09090b]/80 backdrop-blur-xl border border-white/10 px-5 py-2.5 rounded-full flex items-center gap-4 shadow-2xl animate-in slide-in-from-top-4 duration-700">
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-2.5 w-2.5">
                          {isPulsing && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        </span>
                        <span className="text-xs font-bold uppercase tracking-widest text-emerald-100">Live</span>
                    </div>
                    <div className="w-[1px] h-4 bg-white/10"></div>
                    <div className="flex items-center gap-2 text-zinc-300">
                         {currentSpeed > 0 ? (
                             <>
                                <Gauge className="h-3.5 w-3.5 text-indigo-400" />
                                <span className="text-xs font-mono font-bold">{currentSpeed} <span className="text-[10px] text-zinc-500">km/h</span></span>
                             </>
                         ) : (
                             <span className="text-xs font-mono flex items-center gap-1"><Radio className="h-3 w-3" /> Standby</span>
                         )}
                    </div>
                </div>
            </div>

            {/* RECENTER BUTTON */}
            {showRecenterBtn && (
                <div className="absolute bottom-64 right-4 z-20 animate-in zoom-in duration-300">
                    <button 
                        onClick={handleRecenter}
                        className="bg-white text-indigo-600 h-14 w-14 rounded-full shadow-[0_0_20px_rgba(0,0,0,0.3)] flex items-center justify-center hover:bg-zinc-50 transition-transform active:scale-90 border-2 border-indigo-100"
                    >
                        <LocateFixed className="h-6 w-6" />
                    </button>
                </div>
            )}

            {/* DRIVER CARD */}
            <div className="absolute bottom-0 left-0 right-0 z-20 pb-[max(1rem,env(safe-area-inset-bottom))] px-4">
                <div className="bg-[#18181b]/95 backdrop-blur-xl rounded-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.8)] border border-white/5 p-5 animate-in slide-in-from-bottom-full duration-500 ring-1 ring-white/10">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-4">
                            <div className="relative">
                                <div className="h-14 w-14 rounded-full bg-gradient-to-br from-zinc-700 to-zinc-800 p-[2px] ring-2 ring-black/50">
                                    <div className="h-full w-full rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden">
                                        <span className="text-lg font-bold text-zinc-400">{DRIVER_INFO.name[0]}</span>
                                    </div>
                                </div>
                                <div className="absolute -bottom-1 -right-1 bg-white text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5 shadow-lg border border-zinc-200">
                                    <Star className="h-2 w-2 fill-black" /> {DRIVER_INFO.rating}
                                </div>
                            </div>
                            
                            <div>
                                <h2 className="text-lg font-bold text-white leading-tight">{DRIVER_INFO.name}</h2>
                                <p className="text-zinc-400 text-xs mb-1.5">{DRIVER_INFO.car}</p>
                                <div className="flex items-center gap-2">
                                    <span className="bg-zinc-800 text-zinc-300 text-[10px] font-mono px-1.5 py-0.5 rounded border border-zinc-700">{DRIVER_INFO.plate}</span>
                                    <span className="text-[10px] text-zinc-500">• {DRIVER_INFO.trips} trips</span>
                                </div>
                            </div>
                        </div>
                        <div className="h-10 w-10 bg-indigo-500/10 rounded-full flex items-center justify-center border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.3)]">
                            <CarFront className="h-5 w-5 text-indigo-400" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                        <button className="h-12 bg-white hover:bg-zinc-200 text-black font-bold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg">
                            <Phone className="h-4 w-4" /> Call Driver
                        </button>
                        <button className="h-12 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-xl flex items-center justify-center gap-2 border border-zinc-700 transition-all active:scale-[0.98]">
                            <Share2 className="h-4 w-4" /> Share Trip
                        </button>
                    </div>
                    <div className="flex items-center justify-center gap-2 opacity-30 pt-2 border-t border-white/5">
                        <ShieldCheck className="h-3 w-3" />
                        <span className="text-[10px] uppercase tracking-widest font-bold">Secure Tracking Active</span>
                    </div>
                </div>
            </div>

            {status === 'loading' && (
                <div className="absolute inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-50">
                    <div className="flex flex-col items-center gap-4 animate-pulse">
                        <Loader2 className="h-12 w-12 text-indigo-500 animate-spin" />
                        <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Connecting Satellite...</p>
                    </div>
                </div>
            )}
        </div>
    );
}

const ErrorScreen = ({ title, desc, icon }: { title: string, desc?: string, icon?: any }) => (
    <div className="h-[100dvh] w-full flex flex-col items-center justify-center bg-zinc-950 text-white p-6 text-center">
        <div className="bg-zinc-900/50 p-8 rounded-full mb-6 border border-zinc-800 animate-in zoom-in duration-500">
            {icon || <AlertTriangle className="h-12 w-12 text-red-500" />}
        </div>
        <h1 className="text-2xl font-bold mb-2">{title}</h1>
        {desc && <p className="text-zinc-500 max-w-xs">{desc}</p>}
    </div>
);