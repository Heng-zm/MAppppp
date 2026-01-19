'use client';

// ==========================================
// 1. IMPORTS
// ==========================================
import React, { useEffect, useRef, useState } from 'react';
import mapboxgl, { Map as MapboxMap, Marker } from 'mapbox-gl';
import { createClient } from '@supabase/supabase-js';
import { useParams, useRouter } from 'next/navigation';
import { Kantumruy_Pro } from 'next/font/google';
import 'mapbox-gl/dist/mapbox-gl.css';

// Icons
import { 
  Clock, MapPin, AlertCircle, 
  LocateFixed, Share2, Navigation, User, ArrowLeft,
  Activity, Copy, Smartphone
} from 'lucide-react';

// UI Components
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

// ==========================================
// 2. CONFIGURATION & TYPES
// ==========================================

const kantumruy = Kantumruy_Pro({
  subsets: ['khmer', 'latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

type TripData = {
  id: string;
  current_lat: number;
  current_lng: number;
  heading: number;
  speed: number;
  status: 'active' | 'ended' | 'arrived';
  last_updated: string;
};

// Smooth interpolation helper
const lerp = (start: number, end: number, amt: number) => (1 - amt) * start + amt * end;

// Distance helper to throttle Geocoding (Haversine)
function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return (R * c) * 1000;
}

// ==========================================
// 3. COMPONENT
// ==========================================
export default function LiveTripPage() {
  const { id: tripId } = useParams();
  const router = useRouter();
  const { toast } = useToast();
  
  // Refs
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMap | null>(null);
  const userMarker = useRef<Marker | null>(null);
  const animationFrame = useRef<number>(0);
  const lastGeocodePos = useRef<{lat: number, lng: number} | null>(null);
  
  // State
  const [tripData, setTripData] = useState<TripData | null>(null);
  const [address, setAddress] = useState<string>("Locating...");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const [trail, setTrail] = useState<[number, number][]>([]);
  
  // Animation Refs
  const currentPos = useRef<[number, number]>([0, 0]);
  const targetPos = useRef<[number, number]>([0, 0]);
  const currentHeading = useRef<number>(0);
  const targetHeading = useRef<number>(0);
  
  // --- 1. GEOCODING (Optimized) ---
  const fetchAddress = async (lat: number, lng: number) => {
    if (!MAPBOX_TOKEN) return;
    
    // Throttle: Only fetch if moved > 50 meters from last fetch
    if (lastGeocodePos.current) {
        const dist = getDistanceFromLatLonInMeters(lastGeocodePos.current.lat, lastGeocodePos.current.lng, lat, lng);
        if (dist < 50) return;
    }

    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=poi,address,neighborhood&limit=1&access_token=${MAPBOX_TOKEN}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.features && data.features.length > 0) {
        setAddress(data.features[0].place_name.replace(", Phnom Penh, Cambodia", "").replace(", Cambodia", ""));
        lastGeocodePos.current = { lat, lng };
      }
    } catch (e) {
      // Fail silently
    }
  };

  // --- 2. DATA FETCHING ---
  useEffect(() => {
    if (!supabase || !tripId) {
      setError("Configuration Error");
      setLoading(false);
      return;
    }

    const fetchTrip = async () => {
      try {
        const { data } = await supabase.from('active_trips').select('*').eq('id', tripId).single();

        if (data) {
          setTripData(data);
          targetPos.current = [data.current_lng, data.current_lat];
          currentPos.current = [data.current_lng, data.current_lat];
          targetHeading.current = data.heading;
          currentHeading.current = data.heading;
          setTrail([[data.current_lng, data.current_lat]]);
          fetchAddress(data.current_lat, data.current_lng);
        } else {
          setError("Trip not active or ID invalid.");
        }
      } catch (err) {
        setError("Connection failed.");
      } finally {
        setLoading(false);
      }
    };

    fetchTrip();

    const channel = supabase.channel(`trip-${tripId}`)
      .on('postgres_changes', 
        { event: 'UPDATE', schema: 'public', table: 'active_trips', filter: `id=eq.${tripId}` }, 
        (payload) => {
          const newData = payload.new as TripData;
          setTripData(newData);
          targetPos.current = [newData.current_lng, newData.current_lat];
          targetHeading.current = newData.heading;
          
          setTrail(prev => {
              const newTrail = [...prev, [newData.current_lng, newData.current_lat]];
              return newTrail.slice(-50); // Keep last 50 points to prevent memory issues
          });
          
          fetchAddress(newData.current_lat, newData.current_lng);

          if (newData.status === 'ended') {
             toast({ title: "Trip Ended", description: "Live sharing has stopped." });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tripId, toast]);

  // --- 3. MAP SETUP ---
  useEffect(() => {
    if (!mapContainer.current || !tripData || map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [tripData.current_lng, tripData.current_lat],
      zoom: 16,
      pitch: 45,
      bearing: tripData.heading || 0,
      attributionControl: false,
      logoPosition: 'bottom-left',
      interactive: true,
      cooperativeGestures: false,
    });

    map.current.on('load', () => {
        if (!map.current) return;
        // Add trail layer
        map.current.addSource('trail', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trail } } });
        map.current.addLayer({ id: 'trail-layer', type: 'line', source: 'trail', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#818cf8', 'line-width': 4, 'line-opacity': 0.6, 'line-blur': 1 } });
    });

    // Custom CSS Avatar Marker
    const el = document.createElement('div');
    el.className = "friend-marker";
    el.innerHTML = `
      <div class="relative flex flex-col items-center group">
        <div class="absolute w-full h-full bg-indigo-500/40 rounded-full animate-ping opacity-75 duration-1500"></div>
        <div class="w-14 h-14 rounded-full border-4 border-white shadow-[0_0_20px_rgba(99,102,241,0.6)] overflow-hidden bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center z-10 relative">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div class="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] border-t-white -mt-1 z-10 drop-shadow-md"></div>
      </div>
    `;

    userMarker.current = new Marker({ element: el, anchor: 'bottom' })
      .setLngLat([tripData.current_lng, tripData.current_lat])
      .addTo(map.current);

    map.current.on('mousedown', () => setIsFollowing(false));
    map.current.on('touchstart', () => setIsFollowing(false));
    map.current.on('wheel', () => setIsFollowing(false));

    return () => { map.current?.remove(); };
  }, [loading]);

  // --- 4. ANIMATION LOOP ---
  useEffect(() => {
    if (!map.current || !userMarker.current) return;

    const animate = () => {
      // Smooth movement (LERP)
      currentPos.current[0] = lerp(currentPos.current[0], targetPos.current[0], 0.08);
      currentPos.current[1] = lerp(currentPos.current[1], targetPos.current[1], 0.08);
      
      // Handle Heading wrapping (0 -> 360 issue)
      let dHeading = targetHeading.current - currentHeading.current;
      while (dHeading <= -180) dHeading += 360;
      while (dHeading > 180) dHeading -= 360;
      currentHeading.current += dHeading * 0.08;

      userMarker.current?.setLngLat(currentPos.current);

      const source = map.current?.getSource('trail') as mapboxgl.GeoJSONSource;
      if (source && trail.length > 1) {
          source.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trail } });
      }

      if (isFollowing) {
        map.current?.easeTo({
          center: currentPos.current,
          zoom: 17,
          bearing: currentHeading.current,
          duration: 0,
        });
      }
      animationFrame.current = requestAnimationFrame(animate);
    };

    animationFrame.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame.current);
  }, [isFollowing, trail, tripData]);

  // Handle Share Functionality
  const handleShare = async () => {
      const url = typeof window !== 'undefined' ? window.location.href : '';
      if (navigator.share) {
          try { await navigator.share({ title: 'Track my live location', url }); } catch(e){}
      } else {
          navigator.clipboard.writeText(url);
          toast({ title: "Link Copied", description: "Tracking link copied to clipboard." });
      }
  };

  // --- 5. RENDER UI ---

  if (loading) return (
    <div className="flex h-screen w-full items-center justify-center bg-black text-white">
      <div className="flex flex-col items-center gap-4 animate-in fade-in duration-700">
        <div className="relative">
            <div className="w-16 h-16 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
            <div className="absolute inset-0 flex items-center justify-center"><Smartphone className="h-6 w-6 text-indigo-500" /></div>
        </div>
        <p className="text-zinc-500 text-sm font-mono animate-pulse">Establishing satellite link...</p>
      </div>
    </div>
  );

  if (error || !tripData) return (
    <div className="flex h-screen w-full items-center justify-center bg-black text-white p-6">
      <Card className="w-full max-w-md bg-zinc-900 border-zinc-800 p-8 text-center shadow-2xl">
        <div className="mx-auto w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center mb-6">
          <AlertCircle className="h-8 w-8 text-zinc-500" />
        </div>
        <h2 className="text-xl font-bold mb-2 text-white">Signal Lost</h2>
        <p className="text-zinc-400 text-sm mb-8">{error || "Unable to connect to live tracking."}</p>
        <Button onClick={() => router.push('/')} className="w-full bg-white text-black hover:bg-zinc-200 font-bold rounded-xl h-12">Open Map</Button>
      </Card>
    </div>
  );

  const speedKmh = Math.round((tripData.speed || 0) * 3.6);
  const isMoving = speedKmh > 3;

  return (
    <div className={`relative h-[100dvh] w-full overflow-hidden bg-black ${kantumruy.className}`}>
      
      <div ref={mapContainer} className="absolute inset-0 w-full h-full" style={{ touchAction: 'none' }} />

      {/* --- TOP BAR --- */}
      <div className="absolute top-0 left-0 right-0 p-4 z-20 pt-[max(1rem,env(safe-area-inset-top))] pointer-events-none">
        <div className="flex justify-between items-start pointer-events-auto">
          
          {/* Back Button */}
          <Button variant="ghost" size="icon" className="rounded-full h-10 w-10 bg-black/40 backdrop-blur-xl text-white border border-white/10 hover:bg-black/60 shadow-lg" onClick={() => router.push('/')}>
             <ArrowLeft className="h-5 w-5" />
          </Button>
          
          {/* Status Indicator */}
          <div className="flex flex-col items-end gap-2">
              <div className={`px-3 py-1.5 rounded-full border backdrop-blur-xl flex items-center gap-2 shadow-lg transition-colors duration-500 ${isMoving ? 'bg-indigo-500/20 border-indigo-500/30' : 'bg-zinc-800/60 border-zinc-700'}`}>
                <span className={`relative flex h-2 w-2`}>
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isMoving ? 'bg-indigo-400' : 'bg-zinc-400'}`}></span>
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${isMoving ? 'bg-indigo-500' : 'bg-zinc-500'}`}></span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-white">
                    {isMoving ? 'Live' : 'Stationary'}
                </span>
              </div>
          </div>
        </div>
      </div>

      {/* --- RESUME BUTTON --- */}
      {!isFollowing && (
        <div className="absolute bottom-64 right-4 z-20 pointer-events-auto animate-in zoom-in slide-in-from-bottom-4 duration-300">
          <Button onClick={() => setIsFollowing(true)} className="h-12 px-4 rounded-full bg-white text-black shadow-xl hover:bg-zinc-100 font-bold text-xs gap-2">
            <LocateFixed className="h-4 w-4" /> RE-CENTER
          </Button>
        </div>
      )}

      {/* --- BOTTOM SHEET (Floating Glass Card) --- */}
      <div className="absolute bottom-0 left-0 right-0 z-20 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none">
        <Card className="bg-[#121214]/90 backdrop-blur-3xl border-zinc-800/80 text-white shadow-[0_8px_30px_rgb(0,0,0,0.5)] rounded-3xl overflow-hidden p-5 pointer-events-auto ring-1 ring-white/10 animate-in slide-in-from-bottom-10 duration-500">
            
            {/* Speedometer & Time */}
            <div className="flex justify-between items-start mb-6">
                <div className="flex flex-col">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-0.5 flex items-center gap-1"><Activity className="h-3 w-3" /> Speed</span>
                    <div className="flex items-baseline gap-1">
                        <span className={`text-4xl font-black tracking-tighter ${isMoving ? 'text-indigo-400' : 'text-zinc-500'}`}>{speedKmh}</span>
                        <span className="text-xs text-zinc-600 font-bold uppercase">km/h</span>
                    </div>
                </div>
                
                <div className="text-right">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-0.5">Last Update</span>
                    <div className="flex items-center justify-end gap-1.5 text-zinc-300">
                        <Clock className="h-3.5 w-3.5" />
                        <span className="text-xs font-mono">{new Date(tripData.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                </div>
            </div>

            {/* Address & Action */}
            <div className="space-y-4">
                <div className="flex items-start gap-3 bg-zinc-800/40 p-3 rounded-2xl border border-white/5 transition-colors hover:bg-zinc-800/60">
                    <div className="mt-0.5 bg-indigo-500/20 p-1.5 rounded-lg shrink-0">
                        <MapPin className="h-4 w-4 text-indigo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-zinc-500 font-bold uppercase mb-0.5">Current Location</p>
                        <p className="text-sm font-medium text-zinc-100 truncate leading-snug">{address}</p>
                    </div>
                    <button className="text-zinc-500 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-all" onClick={() => { navigator.clipboard.writeText(address); toast({title:"Copied address"}); }}>
                        <Copy className="h-4 w-4" />
                    </button>
                </div>

                <div className="grid grid-cols-5 gap-3">
                    <Button 
                        variant="secondary" 
                        className="col-span-1 h-12 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300"
                        onClick={handleShare}
                    >
                        <Share2 className="h-5 w-5" />
                    </Button>
                    <Button 
                        className="col-span-4 h-12 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-indigo-900/20 transition-all active:scale-[0.98]" 
                        onClick={() => {
                            // Redirect to main page with destination params
                            router.push(`/?destination=${tripData.current_lat},${tripData.current_lng}`);
                        }}
                    >
                        <Navigation className="mr-2 h-4 w-4 fill-current" /> 
                        Get Directions Here
                    </Button>
                </div>
            </div>
        </Card>
      </div>
    </div>
  );
}