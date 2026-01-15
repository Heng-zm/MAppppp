'use client';

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { createClient } from '@supabase/supabase-js';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Loader2, ShieldCheck, Navigation, AlertTriangle } from 'lucide-react';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Fix: Use the key you provided earlier
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

// Initialize Supabase
const supabase = (SUPABASE_URL && SUPABASE_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_KEY) 
    : null;

export default function TrackTripPage({ params }: { params: { id: string } }) {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<mapboxgl.Map | null>(null);
    const marker = useRef<mapboxgl.Marker | null>(null);
    const [status, setStatus] = useState<'loading' | 'active' | 'ended' | 'error'>('loading');
    const [lastUpdate, setLastUpdate] = useState<string>('');

    // Unwrap params for Next.js 15+ compatibility (optional but good practice)
    // If you are on Next.js 14, standard params.id works fine.
    const tripId = params.id;

    useEffect(() => {
        if (!mapContainer.current || !supabase) return;

        // 1. Initialize Map
        map.current = new mapboxgl.Map({
            container: mapContainer.current,
            style: 'mapbox://styles/mapbox/dark-v11',
            center: [104.9282, 11.5564], // Default Phnom Penh
            zoom: 13,
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
            }
        };

        fetchInitialData();

        // 3. Subscribe to Live Updates
        const channel = supabase.channel(`tracking-${tripId}`)
            .on('postgres_changes', 
                { event: 'UPDATE', schema: 'public', table: 'active_trips', filter: `id=eq.${tripId}` }, 
                (payload) => {
                    const trip = payload.new;
                    console.log("Update received:", trip);
                    if (trip.status === 'ended') {
                        setStatus('ended');
                    } else {
                        updateMapPosition(trip.current_lng, trip.current_lat, trip.heading);
                        setLastUpdate(new Date().toLocaleTimeString());
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

        // Create Marker if not exists
        if (!marker.current) {
            const el = document.createElement('div');
            el.className = 'tracking-puck';
            el.innerHTML = `
                <div style="
                    width: 24px; height: 24px; 
                    background-color: #ef4444; 
                    border: 3px solid white; 
                    border-radius: 50%; 
                    box-shadow: 0 0 20px rgba(239, 68, 68, 0.6);
                "></div>
            `;
            marker.current = new mapboxgl.Marker({ element: el })
                .setLngLat([lng, lat])
                .addTo(map.current);
        } else {
            marker.current.setLngLat([lng, lat]);
        }

        // Smooth Fly to new location
        map.current.flyTo({
            center: [lng, lat],
            zoom: 16,
            bearing: heading || 0,
            duration: 1000, 
            essential: true
        });
    };

    if (status === 'error') {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-zinc-950 text-white p-6 text-center">
                <AlertTriangle className="h-16 w-16 text-red-500 mb-4" />
                <h1 className="text-2xl font-bold">Trip Not Found</h1>
                <p className="text-zinc-500 mt-2">Check the link or ask the driver to reshare.</p>
                <p className="text-xs text-zinc-700 mt-4">ID: {tripId}</p>
            </div>
        );
    }

    if (status === 'ended') {
        return (
            <div className="h-screen w-full flex flex-col items-center justify-center bg-zinc-950 text-white p-6 text-center">
                <ShieldCheck className="h-16 w-16 text-emerald-500 mb-4" />
                <h1 className="text-2xl font-bold">Trip Ended</h1>
                <p className="text-zinc-500 mt-2">The driver has arrived or stopped sharing.</p>
            </div>
        );
    }

    return (
        <div className="relative h-screen w-full bg-zinc-950 text-white">
            <div ref={mapContainer} className="absolute inset-0 z-0" />

            {/* Header Overlay */}
            <div className="absolute top-4 left-4 right-4 z-10">
                <div className="bg-zinc-900/90 backdrop-blur-md border border-zinc-700 p-4 rounded-2xl flex items-center gap-4 shadow-2xl">
                    <div className="h-12 w-12 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse shrink-0">
                        <Navigation className="text-red-500 h-6 w-6" />
                    </div>
                    <div>
                        <h3 className="font-bold text-lg leading-none mb-1">Live Tracking</h3>
                        <p className="text-xs text-zinc-400">
                            {status === 'loading' ? 'Connecting to satellite...' : `Updated: ${lastUpdate || 'Just now'}`}
                        </p>
                    </div>
                </div>
            </div>

            {/* Loading Overlay */}
            {status === 'loading' && (
                <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
                    <div className="flex flex-col items-center">
                        <Loader2 className="h-10 w-10 text-red-500 animate-spin mb-4" />
                        <p className="text-sm uppercase tracking-widest text-zinc-500">Connecting...</p>
                    </div>
                </div>
            )}
        </div>
    );
}