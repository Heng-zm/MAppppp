'use client';

import { useEffect, useRef, useState, use } from 'react';
import mapboxgl from 'mapbox-gl';
import { createClient } from '@supabase/supabase-js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Loader2, ShieldCheck, Navigation, AlertTriangle, Clock } from 'lucide-react';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

const supabase = (SUPABASE_URL && SUPABASE_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_KEY) 
    : null;

// Next.js 15+ compatible props
export default function TrackTripPage({ params }: { params: Promise<{ id: string }> }) {
    // Unwrap params for new Next.js versions
    const { id: tripId } = use(params);

    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const marker = useRef<mapboxgl.Marker | null>(null);
    const [status, setStatus] = useState<'loading' | 'active' | 'ended' | 'error'>('loading');
    const [lastUpdate, setLastUpdate] = useState<string>('');

    useEffect(() => {
        if (!mapContainer.current || !supabase || !tripId) return;

        // 1. Initialize Map
        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/dark-v11', // Dark mode by default
            center: [104.9282, 11.5564], // Default Phnom Penh
            zoom: 13,
            pitch: 45, // Slight 3D tilt
            interactive: true,
            attributionControl: false
        });

        // 2. Fetch Initial Trip Data
        const fetchInitialData = async () => {
            console.log("Fetching trip:", tripId);
            const { data, error } = await supabase
                .from('active_trips')
                .select('*')
                .eq('id', tripId)
                .single();

            if (error || !data) {
                console.error("Supabase Error:", error);
                setStatus('error');
            } else if (data.status === 'ended') {
                setStatus('ended');
            } else {
                setStatus('active');
                updateMapPosition(data.current_lng, data.current_lat, data.heading);
                setLastUpdate(new Date(data.last_updated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            }
        };

        fetchInitialData();

        // 3. Subscribe to Live Updates
        const channel = supabase.channel(`tracking-${tripId}`)
            .on('postgres_changes', 
                { event: 'UPDATE', schema: 'public', table: 'active_trips', filter: `id=eq.${tripId}` }, 
                (payload) => {
                    const trip = payload.new;
                    if (trip.status === 'ended') {
                        setStatus('ended');
                    } else {
                        updateMapPosition(trip.current_lng, trip.current_lat, trip.heading);
                        setLastUpdate(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            map.current?.remove();
        };
    }, [tripId]);

    const updateMapPosition = (lng: number, lat: number, heading: number) => {
        if (!map.current) return;

        // Create Custom Marker (Animated Puck)
        if (!marker.current) {
            const el = document.createElement('div');
            el.className = 'tracking-puck';
            el.innerHTML = `
                <div style="position: relative; display: flex; align-items: center; justify-content: center;">
                    <div style="width: 20px; height: 20px; background: #ef4444; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 20px rgba(239, 68, 68, 0.8); z-index: 2;"></div>
                    <div style="position: absolute; width: 60px; height: 60px; background: rgba(239, 68, 68, 0.3); border-radius: 50%; animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
                </div>
                <style>
                    @keyframes ping {
                        75%, 100% { transform: scale(2); opacity: 0; }
                    }
                </style>
            `;
            marker.current = new mapboxgl.Marker({ element: el })
                .setLngLat([lng, lat])
                .addTo(map.current);
        } else {
            // Smoothly move marker
            marker.current.setLngLat([lng, lat]);
        }

        // Smooth Fly to new location
        map.current.easeTo({
            center: [lng, lat],
            zoom: 17,
            bearing: heading || 0,
            pitch: 50,
            duration: 1000, 
            essential: true
        });
    };

    if (status === 'error') {
        return (
            <div className="h-[100dvh] w-full flex flex-col items-center justify-center bg-zinc-950 text-white p-6 text-center">
                <div className="bg-red-500/10 p-6 rounded-full mb-6 border border-red-500/20">
                    <AlertTriangle className="h-12 w-12 text-red-500" />
                </div>
                <h1 className="text-2xl font-bold mb-2">Trip Not Found</h1>
                <p className="text-zinc-500 max-w-xs">The tracking link might be expired or invalid. Please ask the driver to share a new link.</p>
            </div>
        );
    }

    if (status === 'ended') {
        return (
            <div className="h-[100dvh] w-full flex flex-col items-center justify-center bg-zinc-950 text-white p-6 text-center">
                <div className="bg-emerald-500/10 p-6 rounded-full mb-6 border border-emerald-500/20">
                    <ShieldCheck className="h-12 w-12 text-emerald-500" />
                </div>
                <h1 className="text-2xl font-bold mb-2">Trip Completed</h1>
                <p className="text-zinc-500 max-w-xs">The driver has arrived at their destination or stopped sharing their location.</p>
            </div>
        );
    }

    return (
        <div className="relative h-[100dvh] w-full bg-zinc-950 text-white overflow-hidden">
            <div ref={mapContainer} className="absolute inset-0 z-0" />

            {/* Floating Info Card */}
            <div className="absolute top-4 left-4 right-4 z-10 safe-top">
                <div className="bg-zinc-900/80 backdrop-blur-xl border border-white/10 p-4 rounded-2xl flex items-center gap-4 shadow-2xl animate-in slide-in-from-top-4 duration-500">
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-lg shadow-red-500/20 shrink-0">
                        <Navigation className="text-white h-6 w-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                            </span>
                            <h3 className="font-bold text-lg leading-none tracking-tight">Live Tracking</h3>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 text-zinc-400">
                            <Clock className="h-3 w-3" />
                            <p className="text-xs font-medium">
                                {status === 'loading' ? 'Connecting...' : `Last updated: ${lastUpdate || 'Just now'}`}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Loading Overlay */}
            {status === 'loading' && (
                <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-10 w-10 text-red-500 animate-spin" />
                        <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Connecting Satellite...</p>
                    </div>
                </div>
            )}
            
            {/* Watermark / Brand */}
            <div className="absolute bottom-6 w-full text-center pointer-events-none safe-bottom">
                <span className="text-[10px] font-bold text-zinc-500/50 uppercase tracking-widest">Secure Tracking Active</span>
            </div>
        </div>
    );
}