'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl, { GeolocateControl, Marker, Popup, LngLatBounds } from 'mapbox-gl';
// @ts-ignore
import MapboxDirections from '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions';

import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions.css';

import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  Navigation2, X, MapPin, Navigation, LocateFixed, 
  Clock, ArrowRight, Volume2, VolumeX, Compass, 
  Loader2, Sparkles, Send, Bot, Fuel, Utensils, Coffee, Hospital, Search
} from 'lucide-react';

// --- CONFIGURATION ---
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const GEOAPIFY_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;

if (MAPBOX_TOKEN) {
    mapboxgl.accessToken = MAPBOX_TOKEN;
}

const initialCenter: [number, number] = [104.9282, 11.5564]; // Default: Phnom Penh
const initialZoom = 13;
// Using navigation guidance night style for better contrast
const mapStyle = 'mapbox://styles/mapbox/navigation-night-v1'; 

// --- TYPES ---
type Message = {
    role: 'user' | 'assistant';
    content: string;
    action?: {
        type: 'navigate' | 'search_result';
        coords: [number, number];
        label: string;
    };
};

type QuickAction = {
    label: string;
    icon: React.ReactNode;
    query: string;
    category: string;
    color: string;
};

// --- UTILITIES ---
function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c) * 1000;
}

