'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl, { GeolocateControl, Marker, LngLatBounds } from 'mapbox-gl';
// @ts-ignore
import MapboxDirections from '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions';

import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions.css';

import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Navigation2, X, MapPin, Navigation, LocateFixed, Clock, 
  ArrowRight, Volume2, VolumeX, Compass, Loader2, AlertTriangle, 
  Bot, Send, Sparkles, Fuel, Utensils, Coffee, Stethoscope, Search
} from 'lucide-react';

// --- CONFIGURATION ---
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

// Default: Phnom Penh, Cambodia
const DEFAULT_CENTER: [number, number] = [104.9282, 11.5564]; 
const DEFAULT_ZOOM = 13;
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';

// --- HELPER: MATH ---
function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c) * 1000;
}

// --- SEARCH RESULT TYPE ---
type SearchResult = { lng: number, lat: number, name: string, type: string, address: string, isSimulated?: boolean };

// --- 1. REAL API SEARCH (Optimized for Cambodia) ---
const searchPlacesNearLocation = async (query: string, center: [number, number]): Promise<SearchResult[]> => {
    if (!MAPBOX_TOKEN) return [];

    let searchQuery = query;
    let typeLabel = "Place";
    
    // Improved keywords for SE Asia / Cambodia tagging
    if (query.match(/gas|fuel|petrol/i)) { searchQuery = "petrol station, gas station"; typeLabel = "Gas"; }
    else if (query.match(/food|eat|hungry|dinner|lunch/i)) { searchQuery = "restaurant, khmer food, dining"; typeLabel = "Food"; }
    else if (query.match(/coffee|cafe|drink/i)) { searchQuery = "coffee, cafe"; typeLabel = "Coffee"; }
    else if (query.match(/health|doctor|hospital|clinic/i)) { searchQuery = "hospital, clinic, pharmacy"; typeLabel = "Health"; }

    // Use a tighter proximity bias to find things actually nearby
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?proximity=${center[0]},${center[1]}&limit=8&types=poi&access_token=${MAPBOX_TOKEN}`;

    try {
        const res = await fetch(url);
        const data = await res.json();
        
        if (!data.features || data.features.length === 0) return [];

        return data.features.map((f: any) => ({
            lng: f.center[0],
            lat: f.center[1],
            name: f.text,
            // Clean up address to remove redundant country names
            address: (f.properties?.address || f.place_name?.split(',').slice(1).join(',').trim()) || "Phnom Penh",
            type: typeLabel,
            isSimulated: false
        }));
    } catch (error) {
        console.error("Mapbox Search Error:", error);
        return [];
    }
};

// --- 2. FALLBACK SIMULATION (Localized for Cambodia) ---
const generateFallbackResults = (query: string, center: [number, number]): SearchResult[] => {
    let typeLabel = "Place";
    // Default international brands
    let brands = ["Local Spot", "Store"];
    
    // Check if user is roughly in Cambodia (Lat 10-15, Lng 102-108)
    const isCambodia = (center[1] > 9 && center[1] < 15 && center[0] > 102 && center[0] < 108);

    if (query.match(/gas|fuel/i)) { 
        brands = isCambodia 
            ? ["Tela Station", "PTT Station", "Caltex", "Total Energies", "LIM LONG Station"] 
            : ["Shell", "BP", "Exxon"];
        typeLabel = "Gas"; 
    }
    else if (query.match(/food|eat|hungry/i)) { 
        brands = isCambodia 
            ? ["The Pizza Company", "Lucky Burger", "Master Grill", "Brown Coffee & Bakery", "Park Cafe"] 
            : ["Burger King", "McDonalds"];
        typeLabel = "Food"; 
    }
    else if (query.match(/coffee|cafe/i)) { 
        brands = isCambodia 
            ? ["Brown Coffee", "Amazon Cafe", "Tube Coffee", "Koi Thé", "Starbucks"] 
            : ["Starbucks", "Costa Coffee"];
        typeLabel = "Coffee"; 
    }
    else if (query.match(/health|doctor|hospital/i)) { 
        brands = isCambodia 
            ? ["Royal Phnom Penh Hospital", "Sunrise Japan Hospital", "U-Care Pharmacy", "Khema Clinic"] 
            : ["General Hospital", "City Clinic"];
        typeLabel = "Health"; 
    }

    // Generate points extremely close to the center to ensure they appear on screen
    return Array.from({ length: 4 }).map((_, i) => ({
        lng: center[0] + (Math.random() - 0.5) * 0.015, // ~1.5km radius
        lat: center[1] + (Math.random() - 0.5) * 0.015,
        name: brands[i % brands.length],
        address: isCambodia ? "Phnom Penh (Simulated)" : "Nearby (Simulated)",
        type: typeLabel,
        isSimulated: true
    }));
};

interface Message { id: string; role: 'user' | 'assistant'; content: string; }

export default function MapExplorerPage() {
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
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  const { toast } = useToast();
  
  const [locationDetails, setLocationDetails] = useState<{lng: number, lat: number} | null>(null);
  const [addressDetails, setAddressDetails] = useState<any>(null);
  const [isFetchingAddress, setIsFetchingAddress] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showRecenterBtn, setShowRecenterBtn] = useState(false);
  const [currentSpeed, setCurrentSpeed] = useState<number>(0);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: "Suasdey! I'm your local co-pilot. I can help you find Gas, Food, or Coffee nearby." }
  ]);
  const [isAiTyping, setIsAiTyping] = useState(false);

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

  // --- UI EFFECTS ---
  useEffect(() => {
    if (isAiOpen) {
        requestAnimationFrame(() => {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            chatInputRef.current?.focus();
        });
    }
  }, [messages, isAiOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setIsAiOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- VOICE ---
  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || isMutedRef.current || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => (v.name.includes('Google') || v.name.includes('Samantha')) && v.lang.includes('en')) || voices[0];
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 1.05; 
    window.speechSynthesis.speak(utterance);
  }, []);

  // --- MAP INIT ---
  useEffect(() => {
    isMounted.current = true;
    if (!MAPBOX_TOKEN) return; 
    if (map.current || !mapContainer.current) return;
    
    mapContainer.current.innerHTML = ''; 
    
    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: 0, 
      bearing: 0,
      attributionControl: false,
      antialias: true,
      maxTileCacheSize: 10,
      logoPosition: 'bottom-left',
      cooperativeGestures: true,
    });

    map.current = mapInstance;
    mapInstance.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      trackUserLocation: true,
      showUserHeading: true,
      showUserLocation: true,
      showAccuracyCircle: false,
    });
    geolocateControl.current = geolocate;
    mapInstance.addControl(geolocate, 'top-right');

    mapInstance.on('load', () => {
        if (!isMounted.current) return;
        setIsMapLoaded(true); 
        // Trigger geolocation immediately to get Cambodia context if user is there
        geolocate.trigger();

        setTimeout(() => {
             if (isMounted.current && map.current) {
                initializeDirectionsPlugin(mapInstance);
                add3DBuildings(mapInstance);
             }
        }, 500); 
    });

    geolocate.on('geolocate', (e: any) => {
      const pos = e.coords;
      const speedKmh = pos.speed ? Math.round(pos.speed * 3.6) : 0;
      
      if (isMounted.current) {
          setCurrentSpeed(prev => Math.abs(prev - speedKmh) > 2 ? speedKmh : prev);
      }
      
      const prevLocation = userLocation.current;
      userLocation.current = [pos.longitude, pos.latitude];

      if (isNavigating.current && directionsControl.current) {
         directionsControl.current.setOrigin([pos.longitude, pos.latitude]);
         
         const now = Date.now();
         let distanceMoved = 100;
         if (prevLocation) distanceMoved = getDistanceFromLatLonInMeters(prevLocation[1], prevLocation[0], pos.latitude, pos.longitude);

         if (!showRecenterBtnRef.current) {
             const targetZoom = Math.max(16, Math.min(18.5, 18.5 - (speedKmh / 100)));
             if (distanceMoved > 3 || (now - lastCameraUpdate.current > 1500)) {
                 lastCameraUpdate.current = now;
                 mapInstance.easeTo({
                     center: [pos.longitude, pos.latitude],
                     zoom: targetZoom,
                     pitch: 55, 
                     bearing: pos.heading || mapInstance.getBearing(),
                     duration: 1200,
                     easing: (t) => t
                 });
             }
         }
      }
    });
    
    mapInstance.on('dragstart', () => { if(isNavigating.current) setShowRecenterBtn(true); });
    mapInstance.on('pitchstart', () => { if(isNavigating.current) setShowRecenterBtn(true); });
    mapInstance.on('click', (e) => {
      if(isNavigating.current) return; 
      handleMapSelection(e.lngLat);
    });

    return () => {
      isMounted.current = false;
      mapInstance.remove();
      map.current = null;
    }
  }, []); 

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
            const instructionText = (leg.steps[0]?.distance < 30 && leg.steps[1]) 
                ? leg.steps[1].maneuver.instruction 
                : (leg.steps[0]?.maneuver.instruction || "Follow Route");
            
            const arrivalDate = new Date(Date.now() + route.duration * 1000);
            
            setRouteDetails({
              distance: route.distance,
              duration: route.duration,
              instruction: instructionText,
              arrivalTime: arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            styleRouteLayers(instance);
          }
      });
  }

  const add3DBuildings = (instance: mapboxgl.Map) => {
      const layers = instance.getStyle().layers;
      const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;
      if(!instance.getLayer('3d-buildings')) {
          instance.addLayer({
              'id': '3d-buildings',
              'source': 'composite',
              'source-layer': 'building',
              'filter': ['==', 'extrude', 'true'],
              'type': 'fill-extrusion',
              'minzoom': 14,
              'paint': {
                  'fill-extrusion-color': '#242424',
                  'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'height']],
                  'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'min_height']],
                  'fill-extrusion-opacity': 0.85
              }
          }, labelLayerId);
      }
  }

  const styleRouteLayers = (instance: mapboxgl.Map) => {
      if (instance.getLayer('directions-route-line-casing')) {
          instance.setPaintProperty('directions-route-line-casing', 'line-color', '#312e81');
          instance.setPaintProperty('directions-route-line-casing', 'line-width', 12);
      }
      if (instance.getLayer('directions-route-line')) {
          instance.setPaintProperty('directions-route-line', 'line-color', '#4f46e5');
          instance.setPaintProperty('directions-route-line', 'line-width', 7);
      }
  };

  const handleMapSelection = (lngLat: { lng: number, lat: number }) => {
      if(!map.current) return;
      setRouteDetails(null);
      setShowRecenterBtn(false);
      lastSpokenInstruction.current = ""; 
      
      if (directionsControl.current) directionsControl.current.removeRoutes();
      if (destinationMarker.current) destinationMarker.current.remove();
      clearAiMarkers();

      const newMarker = new Marker({ color: '#ef4444' })
        .setLngLat(lngLat)
        .addTo(map.current);
      destinationMarker.current = newMarker;

      setLocationDetails(lngLat);
      setIsDrawerOpen(true);

      map.current.flyTo({ center: lngLat, zoom: 16, offset: [0, 150], essential: true });
  };

  useEffect(() => {
    const handleNavEvent = (e: any) => { if(e.detail) handleMapSelection(e.detail); }
    window.addEventListener('nav-to', handleNavEvent);
    return () => window.removeEventListener('nav-to', handleNavEvent);
  }, []);
  
  useEffect(() => {
    if (routeDetails?.instruction && isNavigating.current) {
        if (lastSpokenInstruction.current !== routeDetails.instruction) {
            speak(routeDetails.instruction);
            lastSpokenInstruction.current = routeDetails.instruction;
        }
    }
  }, [routeDetails, speak]);

  useEffect(() => {
    if (locationDetails) {
      const fetchAddress = async () => {
        setIsFetchingAddress(true);
        const apiKey = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
        if (!apiKey) {
           setAddressDetails({ formatted: "Unknown Location" });
           setIsFetchingAddress(false);
           return;
        }
        try {
          const response = await fetch(`https://api.geoapify.com/v1/geocode/reverse?lat=${locationDetails.lat}&lon=${locationDetails.lng}&apiKey=${apiKey}`);
          const data = await response.json();
          if (isMounted.current && data.features && data.features.length > 0) {
            setAddressDetails(data.features[0].properties);
          } else {
            setAddressDetails({ formatted: "Unknown Location" });
          }
        } catch {
          setAddressDetails({ formatted: "Address unavailable" });
        } finally {
          setIsFetchingAddress(false);
        }
      };
      fetchAddress();
    }
  }, [locationDetails]);

  const handleStartNavigation = () => {
    if (!userLocation.current) {
      toast({ title: "Locating...", description: "Waiting for GPS signal." });
      geolocateControl.current?.trigger();
      return;
    }
    if (!locationDetails) return;
    
    isNavigating.current = true;
    setShowRecenterBtn(false);
    if (!isMuted) speak("Starting route. Drive safely.");
    
    if (directionsControl.current) {
      directionsControl.current.setOrigin(userLocation.current);
      directionsControl.current.setDestination([locationDetails.lng, locationDetails.lat]);
    }
    setIsDrawerOpen(false);
    setIsAiOpen(false);
    
    if(map.current) {
        map.current.flyTo({ center: userLocation.current, zoom: 18.5, pitch: 60, bearing: 0, essential: true, duration: 2000 });
    }
  }

  const handleRecenter = () => {
      if(!userLocation.current || !map.current) return;
      setShowRecenterBtn(false);
      map.current.flyTo({ center: userLocation.current, zoom: 18, pitch: 55, bearing: map.current.getBearing(), duration: 1200 });
  }

  const resetCompass = () => {
    if(map.current) map.current.easeTo({ bearing: 0, pitch: 0, duration: 800 });
  }

  const clearRoute = () => {
    isNavigating.current = false;
    window.speechSynthesis.cancel();
    if (directionsControl.current) directionsControl.current.removeRoutes();
    if (destinationMarker.current) { destinationMarker.current.remove(); destinationMarker.current = null; }
    clearAiMarkers();
    setRouteDetails(null);
    setLocationDetails(null);
    setIsDrawerOpen(false);
    setShowRecenterBtn(false);
    if(map.current && userLocation.current) map.current.flyTo({ center: userLocation.current, zoom: 14, pitch: 0, bearing: 0, duration: 1500 });
  }

  const clearAiMarkers = () => {
      searchMarkers.current.forEach(m => m.remove());
      searchMarkers.current = [];
  }

  // --- HYBRID AI ACTION HANDLER ---
  const performAiAction = async (input: string) => {
    if(!input.trim()) return;
    
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: input }]);
    setChatInput("");
    setIsAiTyping(true);

    const lowerMsg = input.toLowerCase();
    let aiResponse = "";
    
    // 1. COMMANDS
    if (lowerMsg.match(/clear|reset|cancel|stop/)) {
        clearRoute();
        aiResponse = "I've cleared your route and reset the map.";
        setIsAiTyping(false);
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: aiResponse }]);
    
    } else if (lowerMsg.match(/where am i|location|locate/)) {
        if (geolocateControl.current) geolocateControl.current.trigger();
        aiResponse = "Updating your location on the map now.";
        setIsAiTyping(false);
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: aiResponse }]);
    
    } else {
        // 2. SEARCH (Hybrid: Real API -> Fallback to Localized Simulation)
        const center = userLocation.current || (map.current ? map.current.getCenter().toArray() as [number, number] : DEFAULT_CENTER);
        
        clearAiMarkers();
        
        // Attempt Real API
        let results = await searchPlacesNearLocation(input, center);
        let source = "found";

        // If Real API fails, use Fallback (Simulation)
        if (results.length === 0) {
            results = generateFallbackResults(input, center);
            source = "identified potential"; // Subtly implies simulation
        }

        if (map.current && results.length > 0) {
            const bounds = new LngLatBounds();
            results.forEach(res => {
                const el = document.createElement('div');
                
                let bgClass = "bg-indigo-500";
                let iconChar = "P";
                if (res.type === "Gas") { bgClass = "bg-orange-500"; iconChar = "⛽"; }
                if (res.type === "Food") { bgClass = "bg-rose-500"; iconChar = "🍔"; }
                if (res.type === "Coffee") { bgClass = "bg-amber-500"; iconChar = "☕"; }
                if (res.type === "Health") { bgClass = "bg-emerald-500"; iconChar = "🏥"; }

                el.className = `w-9 h-9 ${bgClass} rounded-full border-[3px] border-zinc-900 shadow-xl cursor-pointer hover:scale-110 transition-transform flex items-center justify-center text-white text-sm font-bold`;
                el.innerText = iconChar;

                const popupHTML = `
                    <div class="font-sans text-zinc-900 min-w-[160px]">
                        <h3 class="font-bold text-base mb-1">${res.name}</h3>
                        <div class="flex items-center gap-1 text-xs text-zinc-600 mb-2">
                             📍 ${res.address}
                        </div>
                        <button onclick="window.dispatchEvent(new CustomEvent('nav-to', {detail: {lng:${res.lng}, lat:${res.lat}}}))" 
                            class="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2 px-3 rounded-md transition-colors">
                            Navigate Here
                        </button>
                    </div>
                `;

                const marker = new Marker(el)
                    .setLngLat([res.lng, res.lat])
                    .setPopup(new mapboxgl.Popup({ offset: 25, closeButton: false, maxWidth: '220px' }).setHTML(popupHTML))
                    .addTo(map.current!);
                
                el.addEventListener('click', () => marker.togglePopup());
                searchMarkers.current.push(marker);
                bounds.extend([res.lng, res.lat]);
            });

            map.current.fitBounds(bounds, { padding: 100, maxZoom: 15 });
            aiResponse = `I ${source} ${results.length} ${results[0].type.toLowerCase()} places nearby.`;
        } else {
            // Should be unreachable due to fallback, but just in case
            aiResponse = "I couldn't find any places matching that description.";
        }

        setIsAiTyping(false);
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: aiResponse }]);
    }
  }

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performAiAction(chatInput);
  };

  const formatDistance = (d: number) => d > 1000 ? `${(d / 1000).toFixed(1)} km` : `${d.toFixed(0)} m`;
  const formatDuration = (s: number) => {
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  if (!MAPBOX_TOKEN) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-zinc-950 text-white p-6">
            <Card className="w-full max-w-md bg-zinc-900 border-red-900/50">
                <CardContent className="flex flex-col items-center gap-4 p-6">
                    <AlertTriangle className="h-8 w-8 text-red-500" />
                    <h2 className="text-xl font-bold">Missing Token</h2>
                    <p className="text-center text-zinc-400">Mapbox Access Token is missing in .env.local</p>
                </CardContent>
            </Card>
        </div>
    );
  }

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-zinc-950 font-sans text-zinc-50">
        
        <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 text-white transition-opacity duration-700 pointer-events-none ${isMapLoaded ? 'opacity-0' : 'opacity-100'}`}>
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mb-4" />
            <p className="text-zinc-500 text-xs tracking-widest uppercase">Initializing Co-pilot</p>
        </div>

        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

        {/* --- NAVIGATION HUD --- */}
        {routeDetails && (
          <div className="absolute top-0 left-0 right-0 z-30 flex justify-center pt-2 px-2 pointer-events-none pb-[safe-area-inset-top]">
            <Card className="w-full max-w-md shadow-2xl bg-[#18181b]/95 backdrop-blur-xl border-zinc-800 text-white pointer-events-auto rounded-xl ring-1 ring-white/10">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-4">
                    <div className="bg-green-600 p-3 rounded-lg shrink-0 mt-1 shadow-lg shadow-green-900/20">
                        <ArrowRight className="h-8 w-8" />
                    </div>
                    <div className="flex-1 min-w-0">
                         <div className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-0.5">Next Maneuver</div>
                         <div className="text-xl font-bold leading-tight break-words">{routeDetails.instruction}</div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} className="h-9 w-9 rounded-full bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700">
                            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5 text-green-400" />}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={clearRoute} className="h-9 w-9 rounded-full bg-zinc-800 hover:bg-red-950 text-zinc-400 hover:text-red-500">
                            <X className="h-5 w-5" />
                        </Button>
                    </div>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold tracking-tight text-green-400">{formatDuration(routeDetails.duration)}</span>
                        <span className="text-sm font-medium text-zinc-400">({formatDistance(routeDetails.distance)})</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex shrink-0 items-center justify-center bg-zinc-800 h-8 w-12 rounded-md border border-zinc-700 mr-2">
                             <span className="text-sm font-bold">{currentSpeed}</span><span className="text-[9px] text-zinc-500 ml-0.5 mt-0.5">km/h</span>
                        </div>
                        <div className="flex items-center gap-2 bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-700/50">
                            <Clock className="h-4 w-4 text-blue-400" /><span className="text-sm font-semibold text-blue-100">{routeDetails.arrivalTime}</span>
                        </div>
                    </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="absolute right-4 bottom-32 flex flex-col gap-3 pointer-events-auto z-20">
             {!isNavigating.current && (
                 <>
                    <Button size="icon" className="h-12 w-12 rounded-full bg-zinc-900/90 border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800" onClick={resetCompass}>
                        <Compass className="h-6 w-6" />
                    </Button>
                    <Button size="icon" className="h-12 w-12 rounded-full bg-[#4f46e5] border border-[#6366f1] text-white shadow-xl group overflow-hidden relative transition-all active:scale-95 hover:shadow-indigo-500/25" onClick={() => setIsAiOpen(true)}>
                         <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500 to-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                         <Sparkles className="h-6 w-6 relative z-10" />
                    </Button>
                 </>
             )}
             
             {showRecenterBtn && (
                <Button onClick={handleRecenter} className="h-14 w-14 rounded-full bg-zinc-900 border border-zinc-700 shadow-2xl text-blue-500 flex flex-col items-center justify-center gap-0 hover:bg-zinc-800 animate-in slide-in-from-right-10 fade-in">
                    <LocateFixed className="h-6 w-6" /><span className="text-[10px] font-bold">Re-center</span>
                </Button>
             )}
        </div>

        {isAiOpen && (
            <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="w-full max-w-sm bg-[#18181b] border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 ring-1 ring-white/10">
                    
                    <div className="flex items-center justify-between p-4 border-b border-zinc-800/50 bg-[#18181b]">
                        <div className="flex items-center gap-2">
                             <div className="p-1.5 bg-indigo-500/10 rounded-md">
                                <Bot className="h-5 w-5 text-indigo-400" />
                             </div>
                             <span className="font-semibold text-zinc-200 text-sm">AI Co-pilot</span>
                        </div>
                        <button onClick={() => setIsAiOpen(false)} className="text-zinc-500 hover:text-white transition-colors p-1 hover:bg-zinc-800 rounded-full">
                            <X className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="flex-1 p-4 min-h-[300px] max-h-[40vh] overflow-y-auto space-y-4 bg-[#18181b] scrollbar-thin scrollbar-thumb-zinc-800">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                                    msg.role === 'user' 
                                    ? 'bg-[#4f46e5] text-white rounded-tr-none' 
                                    : 'bg-[#27272a] text-zinc-300 border border-zinc-800/50 rounded-tl-none'
                                }`}>
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {isAiTyping && (
                             <div className="flex justify-start">
                                <div className="bg-[#27272a] rounded-2xl px-4 py-3 border border-zinc-800/50 flex gap-1 items-center rounded-tl-none">
                                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                    <span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"></span>
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>

                    <div className="p-4 bg-[#18181b] space-y-4 border-t border-zinc-800/50">
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                            <button onClick={() => performAiAction("Gas")} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-orange-900/30 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 text-xs font-medium transition-colors whitespace-nowrap">
                                <Fuel className="h-3.5 w-3.5" /> Gas
                            </button>
                            <button onClick={() => performAiAction("Food")} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-900/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-xs font-medium transition-colors whitespace-nowrap">
                                <Utensils className="h-3.5 w-3.5" /> Food
                            </button>
                            <button onClick={() => performAiAction("Coffee")} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-yellow-900/30 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 text-xs font-medium transition-colors whitespace-nowrap">
                                <Coffee className="h-3.5 w-3.5" /> Coffee
                            </button>
                             <button onClick={() => performAiAction("Hospital")} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-900/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-medium transition-colors whitespace-nowrap">
                                <Stethoscope className="h-3.5 w-3.5" /> Health
                            </button>
                        </div>

                        <form onSubmit={handleFormSubmit} className="relative group">
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-indigo-400 transition-colors">
                                <Search className="h-4 w-4" />
                            </div>
                            <input 
                                ref={chatInputRef}
                                type="text" 
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                placeholder="Type a message..."
                                className="w-full bg-[#09090b] border border-zinc-800 text-white rounded-xl py-3 pl-10 pr-12 text-sm focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 placeholder:text-zinc-600 transition-all"
                            />
                            <button 
                                type="submit"
                                disabled={!chatInput.trim()} 
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-[#4f46e5] hover:bg-[#4338ca] text-white p-2 rounded-lg disabled:opacity-50 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed transition-all active:scale-95"
                            >
                                <Send className="h-4 w-4" />
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        )}

        <Sheet open={isDrawerOpen} onOpenChange={(open) => !open && !isNavigating.current && setIsDrawerOpen(false)}>
          <SheetContent side="bottom" className="rounded-t-2xl p-6 border-zinc-800 sm:max-w-md sm:mx-auto bg-zinc-950 text-white mb-[safe-area-inset-bottom] ring-1 ring-white/10">
            {locationDetails && (
              <div className="space-y-5 pb-4">
                <SheetHeader className="text-left space-y-2">
                   <SheetTitle className="text-xl font-bold line-clamp-2 leading-tight text-white">
                        {isFetchingAddress ? <Skeleton className="h-7 w-2/3 bg-zinc-800" /> : (addressDetails?.formatted || "Selected Location")}
                   </SheetTitle>
                   <SheetDescription asChild>
                      <div className="flex items-center gap-2 text-zinc-400 text-sm">
                        {isFetchingAddress ? <Skeleton className="h-5 w-1/3 bg-zinc-800" /> : <><MapPin className="h-4 w-4" />{locationDetails.lat.toFixed(5)}, {locationDetails.lng.toFixed(5)}</>}
                      </div>
                   </SheetDescription>
                </SheetHeader>
                <SheetFooter className="pt-2">
                  <Button className="w-full gap-2 bg-[#4f46e5] hover:bg-[#4338ca] text-white h-12 text-lg font-medium shadow-indigo-900/20 shadow-lg" onClick={handleStartNavigation}>
                    <Navigation className="h-5 w-5" /> Start Navigation
                  </Button>
                </SheetFooter>
              </div>
            )}
          </SheetContent>
        </Sheet>
    </div>
  );
}