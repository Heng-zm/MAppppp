'use client';

// ==========================================
// 1. IMPORTS
// ==========================================
import React, { useEffect, useRef, useState } from 'react';
import mapboxgl, { Map as MapboxMap, Marker } from 'mapbox-gl';
import { createClient } from '@supabase/supabase-js';
import { useParams } from 'next/navigation';
import { Kantumruy_Pro } from 'next/font/google';
import 'mapbox-gl/dist/mapbox-gl.css';

// Icons
import { 
  Clock, MapPin, AlertCircle, 
  LocateFixed, Share2, Loader2, Navigation, User, ArrowLeft
} from 'lucide-react';

// UI Components
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

// ==========================================
// 2. CONFIGURATION
// ==========================================

const kantumruy = Kantumruy_Pro({
  subsets: ['khmer', 'latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
});

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Fix: Add fallback for the key name to match main page logic
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

// Initialize Supabase Client
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Types
type TripData = {
  id: string;
  current_lat: number;
  current_lng: number;
  heading: number;
  speed: number;
  status: 'active' | 'ended' | 'arrived';
  last_updated: string;
};

// Helper for smooth animation (Linear Interpolation)
const lerp = (start: number, end: number, amt: number) => (1 - amt) * start + amt * end;

// ==========================================
// 3. MAIN COMPONENT
// ==========================================
export default function LiveTripPage() {
  const params = useParams();
  const tripId = params?.id as string; // Safely access ID
  const { toast } = useToast();
  
  // Refs
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMap | null>(null);
  const userMarker = useRef<Marker | null>(null);
  const animationFrame = useRef<number>(0);
  
  // State
  const [tripData, setTripData] = useState<TripData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  
  // Animation State Refs
  const currentPos = useRef<[number, number]>([0, 0]);
  const targetPos = useRef<[number, number]>([0, 0]);

  // ------------------------------------------
  // A. DATA FETCHING & REALTIME
  // ------------------------------------------
  useEffect(() => {
    // Debugging: Check console to see what is missing
    if (!supabase) console.error("❌ Supabase Client not initialized. Check .env.local keys.");
    if (!tripId) console.error("❌ Trip ID is missing from URL.");

    if (!supabase || !tripId) {
      setError("System config error. Please check console for details.");
      setLoading(false);
      return;
    }

    // 1. Initial Fetch
    const fetchTrip = async () => {
      try {
        const { data, error } = await supabase
          .from('active_trips')
          .select('*')
          .eq('id', tripId)
          .single();

        if (error) {
          console.error("Supabase DB Error:", error.message);
          setError("Trip not found or access denied.");
        } else if (data) {
          setTripData(data);
          // Initialize position refs immediately
          targetPos.current = [data.current_lng, data.current_lat];
          currentPos.current = [data.current_lng, data.current_lat];
        } else {
          setError("Location not found.");
        }
      } catch (err) {
        console.error("Network Error:", err);
        setError("Network error connecting to location services.");
      } finally {
        setLoading(false);
      }
    };

    fetchTrip();

    // 2. Subscribe to Updates
    const channel = supabase.channel(`trip-${tripId}`)
      .on('postgres_changes', 
        { event: 'UPDATE', schema: 'public', table: 'active_trips', filter: `id=eq.${tripId}` }, 
        (payload) => {
          const newData = payload.new as TripData;
          setTripData(newData);
          targetPos.current = [newData.current_lng, newData.current_lat];
          
          if (newData.status === 'ended') {
             toast({ title: "Sharing Stopped", description: "The user has stopped sharing their location." });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tripId, toast]);

  // ------------------------------------------
  // B. MAP INITIALIZATION
  // ------------------------------------------
  useEffect(() => {
    if (!mapContainer.current || !tripData || map.current) return;

    if (!MAPBOX_TOKEN) {
        setError("Mapbox token missing.");
        return;
    }

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [tripData.current_lng, tripData.current_lat],
      zoom: 15,
      pitch: 0,
      attributionControl: false,
      logoPosition: 'bottom-left',
      interactive: true,
      cooperativeGestures: false, 
    });

    // SOCIAL MARKER
    const el = document.createElement('div');
    el.className = "friend-marker";
    el.innerHTML = `
      <div class="relative flex flex-col items-center">
        <div class="absolute w-full h-full bg-indigo-500/50 rounded-full animate-ping opacity-75"></div>
        <div class="w-12 h-12 rounded-full border-4 border-white shadow-2xl overflow-hidden bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center z-10 relative">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
             <circle cx="12" cy="7" r="4"/>
           </svg>
        </div>
        <div class="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] border-t-white -mt-1 z-10"></div>
        <div class="absolute -bottom-6 bg-black/70 text-white text-[10px] font-bold px-2 py-0.5 rounded-full backdrop-blur-sm whitespace-nowrap shadow-lg">
           Friend
        </div>
      </div>
    `;

    userMarker.current = new Marker({ element: el, anchor: 'bottom' })
      .setLngLat([tripData.current_lng, tripData.current_lat])
      .addTo(map.current);

    map.current.on('mousedown', () => setIsFollowing(false));
    map.current.on('touchstart', () => setIsFollowing(false));
    map.current.on('wheel', () => setIsFollowing(false));

  }, [tripData]); // Wait for tripData before loading map

  // ------------------------------------------
  // C. ANIMATION LOOP
  // ------------------------------------------
  useEffect(() => {
    if (!map.current || !userMarker.current) return;

    const animate = () => {
      currentPos.current[0] = lerp(currentPos.current[0], targetPos.current[0], 0.08);
      currentPos.current[1] = lerp(currentPos.current[1], targetPos.current[1], 0.08);
      
      userMarker.current?.setLngLat(currentPos.current);

      if (isFollowing) {
        map.current?.easeTo({
          center: currentPos.current,
          zoom: 16,
          duration: 0,
        });
      }
      
      animationFrame.current = requestAnimationFrame(animate);
    };

    animationFrame.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame.current);
  }, [isFollowing]);


  // ------------------------------------------
  // D. RENDER UI
  // ------------------------------------------

  if (loading) return (
    <div className="flex h-screen w-full items-center justify-center bg-zinc-950 text-white">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
        <p className="text-zinc-500 text-sm font-mono animate-pulse">Locating friend...</p>
      </div>
    </div>
  );

  if (error || !tripData) return (
    <div className="flex h-screen w-full items-center justify-center bg-zinc-950 text-white p-6 text-center font-sans">
      <div className="max-w-md w-full">
        <div className="mx-auto w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-6 border border-zinc-800">
          <AlertCircle className="h-8 w-8 text-zinc-500" />
        </div>
        <h2 className="text-xl font-bold mb-2">Location Unavailable</h2>
        <p className="text-zinc-400 text-sm mb-8 leading-relaxed">
          {error || "The user is no longer sharing their location or the link has expired."}
        </p>
        <Button onClick={() => window.location.href = '/'} variant="outline" className="w-full h-12 rounded-xl border-zinc-800 text-white bg-zinc-900 hover:bg-zinc-800 hover:text-white transition-all">
          <ArrowLeft className="mr-2 h-4 w-4" /> Go to Map
        </Button>
      </div>
    </div>
  );

  return (
    <div className={`relative h-[100dvh] w-full overflow-hidden bg-zinc-950 ${kantumruy.className}`}>
      
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }} />

      {/* Top Header Overlay */}
      <div className="absolute top-0 left-0 right-0 p-4 z-20 pt-[env(safe-area-inset-top)] pointer-events-none">
        <div className="flex justify-between items-center pointer-events-auto">
          <Button variant="ghost" size="icon" className="rounded-full h-10 w-10 bg-black/40 backdrop-blur-xl text-white border border-white/10 hover:bg-black/60 transition-all shadow-lg" onClick={() => window.location.href = '/'}>
             <ArrowLeft className="h-5 w-5" />
          </Button>
          
          <div className="bg-black/60 backdrop-blur-xl px-4 py-2 rounded-full border border-white/10 flex items-center gap-2.5 shadow-lg animate-in fade-in slide-in-from-top-4 duration-700">
             <div className="relative flex h-2.5 w-2.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${tripData.status === 'active' ? 'bg-green-400' : 'bg-red-400'}`}></span>
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${tripData.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
             </div>
             <span className="text-xs font-bold text-white tracking-wide uppercase">
                {tripData.status === 'active' ? 'Live' : 'Offline'}
             </span>
          </div>

          <Button size="icon" variant="ghost" className="text-white bg-black/40 hover:bg-black/60 rounded-full backdrop-blur-xl h-10 w-10 border border-white/10 shadow-lg" onClick={() => {
             if (navigator.share) navigator.share({ title: "Track Location", url: window.location.href }).catch(()=>{});
             else { navigator.clipboard.writeText(window.location.href); toast({ title: "Link Copied" }); }
          }}>
            <Share2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Resume Button */}
      {!isFollowing && (
        <div className="absolute bottom-64 right-4 z-20 pointer-events-auto">
          <Button onClick={() => setIsFollowing(true)} className="h-12 w-12 rounded-full bg-white text-black shadow-2xl border-none hover:bg-zinc-200 p-0 animate-in zoom-in duration-300">
            <LocateFixed className="h-6 w-6" />
          </Button>
        </div>
      )}

      {/* Bottom Info Card */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none">
        <Card className="bg-[#18181b]/95 backdrop-blur-2xl border-zinc-800/50 text-white shadow-2xl rounded-3xl overflow-hidden ring-1 ring-white/10 p-5 pointer-events-auto animate-in slide-in-from-bottom-10 duration-500">
            <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-900/20 shrink-0">
                    <User className="h-7 w-7 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-bold text-white leading-none mb-1.5 truncate">Friend's Location</h3>
                    <div className="flex items-center gap-2 text-zinc-400 text-xs font-medium">
                        <Clock className="h-3.5 w-3.5" />
                        <span>Updated {new Date(tripData.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                </div>
                <div className="flex flex-col items-end pl-2">
                    <span className="text-3xl font-bold text-white tracking-tight">{Math.round((tripData.speed || 0) * 3.6)}</span>
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">km/h</span>
                </div>
            </div>

            <Button 
                className="w-full h-14 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold text-base shadow-lg shadow-indigo-900/20 transition-all active:scale-[0.98]" 
                onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${tripData.current_lat},${tripData.current_lng}`)}
            >
                <Navigation className="mr-2 h-5 w-5" /> 
                Get Directions
            </Button>
        </Card>
      </div>
    </div>
  );
}