export default function MapExplorerPage() {
  // --- REFS ---
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const directionsControl = useRef<any | null>(null);
  const geolocateControl = useRef<GeolocateControl | null>(null);
  const destinationMarker = useRef<Marker | null>(null);
  const searchMarkers = useRef<Marker[]>([]); 
  
  const userLocation = useRef<[number, number] | null>(null);
  const isNavigating = useRef<boolean>(false);
  const lastCameraUpdate = useRef<number>(0);
  const lastSpokenInstruction = useRef<string>("");
  const isMounted = useRef<boolean>(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  
  // --- STATE ---
  const [locationDetails, setLocationDetails] = useState<{lng: number, lat: number} | null>(null);
  const [addressDetails, setAddressDetails] = useState<any>(null);
  const [isFetchingAddress, setIsFetchingAddress] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showRecenterBtn, setShowRecenterBtn] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  
  // AI State
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState("");
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
      { role: 'assistant', content: "Hello! I'm your co-pilot. Where are we heading today?" }
  ]);

  const [routeDetails, setRouteDetails] = useState<{
    distance: number; 
    duration: number;
    instruction: string;
    arrivalTime: string;
  } | null>(null);

  const showRecenterBtnRef = useRef(false);
  const isMutedRef = useRef(false);

  useEffect(() => { showRecenterBtnRef.current = showRecenterBtn; }, [showRecenterBtn]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  
  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAiOpen]);

  // --- MAP INITIALIZATION ---
  useEffect(() => {
    isMounted.current = true;
    if (!MAPBOX_TOKEN) return; 
    if (map.current || !mapContainer.current) return;
    if (mapContainer.current.hasChildNodes()) mapContainer.current.innerHTML = ''; 
    
    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: initialCenter,
      zoom: initialZoom,
      pitch: 0, 
      bearing: 0,
      attributionControl: false,
      antialias: true,
      logoPosition: 'bottom-left',
    });

    map.current = mapInstance;
    mapInstance.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      trackUserLocation: true,
      showUserHeading: true,
      showUserLocation: true,
      showAccuracyCircle: false,
    });
    geolocateControl.current = geolocate;
    mapInstance.addControl(geolocate, 'top-right');

    let initTimer: NodeJS.Timeout;

    mapInstance.on('load', () => {
        if (!isMounted.current) return;
        setIsMapLoaded(true); 
        geolocate.trigger();

        initTimer = setTimeout(() => {
             if (isMounted.current && map.current) {
                initializeDirectionsPlugin(mapInstance);
                add3DBuildings(mapInstance);
             }
        }, 600); 
    });

    geolocate.on('geolocate', (e: any) => {
      const pos = e.coords;
      const speedKmh = pos.speed ? Math.round(pos.speed * 3.6) : 0;
      if(isMounted.current) setCurrentSpeed(speedKmh);
      userLocation.current = [pos.longitude, pos.latitude];

      if (isNavigating.current && directionsControl.current) {
         directionsControl.current.setOrigin([pos.longitude, pos.latitude]);
         
         if (!showRecenterBtnRef.current) {
             const now = Date.now();
             // Throttled camera update
             if (now - lastCameraUpdate.current > 1000) {
                 lastCameraUpdate.current = now;
                 const targetZoom = Math.max(16.5, Math.min(18.5, 18.5 - (speedKmh / 80)));
                 mapInstance.easeTo({
                     center: [pos.longitude, pos.latitude],
                     zoom: targetZoom,
                     pitch: 60,
                     bearing: pos.heading || mapInstance.getBearing(),
                     duration: 1000,
                     easing: (t) => t
                 });
             }
         }
      }
    });
    
    mapInstance.on('dragstart', () => { if(isNavigating.current) setShowRecenterBtn(true); });
    mapInstance.on('pitchstart', () => { if(isNavigating.current) setShowRecenterBtn(true); });

    // Cleanup plugin markers (default mapbox ones are ugly)
    const markerObserver = new MutationObserver((mutations) => {
        let shouldCleanup = false;
        mutations.forEach((mutation) => { if (mutation.addedNodes.length > 0) shouldCleanup = true; });
        if (shouldCleanup) {
             requestAnimationFrame(() => {
                 const badElements = document.querySelectorAll('.mapbox-directions-destination, .mapbox-directions-origin, .mapbox-directions-step');
                 if(badElements.length > 0) badElements.forEach(el => el.remove());
             });
        }
    });
    if (mapContainer.current) markerObserver.observe(mapContainer.current, { childList: true, subtree: true });

    const onMapClick = (e: mapboxgl.MapMouseEvent) => {
      if(isNavigating.current) return;
      handleSetDestination(e.lngLat.lng, e.lngLat.lat);
    };
    mapInstance.on('click', onMapClick);

    // --- PLUGINS ---
    const initializeDirectionsPlugin = (instance: mapboxgl.Map) => {
        if(directionsControl.current) return; 
        const directions = new MapboxDirections({
            accessToken: MAPBOX_TOKEN, 
            unit: 'metric',
            profile: 'mapbox/driving',
            interactive: false,
            controls: { inputs: false, instructions: false, profileSwitcher: false },
            alternatives: false,
            flyTo: false
        });
        instance.addControl(directions, 'top-left');
        directionsControl.current = directions;
        
        directions.on('route', (e: any) => {
          if (!isMounted.current) return;
          if (e.route && e.route.length > 0) {
            const route = e.route[0];
            const leg = route.legs[0];
            const instructionText = (leg.steps[0]?.distance < 20 && leg.steps[1]) ? leg.steps[1].maneuver.instruction : (leg.steps[0]?.maneuver?.instruction || "Follow Route");
            const now = new Date();
            setRouteDetails({
              distance: route.distance,
              duration: route.duration,
              instruction: instructionText,
              arrivalTime: new Date(now.getTime() + route.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            styleRouteLayers(instance);
          }
      });
    }

    const add3DBuildings = (instance: mapboxgl.Map) => {
        if (!instance.getStyle() || !instance.getSource('composite') || instance.getLayer('3d-buildings')) return;
        const layers = instance.getStyle().layers;
        const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;
        try {
            instance.addLayer({
                'id': '3d-buildings',
                'source': 'composite',
                'source-layer': 'building',
                'filter': ['==', 'extrude', 'true'],
                'type': 'fill-extrusion',
                'minzoom': 14,
                'paint': {
                    'fill-extrusion-color': '#1a1a1a', // Darker buildings for night mode
                    'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'height']],
                    'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'min_height']],
                    'fill-extrusion-opacity': 0.9
                }
            }, labelLayerId);
        } catch (e) { console.warn(e); }
    }

    const styleRouteLayers = (instance: mapboxgl.Map) => {
          if (instance.getLayer('directions-route-line-casing')) {
              instance.setPaintProperty('directions-route-line-casing', 'line-color', '#0c4a6e'); // Dark blue casing
              instance.setPaintProperty('directions-route-line-casing', 'line-width', 12);
          }
          if (instance.getLayer('directions-route-line')) {
              instance.setPaintProperty('directions-route-line', 'line-color', '#38bdf8'); // Bright sky blue route
              instance.setPaintProperty('directions-route-line', 'line-width', 6);
          }
    };

    return () => {
      isMounted.current = false;
      clearTimeout(initTimer);
      markerObserver.disconnect();
      mapInstance.off('click', onMapClick);
      if (map.current) { map.current.remove(); map.current = null; }
    }
  }, []); 

  // --- CORE LOGIC ---
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || isMutedRef.current || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    // Prefer higher quality voices if available
    const preferredVoice = window.speechSynthesis.getVoices().find(v => (v.name.includes('Google') || v.name.includes('Premium')) && v.lang.includes('en'));
    if (preferredVoice) utterance.voice = preferredVoice;
    window.speechSynthesis.speak(utterance);
  }, []);

  const createCustomMarker = (type: 'destination' | 'search', color: string = '#ef4444') => {
      const el = document.createElement('div');
      el.className = 'flex items-center justify-center';
      
      const inner = document.createElement('div');
      inner.className = `w-4 h-4 rounded-full border-2 border-white shadow-lg animate-bounce`;
      inner.style.backgroundColor = color;
      
      const pulse = document.createElement('div');
      pulse.className = 'absolute w-4 h-4 rounded-full opacity-75 animate-ping';
      pulse.style.backgroundColor = color;

      el.appendChild(pulse);
      el.appendChild(inner);
      return el;
  }

  const handleSetDestination = (lng: number, lat: number) => {
      if (!map.current) return;
      setRouteDetails(null);
      setShowRecenterBtn(false);
      lastSpokenInstruction.current = ""; 
      
      // Clear search markers
      searchMarkers.current.forEach(m => m.remove());
      searchMarkers.current = [];

      if (directionsControl.current) directionsControl.current.removeRoutes();
      if (destinationMarker.current) destinationMarker.current.remove();

      map.current.easeTo({ pitch: 0, bearing: 0, zoom: 15, duration: 800 });
      
      const el = createCustomMarker('destination', '#ef4444');
      const newMarker = new Marker(el).setLngLat([lng, lat]).addTo(map.current);
      destinationMarker.current = newMarker;

      setLocationDetails({ lng, lat });
      setIsDrawerOpen(true);
      map.current.flyTo({ center: [lng, lat], zoom: 15, offset: [0, 150], essential: true });
  };

  // --- OPTIMIZED AI LOGIC ---
  const clearSearchMarkers = () => {
      searchMarkers.current.forEach(m => m.remove());
      searchMarkers.current = [];
  };

  const parseIntent = (input: string) => {
      const lower = input.toLowerCase();
      if (lower.match(/^(go to|drive to|navigate to|take me to)/)) return { type: 'navigate', query: lower.replace(/^(go to|drive to|navigate to|take me to)/, '').trim() };
      if (lower.match(/^(where is|show me)/)) return { type: 'search', query: lower.replace(/^(where is|show me)/, '').trim() };
      
      if (lower.includes('gas') || lower.includes('fuel')) return { type: 'category', category: 'service.vehicle.fuel', label: 'Gas Stations', color: '#f97316' };
      if (lower.includes('coffee') || lower.includes('cafe')) return { type: 'category', category: 'catering.cafe', label: 'Cafes', color: '#d97706' };
      if (lower.includes('food') || lower.includes('restaurant') || lower.includes('eat')) return { type: 'category', category: 'catering.restaurant', label: 'Restaurants', color: '#ef4444' };
      if (lower.includes('hospital') || lower.includes('doctor')) return { type: 'category', category: 'healthcare.hospital', label: 'Hospitals', color: '#22c55e' };
      
      return { type: 'search', query: lower };
  };

  const handleAiSubmit = async (e?: React.FormEvent, customInput?: string) => {
    if(e) e.preventDefault();
    const inputToProcess = customInput || aiInput;
    if(!inputToProcess.trim()) return;

    setAiInput("");
    setMessages(prev => [...prev, { role: 'user', content: inputToProcess }]);
    setIsAiThinking(true);
    
    if (!GEOAPIFY_KEY) {
        setTimeout(() => {
            setMessages(prev => [...prev, { role: 'assistant', content: "API Key missing. Cannot search." }]);
            setIsAiThinking(false);
        }, 800);
        return;
    }

    const intent = parseIntent(inputToProcess);
    const biasLat = userLocation.current ? userLocation.current[1] : initialCenter[1];
    const biasLng = userLocation.current ? userLocation.current[0] : initialCenter[0];
    
    try {
        let apiUrl = "";
        if (intent.type === 'category') {
             apiUrl = `https://api.geoapify.com/v2/places?categories=${intent.category}&filter=circle:${biasLng},${biasLat},5000&bias=proximity:${biasLng},${biasLat}&limit=5&apiKey=${GEOAPIFY_KEY}`;
        } else {
             apiUrl = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(intent.query)}&lat=${biasLat}&lon=${biasLng}&limit=1&apiKey=${GEOAPIFY_KEY}`;
        }

        const res = await fetch(apiUrl);
        const data = await res.json();
        
        if (data.features && data.features.length > 0) {
            if (intent.type === 'category') {
                clearSearchMarkers();
                const bounds = new LngLatBounds();
                
                data.features.forEach((feat: any) => {
                    const [lng, lat] = feat.geometry.coordinates;
                    bounds.extend([lng, lat]);
                    
                    const el = createCustomMarker('search', (intent as any).color || '#3b82f6');
                    
                    const marker = new Marker(el)
                        .setLngLat([lng, lat])
                        .setPopup(new Popup({ offset: 25, closeButton: false }).setText(feat.properties.name || intent.label))
                        .addTo(map.current!);
                    
                    // Add click listener to DOM element
                    el.addEventListener('click', () => {
                         handleSetDestination(lng, lat);
                         setIsAiOpen(false);
                    });
                    
                    searchMarkers.current.push(marker);
                });

                if (map.current) map.current.fitBounds(bounds, { padding: 100, maxZoom: 15 });

                setMessages(prev => [...prev, { 
                    role: 'assistant', 
                    content: `Found nearby ${intent.label?.toLowerCase()}. Tap one to go.` 
                }]);
            } else {
                const place = data.features[0];
                const [lng, lat] = place.geometry.coordinates;
                const name = place.properties.name || place.properties.formatted;
                
                setMessages(prev => [...prev, { 
                    role: 'assistant', 
                    content: `Found "${name}".`,
                    action: { type: 'navigate', coords: [lng, lat], label: name }
                }]);
                
                if(map.current) map.current.flyTo({ center: [lng, lat], zoom: 15 });
            }
        } else {
            setMessages(prev => [...prev, { role: 'assistant', content: "I couldn't find anything." }]);
        }

    } catch (err) {
        console.error(err);
        setMessages(prev => [...prev, { role: 'assistant', content: "Connection error." }]);
    } finally {
        setIsAiThinking(false);
    }
  };

  const quickActions: QuickAction[] = [
      { label: 'Gas', icon: <Fuel className="h-3 w-3" />, query: 'Find gas stations', category: 'fuel', color: 'border-orange-500/50 text-orange-400' },
      { label: 'Food', icon: <Utensils className="h-3 w-3" />, query: 'Find restaurants', category: 'food', color: 'border-red-500/50 text-red-400' },
      { label: 'Coffee', icon: <Coffee className="h-3 w-3" />, query: 'Find coffee', category: 'coffee', color: 'border-amber-500/50 text-amber-400' },
      { label: 'Health', icon: <Hospital className="h-3 w-3" />, query: 'Find hospitals', category: 'hospital', color: 'border-green-500/50 text-green-400' },
  ];

  // --- ACTIONS ---
  const handleStartNavigation = () => {
    if (!userLocation.current) {
      toast({ title: "GPS Required", description: "Waiting for your location.", variant: "destructive" });
      geolocateControl.current?.trigger();
      return;
    }
    if (!locationDetails) return;
    if (window.speechSynthesis) { window.speechSynthesis.resume(); if(!isMuted) speak("Starting route"); }
    isNavigating.current = true;
    setShowRecenterBtn(false);
    if (directionsControl.current) {
      directionsControl.current.setOrigin(userLocation.current);
      directionsControl.current.setDestination([locationDetails.lng, locationDetails.lat]);
    }
    setIsDrawerOpen(false);
    clearSearchMarkers();
    if(map.current) map.current.flyTo({ center: userLocation.current, zoom: 18, pitch: 60, bearing: 0, essential: true, duration: 1500 });
  }

  const handleRecenter = () => {
      if(!userLocation.current || !map.current) return;
      setShowRecenterBtn(false);
      map.current.flyTo({ center: userLocation.current, zoom: 18, pitch: 60, bearing: map.current.getBearing(), duration: 1000 });
  }

  const clearRoute = () => {
    isNavigating.current = false;
    window.speechSynthesis.cancel();
    if (directionsControl.current) directionsControl.current.removeRoutes();
    if (destinationMarker.current) { destinationMarker.current.remove(); destinationMarker.current = null; }
    clearSearchMarkers();
    setRouteDetails(null);
    setLocationDetails(null);
    setIsDrawerOpen(false);
    setShowRecenterBtn(false);
    if(map.current && userLocation.current) map.current.flyTo({ center: userLocation.current, zoom: 14, pitch: 0, bearing: 0, duration: 1000 });
  }

  // --- RENDER HELPERS ---
  const formatDistance = (d: number) => d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${d.toFixed(0)} m`;
  const formatDuration = (s: number) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`; }

  if (!MAPBOX_TOKEN) return <div className="flex h-screen items-center justify-center bg-zinc-950 text-white">Missing Mapbox Token</div>;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-zinc-950 font-sans text-zinc-50 select-none">
        
        {/* Loading Overlay */}
        <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 text-white transition-opacity duration-1000 ease-out ${isMapLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <div className="relative">
                <div className="absolute inset-0 rounded-full blur-xl bg-blue-500/20 animate-pulse" />
                <Loader2 className="h-12 w-12 animate-spin text-blue-500 relative z-10" />
            </div>
            <p className="text-zinc-500 text-xs font-mono mt-4 tracking-widest uppercase">Initializing Satellites</p>
        </div>

        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

        {/* Heads Up Display (HUD) - Top */}
        {routeDetails && (
          <div className="absolute top-0 left-0 right-0 z-10 flex justify-center pt-2 px-2 pointer-events-none pb-[safe-area-inset-top]">
            <Card className="w-full max-w-md shadow-2xl bg-zinc-900/95 backdrop-blur-xl border-zinc-800 text-white pointer-events-auto rounded-2xl overflow-hidden ring-1 ring-white/10">
              <div className="h-1 w-full bg-gradient-to-r from-green-500 via-emerald-400 to-green-500" />
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-4">
                    <div className="bg-emerald-600/20 p-3 rounded-xl text-emerald-400 shadow-inner border border-emerald-500/20 shrink-0 mt-1">
                        <ArrowRight className="h-8 w-8" />
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-center">
                         <div className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest mb-1">Turn Right In 200m</div>
                         <div className="text-xl font-bold leading-tight break-words text-white">{routeDetails.instruction}</div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                         <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} className="h-9 w-9 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors">
                            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5 text-emerald-400" />}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={clearRoute} className="h-9 w-9 rounded-full bg-zinc-800 hover:bg-red-900/30 text-zinc-400 hover:text-red-400 transition-colors">
                            <X className="h-5 w-5" />
                        </Button>
                    </div>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-zinc-800/50">
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold tracking-tight text-emerald-400 drop-shadow-sm">{formatDuration(routeDetails.duration)}</span>
                        <span className="text-sm font-medium text-zinc-500">({formatDistance(routeDetails.distance)})</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="hidden sm:flex items-center justify-center bg-zinc-950 h-8 w-14 rounded-md border border-zinc-800 mr-2 shadow-inner">
                             <span className="text-sm font-bold text-white">{currentSpeed}</span><span className="text-[9px] text-zinc-600 ml-0.5 mt-0.5">km/h</span>
                        </div>
                        <div className="flex items-center gap-2 bg-blue-900/20 px-3 py-1.5 rounded-full border border-blue-500/20">
                            <Clock className="h-3.5 w-3.5 text-blue-400" /><span className="text-xs font-bold text-blue-200">{routeDetails.arrivalTime}</span>
                        </div>
                    </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Floating Action Buttons */}
        <div className="absolute right-4 bottom-32 flex flex-col gap-3 pointer-events-auto z-20">
             {!isNavigating.current && !isAiOpen && (
                 <>
                    <Button 
                        size="icon" 
                        onClick={() => setIsAiOpen(true)} 
                        className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 border border-blue-400/30 text-white hover:shadow-blue-500/20 hover:scale-105 shadow-xl transition-all duration-300"
                    >
                        <Sparkles className="h-5 w-5" />
                    </Button>
                    <Button 
                        size="icon" 
                        className="h-12 w-12 rounded-full bg-zinc-900/90 backdrop-blur border border-zinc-700 text-zinc-300 hover:bg-zinc-800 shadow-xl transition-all" 
                        onClick={() => { if(map.current) map.current.easeTo({ bearing: 0, pitch: 0, duration: 800 }); }}
                    >
                        <Compass className="h-5 w-5" />
                    </Button>
                 </>
             )}
             {showRecenterBtn && (
                <Button 
                    onClick={handleRecenter} 
                    className="h-14 w-14 rounded-full bg-zinc-900/95 backdrop-blur border border-zinc-700 shadow-2xl hover:bg-zinc-800 text-blue-500 flex flex-col items-center justify-center gap-0 animate-in slide-in-from-right-10 fade-in duration-300"
                >
                    <LocateFixed className="h-6 w-6" /><span className="text-[9px] font-bold">Center</span>
                </Button>
             )}
        </div>

        {/* AI Assistant Interface */}
        {isAiOpen && (
            <div className="absolute inset-x-0 bottom-6 z-40 px-4 flex justify-center animate-in slide-in-from-bottom-20 duration-300 fade-in">
                <Card className="w-full max-w-sm bg-zinc-900/95 backdrop-blur-xl border-zinc-700/50 shadow-2xl h-[500px] flex flex-col ring-1 ring-white/10 rounded-2xl overflow-hidden">
                    <CardHeader className="flex flex-row items-center justify-between py-3 px-4 border-b border-white/5 bg-white/5">
                        <CardTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                            <Bot className="h-4 w-4 text-indigo-400" /> AI Co-pilot
                        </CardTitle>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-white/10 rounded-full" onClick={() => setIsAiOpen(false)}>
                            <X className="h-4 w-4" />
                        </Button>
                    </CardHeader>
                    
                    <CardContent className="flex-1 flex flex-col p-0 overflow-hidden relative">
                        <ScrollArea className="flex-1 p-4">
                            <div className="flex flex-col gap-4">
                                {messages.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                                        <div className={`rounded-2xl px-4 py-2.5 text-sm max-w-[85%] shadow-sm ${
                                            msg.role === 'user' 
                                            ? 'bg-blue-600 text-white rounded-br-none' 
                                            : 'bg-zinc-800 text-zinc-200 rounded-bl-none border border-zinc-700'
                                        }`}>
                                            {msg.content}
                                            {msg.action && msg.action.type === 'navigate' && (
                                                <Button size="sm" className="mt-3 w-full bg-white/10 hover:bg-white/20 text-white border border-white/10 text-xs h-8 gap-2 shadow-none"
                                                    onClick={() => {
                                                        handleSetDestination(msg.action!.coords[0], msg.action!.coords[1]);
                                                        setIsAiOpen(false);
                                                        setTimeout(handleStartNavigation, 500);
                                                    }}
                                                >
                                                    <Navigation2 className="h-3 w-3" /> Go Now
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {isAiThinking && (
                                    <div className="flex justify-start animate-in fade-in">
                                        <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-2xl rounded-bl-none px-4 py-3 flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></span>
                                            <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span>
                                            <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span>
                                        </div>
                                    </div>
                                )}
                                <div ref={messagesEndRef} />
                            </div>
                        </ScrollArea>

                        {/* Quick Action Chips */}
                        <div className="px-4 pb-2 flex gap-2 overflow-x-auto no-scrollbar mask-gradient-right pb-3">
                            {quickActions.map((action, i) => (
                                <Badge key={i} variant="outline" 
                                    className={`cursor-pointer bg-zinc-900 hover:bg-zinc-800 py-1.5 px-3 flex items-center gap-1.5 whitespace-nowrap transition-all border ${action.color}`}
                                    onClick={() => handleAiSubmit(undefined, action.query)}
                                >
                                    {action.icon} {action.label}
                                </Badge>
                            ))}
                        </div>

                        {/* Input Area */}
                        <form onSubmit={(e) => handleAiSubmit(e)} className="p-3 border-t border-white/10 bg-zinc-900/50 flex gap-2 items-center">
                            <div className="relative flex-1">
                                <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
                                <Input 
                                    value={aiInput} 
                                    onChange={(e) => setAiInput(e.target.value)} 
                                    placeholder="Where to?" 
                                    className="bg-zinc-950/80 border-zinc-700/50 focus-visible:ring-indigo-500 pl-9 text-white placeholder:text-zinc-600 rounded-full" 
                                />
                            </div>
                            <Button type="submit" size="icon" className="bg-indigo-600 hover:bg-indigo-500 shrink-0 rounded-full h-10 w-10 shadow-lg shadow-indigo-900/20">
                                <Send className="h-4 w-4" />
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        )}

        {/* Selected Location Sheet (Manual Click) */}
        <Sheet open={isDrawerOpen && !isAiOpen} onOpenChange={(open) => !open && !isNavigating.current && setIsDrawerOpen(false)}>
          <SheetContent side="bottom" className="rounded-t-3xl p-6 border-zinc-800 sm:max-w-md sm:mx-auto bg-zinc-900/95 text-white mb-[safe-area-inset-bottom] backdrop-blur-xl ring-1 ring-white/10">
            {locationDetails && (
              <div className="space-y-6 pb-2">
                <div className="mx-auto w-12 h-1.5 rounded-full bg-zinc-700/50 mb-2" />
                <SheetHeader className="text-left space-y-3">
                   <SheetTitle className="text-2xl font-bold line-clamp-2 leading-tight text-white tracking-tight">
                        {isFetchingAddress ? <Skeleton className="h-8 w-2/3 bg-zinc-800" /> : (addressDetails?.formatted || "Marked Location")}
                   </SheetTitle>
                   <SheetDescription asChild>
                      <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
                        {isFetchingAddress ? <Skeleton className="h-5 w-1/3 bg-zinc-800" /> : <><MapPin className="h-4 w-4 text-zinc-500" />{locationDetails.lat.toFixed(5)}, {locationDetails.lng.toFixed(5)}</>}
                      </div>
                   </SheetDescription>
                </SheetHeader>
                <SheetFooter className="pt-2">
                  <Button className="w-full gap-2 bg-blue-600 hover:bg-blue-500 text-white h-14 text-lg font-bold rounded-xl shadow-lg shadow-blue-900/20 transition-all hover:scale-[1.02] active:scale-[0.98]" onClick={handleStartNavigation}>
                    <Navigation className="h-5 w-5 fill-current" /> Start Navigation
                  </Button>
                </SheetFooter>
              </div>
            )}
          </SheetContent>
        </Sheet>
    </div>
  );
}