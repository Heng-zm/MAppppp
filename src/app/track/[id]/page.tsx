'use client';

import { useEffect, useRef, useState, use } from 'react';
import mapboxgl from 'mapbox-gl';
import { createClient } from '@supabase/supabase-js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { 
  Loader2, ShieldCheck, Navigation, AlertTriangle, 
  Clock, Map as MapIcon, Phone, Share2, Star, 
  CarFront, LocateFixed, ChevronRight 
} from 'lucide-react';
import { Button } from "@/components/ui/button"; // Assuming you have shadcn/ui or use standard buttons

// 1. CONFIGURATION
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Mock Driver Data (You would normally fetch this from DB)
const DRIVER_INFO = {
    name: "Sokha",
    rating: 4.9,
    trips: 1240,
    car: "Toyota Prius (White)",
    plate: "2B-9981"
};

export default function TrackTripPage({ params }: { params: Promise<{ id: string }> }) {
    const { id: tripId } = use(params);

    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const marker = useRef<mapboxgl.Marker | null>(null);
    
    // State
    const [status, setStatus] = useState<'loading' | 'active' | 'ended' | 'error'>('loading');
    const [lastUpdate, setLastUpdate] = useState<string>('');
    const [tokenError, setTokenError] = useState(false);
    const [isUserInteracting, setIsUserInteracting] = useState(false);
    const [currentLocation, setCurrentLocation] = useState<[number, number] | null>(null);

    // Helper: Add 3D Buildings Layer
    const add3DBuildings = (mapInstance: mapboxgl.Map) => {
        const layers = mapInstance.getStyle().layers;
        const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;

        if (!mapInstance.getLayer('3d-buildings')) {
            mapInstance.addLayer({
                'id': '3d-buildings',
                'source': 'composite',
                'source-layer': 'building',
                'filter': ['==', 'extrude', 'true'],
                'type': 'fill-extrusion',
                'minzoom': 15,
                'paint': {
                    'fill-extrusion-color': '#2a2a2e',
                    'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'height']],
                    'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.05, ['get', 'min_height']],
                    'fill-extrusion-opacity': 0.6
                }
            }, labelLayerId);
        }
    };

    useEffect(() => {
        if (!MAPBOX_TOKEN) { setTokenError(true); return; }
        if (!mapContainer.current || !supabase || !tripId) return;
        if (map.current) return;

        try {
            map.current = new mapboxgl.Map({
                container: mapContainer.current,
                style: 'mapbox://styles/mapbox/dark-v11', // or 'mapbox://styles/mapbox/navigation-night-v1'
                center: [104.9282, 11.5564],
                zoom: 13,
                pitch: 60, // Steeper pitch for 3D effect
                bearing: 0,
                projection: 'globe', // Globe view when zoomed out
                attributionControl: false,
                logoPosition: 'top-right'
            });

            // Add Atmosphere (Fog/Sky)
            map.current.on('style.load', () => {
                if (!map.current) return;
                map.current.setFog({
                    'color': 'rgb(24, 24, 27)', // Match Zinc-950
                    'high-color': 'rgb(39, 39, 42)', 
                    'horizon-blend': 0.2, 
                    'space-color': 'rgb(24, 24, 27)'
                });
                add3DBuildings(map.current);
            });

            // Detect user interaction (to stop auto-centering)
            const stopAutoFollow = () => setIsUserInteracting(true);
            map.current.on('mousedown', stopAutoFollow);
            map.current.on('touchstart', stopAutoFollow);
            map.current.on('wheel', stopAutoFollow);
            map.current.on('dragstart', stopAutoFollow);

        } catch (e) { console.error("Init Error", e); }

        // Data Fetching Logic
        const processUpdate = (lng: number, lat: number, heading: number) => {
            setCurrentLocation([lng, lat]);
            updateMapPosition(lng, lat, heading);
            setLastUpdate(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        };

        const fetchInitialData = async () => {
            const { data, error } = await supabase.from('active_trips').select('*').eq('id', tripId).single();
            if (error || !data) setStatus('error');
            else if (data.status === 'ended') setStatus('ended');
            else {
                setStatus('active');
                processUpdate(data.current_lng, data.current_lat, data.heading);
            }
        };

        fetchInitialData();

        const channel = supabase.channel(`tracking-${tripId}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'active_trips', filter: `id=eq.${tripId}` }, 
                (payload) => {
                    const trip = payload.new as any;
                    if (trip.status === 'ended') setStatus('ended');
                    else processUpdate(trip.current_lng, trip.current_lat, trip.heading);
                }
            ).subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [tripId]);

    const updateMapPosition = (lng: number, lat: number, heading: number) => {
        if (!map.current) return;

        // 1. Update Marker
        if (!marker.current) {
            const el = document.createElement('div');
            el.className = 'tracking-puck';
            // Custom Car Icon or Puck
            el.innerHTML = `
                <div class="relative flex items-center justify-center transform transition-transform duration-500">
                    <div class="w-12 h-12 bg-indigo-500/30 rounded-full animate-pulse absolute"></div>
                    <div class="w-4 h-4 bg-white rounded-full border-[3px] border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)] z-10 relative"></div>
                    <div class="absolute -top-8 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap opacity-90">
                        ${DRIVER_INFO.plate}
                    </div>
                </div>
            `;
            marker.current = new mapboxgl.Marker({ element: el, pitchAlignment: 'map' })
                .setLngLat([lng, lat])
                .addTo(map.current);
        } else {
            marker.current.setLngLat([lng, lat]);
        }

        // 2. Camera Follow (Only if user hasn't panned away)
        if (!isUserInteracting) {
            map.current.easeTo({
                center: [lng, lat],
                zoom: 17,
                bearing: heading || 0,
                pitch: 60,
                duration: 1000, 
                padding: { top: 0, bottom: 200, left: 0, right: 0 } // Offset for bottom card
            });
        }
    };

    const handleRecenter = () => {
        setIsUserInteracting(false);
        if (currentLocation && map.current) {
            map.current.flyTo({
                center: currentLocation,
                zoom: 17,
                pitch: 60,
                duration: 1500
            });
        }
    };

    // --- RENDER STATES ---

    if (tokenError) return <ErrorScreen title="Config Error" desc="Mapbox Token missing." icon={<AlertTriangle className="h-12 w-12 text-yellow-500" />} />;
    if (status === 'error') return <ErrorScreen title="Link Expired" desc="This tracking link is invalid." icon={<AlertTriangle className="h-12 w-12 text-red-500" />} />;
    if (status === 'ended') return <ErrorScreen title="Arrived" desc="The driver has completed the trip." icon={<ShieldCheck className="h-12 w-12 text-emerald-500" />} />;

    return (
        <div className="relative h-[100dvh] w-full bg-zinc-950 text-white overflow-hidden font-sans">
            {/* MAP CONTAINER */}
            <div ref={mapContainer} className="absolute inset-0 z-0" style={{ width: '100%', height: '100%' }} />

            {/* TOP BAR: Status Pill */}
            <div className="absolute top-0 left-0 right-0 z-10 p-4 safe-top flex justify-center">
                <div className="bg-black/60 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-full flex items-center gap-3 shadow-2xl animate-in slide-in-from-top-4">
                    <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                        </span>
                        <span className="text-xs font-bold uppercase tracking-wider text-indigo-100">Live Trip</span>
                    </div>
                    <div className="w-[1px] h-3 bg-white/20"></div>
                    <div className="flex items-center gap-1.5 text-zinc-400">
                        <Clock className="h-3 w-3" />
                        <span className="text-xs tabular-nums">{lastUpdate || '--:--'}</span>
                    </div>
                </div>
            </div>

            {/* RECENTER BUTTON (Visible only when user interacts) */}
            {isUserInteracting && (
                <div className="absolute bottom-64 right-4 z-20 animate-in zoom-in">
                    <button 
                        onClick={handleRecenter}
                        className="bg-white text-indigo-600 p-3 rounded-full shadow-xl shadow-black/50 border border-white/20 active:scale-95 transition-transform"
                    >
                        <LocateFixed className="h-6 w-6" />
                    </button>
                </div>
            )}

            {/* BOTTOM SHEET: Driver Info */}
            <div className="absolute bottom-0 left-0 right-0 z-20 p-4 safe-bottom">
                <div className="bg-[#18181b]/90 backdrop-blur-xl border-t border-white/10 rounded-3xl p-5 shadow-[0_-10px_40px_rgba(0,0,0,0.6)] animate-in slide-in-from-bottom-10 duration-500">
                    
                    {/* Driver Header */}
                    <div className="flex items-center gap-4 mb-6">
                        <div className="relative">
                            <div className="h-14 w-14 rounded-full bg-zinc-700 border-2 border-white/10 overflow-hidden flex items-center justify-center">
                                <span className="text-lg font-bold text-zinc-400">IM</span>
                            </div>
                            <div className="absolute -bottom-1 -right-1 bg-white text-black text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 shadow-sm">
                                <Star className="h-2 w-2 fill-current" /> {DRIVER_INFO.rating}
                            </div>
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-bold text-white">{DRIVER_INFO.name}</h3>
                            <div className="flex items-center gap-2 text-sm text-zinc-400">
                                <span className="bg-indigo-500/20 text-indigo-300 px-1.5 rounded text-xs font-medium border border-indigo-500/20">{DRIVER_INFO.plate}</span>
                                <span>•</span>
                                <span className="truncate">{DRIVER_INFO.car}</span>
                            </div>
                        </div>
                        <div className="h-10 w-10 bg-zinc-800 rounded-full flex items-center justify-center">
                            <CarFront className="h-5 w-5 text-zinc-400" />
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-3">
                        <button className="h-12 bg-white text-black font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-zinc-200 transition-colors active:scale-[0.98]">
                            <Phone className="h-4 w-4" /> Call Driver
                        </button>
                        <button className="h-12 bg-zinc-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 border border-zinc-700 hover:bg-zinc-700 transition-colors active:scale-[0.98]">
                            <Share2 className="h-4 w-4" /> Share Trip
                        </button>
                    </div>

                    {/* Footer */}
                    <div className="mt-6 flex items-center justify-center gap-2 opacity-30">
                        <ShieldCheck className="h-3 w-3" />
                        <span className="text-[10px] uppercase tracking-widest font-bold">Secure Tracking Active</span>
                    </div>
                </div>
            </div>

            {/* LOADING STATE */}
            {status === 'loading' && (
                <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-md flex items-center justify-center z-50">
                    <div className="flex flex-col items-center gap-4">
                        <div className="relative">
                            <div className="h-16 w-16 rounded-full border-4 border-indigo-500/30 animate-spin border-t-indigo-500"></div>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Navigation className="h-6 w-6 text-indigo-500 fill-indigo-500" />
                            </div>
                        </div>
                        <p className="text-xs font-bold uppercase tracking-widest text-indigo-300 animate-pulse">Locating Satellite...</p>
                    </div>
                </div>
            )}
        </div>
    );
}

// Simple Error Component
const ErrorScreen = ({ title, desc, icon }: { title: string, desc: string, icon: any }) => (
    <div className="h-[100dvh] w-full flex flex-col items-center justify-center bg-zinc-950 text-white p-8 text-center">
        <div className="bg-zinc-900 p-6 rounded-full mb-6 border border-zinc-800 shadow-2xl animate-bounce-slow">
            {icon}
        </div>
        <h1 className="text-2xl font-bold mb-2 bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent">{title}</h1>
        <p className="text-zinc-500 max-w-xs leading-relaxed">{desc}</p>
    </div>
);