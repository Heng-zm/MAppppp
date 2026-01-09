'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl, { GeolocateControl, Marker, LngLatBounds, Map as MapboxMap } from 'mapbox-gl';
import { Kantumruy_Pro } from 'next/font/google'; 
import 'mapbox-gl/dist/mapbox-gl.css';

import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  X, MapPin, Navigation, LocateFixed, 
  Volume2, VolumeX, Compass, Loader2, AlertTriangle, 
  Bot, Send, Sparkles, Fuel, Utensils, Coffee, Search,
  Layers, Zap, CornerUpLeft, CornerUpRight, ArrowUp,
  Sun, Cloud, CloudRain, CloudLightning, Snowflake, Wind
} from 'lucide-react';

// --- FONT ---
const kantumruy = Kantumruy_Pro({
  subsets: ['khmer', 'latin'], 
  weight: ['400', '500', '700'],
  display: 'swap',
});

// --- CONFIG ---
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const WEATHER_API_KEY = process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY;

if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

const DEFAULT_CENTER: [number, number] = [104.9282, 11.5564]; 
const DEFAULT_ZOOM = 15;
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';

// --- UTILS ---
function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c) * 1000;
}

type SearchResult = { lng: number, lat: number, name: string, type: string, address: string };

const mapFeaturesToResults = (features: any[], typeLabel: string): SearchResult[] => {
    return features.map((f: any) => ({
        lng: f.center[0],
        lat: f.center[1],
        name: f.text,
        address: (f.properties?.address || f.place_name?.split(',').slice(1).join(',').trim()) || "ទីតាំង",
        type: typeLabel
    }));
}

// --- API SEARCH ---
const searchPlacesNearLocation = async (
    query: string, center: [number, number], bbox?: mapboxgl.LngLatBounds, signal?: AbortSignal
): Promise<SearchResult[]> => {
    if (!MAPBOX_TOKEN) return [];
    let searchQuery = query;
    let typeLabel = "ទីកន្លែង";
    
    // Translation mapping for search intent
    if (query.match(/gas|fuel|petrol|ប្រេង|សាំង/i)) { searchQuery = "gas station"; typeLabel = "ប្រេង"; }
    else if (query.match(/food|eat|hungry|dinner|lunch|អាហារ|បាយ/i)) { searchQuery = "restaurant"; typeLabel = "អាហារ"; }
    else if (query.match(/coffee|cafe|drink|កាហ្វេ/i)) { searchQuery = "coffee"; typeLabel = "កាហ្វេ"; }
    else if (query.match(/health|doctor|hospital|clinic|ពេទ្យ|សុខភាព/i)) { searchQuery = "hospital"; typeLabel = "សុខភាព"; }

    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?proximity=${center[0]},${center[1]}&limit=10&language=km&access_token=${MAPBOX_TOKEN}`;
    if (bbox) url += `&bbox=${bbox.getWest()},${bbox.getSouth()},${bbox.getEast()},${bbox.getNorth()}`;

    try {
        const res = await fetch(url, { signal });
        const data = await res.json();
        if ((!data.features || data.features.length === 0) && bbox) {
            // Fallback search without bbox
            const fallbackUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?proximity=${center[0]},${center[1]}&limit=10&language=km&access_token=${MAPBOX_TOKEN}`;
            const fallbackRes = await fetch(fallbackUrl, { signal });
            const fallbackData = await fallbackRes.json();
            if (fallbackData.features) return mapFeaturesToResults(fallbackData.features, typeLabel);
            return [];
        }
        return mapFeaturesToResults(data.features || [], typeLabel);
    } catch { return []; }
};

// --- WEATHER HELPERS ---
type WeatherData = { temp: number; condition: string; description: string };

const getWeatherIcon = (condition: string) => {
    const c = condition.toLowerCase();
    if (c.includes('rain') || c.includes('drizzle') || c.includes('ភ្លៀង')) return <CloudRain className="h-5 w-5 text-blue-400" />;
    if (c.includes('thunder') || c.includes('រន្ទះ')) return <CloudLightning className="h-5 w-5 text-yellow-400" />;
    if (c.includes('snow')) return <Snowflake className="h-5 w-5 text-white" />;
    if (c.includes('cloud') || c.includes('ពពក')) return <Cloud className="h-5 w-5 text-gray-400" />;
    if (c.includes('clear') || c.includes('sun') || c.includes('ស្រឡះ')) return <Sun className="h-5 w-5 text-orange-400" />;
    return <Wind className="h-5 w-5 text-zinc-400" />;
};

// --- ICON HELPER ---
const ManeuverIcon = ({ instruction }: { instruction: string }) => {
    const text = instruction.toLowerCase();
    const iconClass = "h-10 w-10 text-white";
    if (text.includes('left') || text.includes('ឆ្វេង')) return <CornerUpLeft className={iconClass} />;
    if (text.includes('right') || text.includes('ស្តាំ')) return <CornerUpRight className={iconClass} />;
    if (text.includes('straight') || text.includes('continue') || text.includes('ត្រង់')) return <ArrowUp className={iconClass} />;
    if (text.includes('uturn') || text.includes('ត្រឡប់')) return <Zap className={iconClass} />;
    return <Navigation className={iconClass} />;
}

interface Message { id: string; role: 'user' | 'assistant'; content: string; }

export default function MapExplorerPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapboxMap | null>(null);
  
  const geolocateControl = useRef<GeolocateControl | null>(null);
  const destinationMarker = useRef<Marker | null>(null);
  const puckMarker = useRef<Marker | null>(null);
  const puckElement = useRef<HTMLDivElement | null>(null);

  const searchMarkers = useRef<Marker[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const userLocation = useRef<[number, number] | null>(null);
  const isNavigating = useRef<boolean>(false);
  
  const userIsInteracting = useRef<boolean>(false); 
  const isMounted = useRef<boolean>(false);
  
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
  const [isTrafficVisible, setIsTrafficVisible] = useState(true);
  
  // Weather State
  const [weather, setWeather] = useState<WeatherData | null>(null);
  
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  // Initial message in Khmer
  const [messages, setMessages] = useState<Message[]>([{ id: '1', role: 'assistant', content: "សួស្តី! តើអ្នកចង់ទៅណា?" }]);
  const [isAiTyping, setIsAiTyping] = useState(false);

  const [routeDetails, setRouteDetails] = useState<{
    distance: number; 
    duration: number;
    instruction: string;
    arrivalTime: string;
  } | null>(null);

  const showRecenterBtnRef = useRef(false);
  const isMutedRef = useRef(false);
  const lastSpokenInstruction = useRef<string>("");
  
  useEffect(() => { showRecenterBtnRef.current = showRecenterBtn; }, [showRecenterBtn]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  useEffect(() => {
    if (isAiOpen) {
        requestAnimationFrame(() => {
             chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
             if (window.matchMedia('(min-width: 768px)').matches) chatInputRef.current?.focus();
        });
    }
  }, [messages, isAiOpen]);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || isMutedRef.current || !window.speechSynthesis) return;
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    // Try to find a Khmer voice, fallback to Google/English
    const preferredVoice = voices.find(v => v.lang.includes('km') || v.name.includes('Google') || v.name.includes('Samantha'));
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 1.05; 
    window.speechSynthesis.speak(utterance);
  }, []);

  // --- WEATHER FETCHING (Khmer Lang) ---
  const fetchWeather = useCallback(async (lat: number, lon: number) => {
      if (!WEATHER_API_KEY) return;
      try {
          // Added &lang=km for Khmer description
          const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&lang=km&appid=${WEATHER_API_KEY}`);
          const data = await res.json();
          if (data.main && data.weather) {
              setWeather({
                  temp: Math.round(data.main.temp),
                  condition: data.weather[0].main,
                  description: data.weather[0].description
              });
          }
      } catch (err) { console.error("Weather fetch failed", err); }
  }, []);

  // --- MAP LAYERS ---
  const add3DBuildings = useCallback((instance: MapboxMap) => {
    if (!instance.getStyle()) return;
    const layers = instance.getStyle().layers;
    const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;
    
    if(!instance.getLayer('3d-buildings')) {
        instance.addLayer({
            'id': '3d-buildings', 'source': 'composite', 'source-layer': 'building',
            'filter': ['==', 'extrude', 'true'], 'type': 'fill-extrusion', 'minzoom': 14,
            'paint': {
                'fill-extrusion-color': '#2a2a2e',
                'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'height']],
                'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.05, ['get', 'min_height']],
                'fill-extrusion-opacity': 0.95
            }
        }, labelLayerId);
    }
  }, []);

  const addTrafficLayer = useCallback((instance: MapboxMap) => {
      if (!instance.getStyle()) return;
      if (instance.getSource('mapbox-traffic')) return;
      
      instance.addSource('mapbox-traffic', { type: 'vector', url: 'mapbox://mapbox.mapbox-traffic-v1' });
      const layers = instance.getStyle().layers;
      const roadLabelId = layers?.find((layer) => layer.type === 'symbol' && layer.source === 'composite')?.id;

      instance.addLayer({
          'id': 'traffic', 'type': 'line', 'source': 'mapbox-traffic', 'source-layer': 'traffic', 'minzoom': 12,
          'layout': { 'line-join': 'round', 'line-cap': 'round' },
          'paint': {
              'line-width': 2.5,
              'line-color': [
                  'case',
                  ['==', ['get', 'congestion'], 'low'], '#22c55e',
                  ['==', ['get', 'congestion'], 'moderate'], '#eab308',
                  ['==', ['get', 'congestion'], 'heavy'], '#ef4444',
                  ['==', ['get', 'congestion'], 'severe'], '#7f1d1d',
                  'rgba(0,0,0,0)'
              ],
              'line-opacity': 0.8
          }
      }, roadLabelId);
  }, []);

  const toggleTraffic = () => {
      if (!map.current) return;
      if (map.current.getLayer('traffic')) {
          map.current.setLayoutProperty('traffic', 'visibility', isTrafficVisible ? 'none' : 'visible');
          setIsTrafficVisible(!isTrafficVisible);
      }
  };

  const drawBlueRoute = (instance: MapboxMap, geojson: any) => {
      if (!geojson || !geojson.geometry) return;
      if (instance.getLayer('custom-route-core')) instance.removeLayer('custom-route-core');
      if (instance.getLayer('custom-route-casing')) instance.removeLayer('custom-route-casing');
      if (instance.getSource('custom-route-source')) instance.removeSource('custom-route-source');

      instance.addSource('custom-route-source', { type: 'geojson', data: geojson });
      const layers = instance.getStyle().layers;
      const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;

      // Casing
      instance.addLayer({
          id: 'custom-route-casing', type: 'line', source: 'custom-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
              'line-color': '#1557b0', 
              'line-width': [ 'interpolate', ['linear'], ['zoom'], 12, 7, 18, 20 ],
              'line-opacity': 0.9
          }
      }, labelLayerId); 

      // Core
      instance.addLayer({
          id: 'custom-route-core', type: 'line', source: 'custom-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
              'line-color': '#4285F4', 
              'line-width': [ 'interpolate', ['linear'], ['zoom'], 12, 4, 18, 14 ],
              'line-opacity': 1
          }
      }, labelLayerId);
  };

  // --- ROUTING (Khmer Lang) ---
  const fetchRoute = async (start: [number, number], end: [number, number]) => {
      if (!MAPBOX_TOKEN) return;
      // Added &language=km
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${start[0]},${start[1]};${end[0]},${end[1]}?steps=true&geometries=geojson&language=km&overview=full&access_token=${MAPBOX_TOKEN}`;
      try {
          const res = await fetch(url);
          const data = await res.json();
          if (data.code !== 'Ok') {
              toast({ title: "កំហុស", description: "រកផ្លូវមិនឃើញ", variant: "destructive" });
              return;
          }
          const route = data.routes[0];
          if (map.current) drawBlueRoute(map.current, { type: 'Feature', geometry: route.geometry });

          const leg = route.legs[0];
          // Default instruction fallback if empty
          const instructionText = (leg.steps[0]?.distance < 30 && leg.steps[1]) 
            ? leg.steps[1].maneuver.instruction 
            : (leg.steps[0]?.maneuver.instruction || "ធ្វើដំណើរតាមផ្លូវ");
          
          const arrivalDate = new Date(Date.now() + route.duration * 1000);
          
          setRouteDetails({
              distance: route.distance, 
              duration: route.duration,
              instruction: instructionText,
              arrivalTime: arrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
      } catch (error) { console.error("Fetch Error:", error); }
  };

  // --- MAP INITIALIZATION ---
  useEffect(() => {
    isMounted.current = true;
    if (!MAPBOX_TOKEN || !mapContainer.current) return;
    if (map.current) return; 

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current, 
      style: MAP_STYLE, 
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM, 
      pitch: 45, 
      bearing: 0, 
      attributionControl: false,
      antialias: true, 
      logoPosition: 'bottom-left', 
      cooperativeGestures: false,
      maxPitch: 85,
    });
    map.current = mapInstance;
    mapInstance.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      trackUserLocation: true, 
      showUserHeading: true, 
      showUserLocation: false, // Using custom puck
      showAccuracyCircle: false,
    });
    geolocateControl.current = geolocate;
    mapInstance.addControl(geolocate, 'top-right');

    const el = document.createElement('div');
    el.className = 'navigation-puck';
    el.style.display = 'none'; 
    puckElement.current = el;
    puckMarker.current = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat(DEFAULT_CENTER)
        .addTo(mapInstance);

    mapInstance.on('load', () => {
        if (!isMounted.current) return;
        setIsMapLoaded(true); 
        geolocate.trigger();
        setTimeout(() => {
             if (isMounted.current && map.current) {
                add3DBuildings(mapInstance);
                addTrafficLayer(mapInstance); 
             }
        }, 500); 
    });

    // --- OPTIMIZED FLUID MOTION ---
    geolocate.on('geolocate', (e: any) => {
      if (!isMounted.current) return;
      const pos = e.coords;
      const heading = pos.heading || 0;
      const speedKmh = pos.speed ? Math.round(pos.speed * 3.6) : 0;
      
      setCurrentSpeed(prev => (Math.abs(prev - speedKmh) > 3 ? speedKmh : prev));
      
      const prevLocation = userLocation.current;
      userLocation.current = [pos.longitude, pos.latitude];

      if (!weather && userLocation.current) {
          fetchWeather(pos.latitude, pos.longitude);
      }

      if (puckMarker.current) {
          puckMarker.current.setLngLat([pos.longitude, pos.latitude]);
          puckMarker.current.setRotation(heading);
      }

      // NAV CAMERA LOGIC (Fluid)
      if (isNavigating.current) {
         if (!userIsInteracting.current && !showRecenterBtnRef.current) {
             
             // Dynamic Zoom: 15 to 20
             const targetZoom = Math.max(15, 20 - (speedKmh / 50));
             
             // Dynamic Pitch: 45 to 75
             const targetPitch = Math.min(75, 45 + (speedKmh / 3));

             mapInstance.easeTo({
                 center: [pos.longitude, pos.latitude],
                 bearing: heading, // Lock rotation
                 zoom: targetZoom,
                 pitch: targetPitch,
                 padding: { top: 0, bottom: 300, left: 0, right: 0 }, 
                 duration: 2000, 
                 easing: (t) => t
             });
         }
      }
    });
    
    const handleInteractionStart = () => {
        if (isNavigating.current) {
            userIsInteracting.current = true; 
            setShowRecenterBtn(true);
        }
    };
    mapInstance.on('dragstart', handleInteractionStart);
    mapInstance.on('pitchstart', handleInteractionStart);
    mapInstance.on('zoomstart', handleInteractionStart);
    
    mapInstance.on('click', (e) => {
      if(isNavigating.current) return; 
      handleMapSelection(e.lngLat);
    });

    return () => {
      isMounted.current = false;
      if (destinationMarker.current) destinationMarker.current.remove();
      if (puckMarker.current) puckMarker.current.remove();
      searchMarkers.current.forEach(m => m.remove());
      mapInstance.remove();
      map.current = null;
      if (abortControllerRef.current) abortControllerRef.current.abort();
    }
  }, [add3DBuildings, addTrafficLayer, fetchWeather, weather]);

  const clearAiMarkers = useCallback(() => {
      searchMarkers.current.forEach(m => m.remove());
      searchMarkers.current = [];
  }, []);

  const handleMapSelection = useCallback((lngLat: { lng: number, lat: number }) => {
      if(!map.current) return;
      setRouteDetails(null);
      setShowRecenterBtn(false);
      lastSpokenInstruction.current = ""; 
      userIsInteracting.current = false;
      
      if (map.current.getLayer('custom-route-core')) map.current.removeLayer('custom-route-core');
      if (map.current.getLayer('custom-route-casing')) map.current.removeLayer('custom-route-casing');
      if (map.current.getSource('custom-route-source')) map.current.removeSource('custom-route-source');
      
      if (destinationMarker.current) destinationMarker.current.remove();
      clearAiMarkers();

      const newMarker = new Marker({ color: '#ef4444' }).setLngLat(lngLat).addTo(map.current);
      destinationMarker.current = newMarker;

      setLocationDetails(lngLat);
      setIsDrawerOpen(true);
      map.current.flyTo({ center: lngLat, zoom: 16, offset: [0, 150], essential: true });
  }, [clearAiMarkers]);

  useEffect(() => {
    const handleNavEvent = (e: any) => { if(e.detail) handleMapSelection(e.detail); }
    window.addEventListener('nav-to', handleNavEvent);
    return () => window.removeEventListener('nav-to', handleNavEvent);
  }, [handleMapSelection]);
  
  useEffect(() => {
    if (routeDetails?.instruction && isNavigating.current && lastSpokenInstruction.current !== routeDetails.instruction) {
        speak(routeDetails.instruction);
        lastSpokenInstruction.current = routeDetails.instruction;
    }
  }, [routeDetails, speak]);

  useEffect(() => {
    if (locationDetails) {
      const fetchAddress = async () => {
        setIsFetchingAddress(true);
        const apiKey = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
        if (!apiKey) {
            setAddressDetails({ formatted: `${locationDetails.lat.toFixed(4)}, ${locationDetails.lng.toFixed(4)}` });
            setIsFetchingAddress(false);
            return;
        }
        try {
          // Added &lang=km
          const response = await fetch(`https://api.geoapify.com/v1/geocode/reverse?lat=${locationDetails.lat}&lon=${locationDetails.lng}&apiKey=${apiKey}&lang=km`);
          const data = await response.json();
          if (isMounted.current && data.features && data.features.length > 0) {
            setAddressDetails(data.features[0].properties);
          } else {
            setAddressDetails({ formatted: "ទីតាំងមិនស្គាល់" });
          }
        } catch {
          setAddressDetails({ formatted: "ទីតាំងមិនស្គាល់" });
        } finally {
          if (isMounted.current) setIsFetchingAddress(false);
        }
      };
      fetchAddress();
    }
  }, [locationDetails]);

  // --- ACTIONS ---
  const handleStartNavigation = () => {
    if (!userLocation.current) {
      toast({ title: "កំពុងស្វែងរក GPS...", description: "សូមរង់ចាំបន្តិច" });
      geolocateControl.current?.trigger();
      return;
    }
    if (!locationDetails) return;
    
    fetchRoute(userLocation.current, [locationDetails.lng, locationDetails.lat]);

    isNavigating.current = true;
    userIsInteracting.current = false; 
    setShowRecenterBtn(false);
    if (!isMuted) speak("ចាប់ផ្តើមការនាំផ្លូវ");
    
    mapContainer.current?.classList.add('nav-mode');
    if (puckElement.current) puckElement.current.style.display = 'block';

    setIsDrawerOpen(false);
    setIsAiOpen(false);
    
    if(map.current) {
        map.current.flyTo({ 
            center: userLocation.current, 
            zoom: 19, 
            pitch: 70, 
            bearing: map.current.getBearing(), 
            padding: { top: 0, bottom: 200, left: 0, right: 0 },
            essential: true, 
            duration: 2000 
        });
    }
  }

  const handleRecenter = () => {
      if(!userLocation.current || !map.current) return;
      userIsInteracting.current = false;
      setShowRecenterBtn(false);
      
      map.current.flyTo({ 
          center: userLocation.current, 
          zoom: 19, 
          pitch: 70, 
          bearing: map.current.getBearing(), 
          padding: { top: 0, bottom: 200, left: 0, right: 0 },
          duration: 1200 
      });
  }

  const resetCompass = () => {
    if(map.current) map.current.easeTo({ bearing: 0, pitch: 0, duration: 800 });
  }

  const clearRoute = () => {
    isNavigating.current = false;
    userIsInteracting.current = false;
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    
    mapContainer.current?.classList.remove('nav-mode');
    if (puckElement.current) puckElement.current.style.display = 'none';

    if (destinationMarker.current) { destinationMarker.current.remove(); destinationMarker.current = null; }
    
    if (map.current?.getLayer('custom-route-core')) map.current.removeLayer('custom-route-core');
    if (map.current?.getLayer('custom-route-casing')) map.current.removeLayer('custom-route-casing');
    if (map.current?.getSource('custom-route-source')) map.current.removeSource('custom-route-source');

    clearAiMarkers();
    setRouteDetails(null);
    setLocationDetails(null);
    setIsDrawerOpen(false);
    setShowRecenterBtn(false);
    
    if(map.current && userLocation.current) {
        map.current.flyTo({ center: userLocation.current, zoom: 15, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 1500 });
    }
  }

  const performAiAction = async (input: string) => {
    if(!input.trim()) return;
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', content: input }]);
    setChatInput("");
    setIsAiTyping(true);
    if(typeof window !== 'undefined' && window.innerWidth < 768) (document.activeElement as HTMLElement)?.blur();

    const lowerMsg = input.toLowerCase();
    
    if (lowerMsg.match(/clear|reset|cancel|stop|ឈប់|លុប/)) {
        clearRoute();
        setIsAiTyping(false);
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "បានលុបផ្លូវហើយ" }]);
    } else if (lowerMsg.match(/where am i|location|ខ្ញុំនៅឯណា|ទីតាំង/)) {
        geolocateControl.current?.trigger();
        setIsAiTyping(false);
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "កំពុងកំណត់ទីតាំង..." }]);
    } else {
        const center = userLocation.current || (map.current ? map.current.getCenter().toArray() as [number, number] : DEFAULT_CENTER);
        const bounds = map.current?.getBounds() ?? undefined;
        clearAiMarkers();
        const results = await searchPlacesNearLocation(input, center, bounds, abortControllerRef.current.signal);
        if (abortControllerRef.current.signal.aborted) return;

        if (map.current && results.length > 0) {
            const fitBounds = new LngLatBounds();
            if(userLocation.current) fitBounds.extend(userLocation.current);
            results.forEach(res => {
                const el = document.createElement('div');
                let bgClass = "bg-indigo-500", iconChar = "P";
                if (res.type === "ប្រេង") { bgClass = "bg-orange-500"; iconChar = "⛽"; }
                else if (res.type === "អាហារ") { bgClass = "bg-rose-500"; iconChar = "🍔"; }
                else if (res.type === "កាហ្វេ") { bgClass = "bg-amber-500"; iconChar = "☕"; }
                else if (res.type === "សុខភាព") { bgClass = "bg-emerald-500"; iconChar = "🏥"; }

                el.className = `w-9 h-9 ${bgClass} rounded-full border-[3px] border-zinc-900 shadow-xl cursor-pointer hover:scale-110 transition-transform flex items-center justify-center text-white text-sm font-bold ${kantumruy.className}`;
                el.innerText = iconChar;
                
                const popupHTML = `
                    <div class="${kantumruy.className} text-zinc-900 min-w-[160px]">
                        <h3 class="font-bold text-base mb-1">${res.name}</h3>
                        <div class="flex items-center gap-1 text-xs text-zinc-600 mb-2">📍 ${res.address}</div>
                        <button onclick="window.dispatchEvent(new CustomEvent('nav-to', {detail: {lng:${res.lng}, lat:${res.lat}}}))" 
                            class="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2 px-3 rounded-md transition-colors ${kantumruy.className}">
                            នាំផ្លូវទៅទីនេះ
                        </button>
                    </div>`;
                    
                const marker = new Marker(el).setLngLat([res.lng, res.lat])
                    .setPopup(new mapboxgl.Popup({ offset: 25, closeButton: false, maxWidth: '220px' }).setHTML(popupHTML)).addTo(map.current!);
                el.addEventListener('click', () => marker.togglePopup());
                searchMarkers.current.push(marker);
                fitBounds.extend([res.lng, res.lat]);
            });
            map.current.fitBounds(fitBounds, { padding: 80, maxZoom: 15 });
            setIsDrawerOpen(false); setIsAiOpen(false);
            toast({ title: "ជោគជ័យ!", description: `រកឃើញ ${results.length} កន្លែង` });
        } else {
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "រកមិនឃើញលទ្ធផលទេ" }]);
        }
        setIsAiTyping(false);
    }
  }
  const handleFormSubmit = (e: React.FormEvent) => { e.preventDefault(); performAiAction(chatInput); };
  
  // Khmer Unit Formatting
  const formatDistance = (d: number) => d > 1000 ? `${(d / 1000).toFixed(1)} គ.ម` : `${d.toFixed(0)} ម៉ែត្រ`;
  const formatDuration = (s: number) => { 
      const m = Math.round(s / 60); 
      return m < 60 ? `${m} នាទី` : `${Math.floor(m / 60)}ម៉ោង ${m % 60}នាទី`; 
  }

  if (!MAPBOX_TOKEN) return <div className={`flex h-screen w-full items-center justify-center bg-zinc-950 text-white p-6 ${kantumruy.className}`}><Card className="w-full max-w-md bg-zinc-900 border-red-900/50"><CardContent className="flex flex-col items-center gap-4 p-6"><AlertTriangle className="h-8 w-8 text-red-500" /><h2 className="text-xl font-bold">Missing Token</h2><p className="text-center text-zinc-400">Mapbox Access Token is missing.</p></CardContent></Card></div>;

  return (
    <div className={`relative h-[100dvh] w-full overflow-hidden bg-zinc-950 text-zinc-50 ${kantumruy.className}`}>
        <style jsx global>{`
          .navigation-puck {
            width: 24px;
            height: 24px;
            background-color: #3b82f6;
            border: 3px solid white;
            border-radius: 50%;
            box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
            position: relative;
          }
          .navigation-puck::after {
            content: '';
            position: absolute;
            top: -12px;
            left: 50%;
            transform: translateX(-50%);
            width: 0; 
            height: 0; 
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-bottom: 10px solid #3b82f6;
          }
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        `}</style>
        
        {/* Loading Overlay */}
        <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 text-white transition-opacity duration-700 pointer-events-none ${isMapLoaded ? 'opacity-0' : 'opacity-100'}`}>
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mb-4" />
            <p className="text-zinc-500 text-xs tracking-widest uppercase">កំពុងដំណើរការ...</p>
        </div>

        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

        {/* --- WEATHER WIDGET --- */}
        {!isNavigating.current && weather && (
            <div className="absolute top-4 left-4 z-20 pointer-events-none">
                <div className="bg-[#18181b]/90 backdrop-blur-md border border-zinc-800 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-xl animate-in fade-in zoom-in-95">
                    {getWeatherIcon(weather.condition)}
                    <div className="flex flex-col">
                        <span className="text-sm font-bold text-white leading-none">{weather.temp}°</span>
                        <span className="text-[10px] text-zinc-400 capitalize">{weather.description}</span>
                    </div>
                </div>
            </div>
        )}

        {/* --- NAVIGATION HUD --- */}
        {routeDetails && (
          <>
            <div className="absolute top-0 left-0 right-0 z-30 pt-2 px-2 pointer-events-none pb-[safe-area-inset-top]">
                <Card className="w-full max-w-md mx-auto shadow-2xl bg-[#18181b]/95 backdrop-blur-xl border-zinc-800 text-white pointer-events-auto rounded-xl ring-1 ring-white/10 overflow-hidden">
                    <CardContent className="p-0">
                        <div className="flex items-center p-3 gap-3">
                            <div className="bg-green-600 h-12 w-12 rounded-lg flex items-center justify-center shadow-lg shrink-0">
                                <ManeuverIcon instruction={routeDetails.instruction} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-xl font-bold leading-tight break-words">{routeDetails.instruction}</div>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} className="h-10 w-10 rounded-full bg-zinc-800/50 hover:bg-zinc-700">
                                {isMuted ? <VolumeX className="h-5 w-5 text-zinc-400" /> : <Volume2 className="h-5 w-5 text-green-400" />}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="absolute bottom-0 left-0 right-0 z-30 pb-[safe-area-inset-bottom]">
                <div className="bg-[#18181b]/95 backdrop-blur-md border-t border-zinc-800 p-4 flex items-center justify-between">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-3">
                            <span className="text-3xl font-bold text-green-400 leading-none">{formatDuration(routeDetails.duration)}</span>
                            {/* Weather in Nav Mode */}
                            {weather && (
                                <div className="flex items-center gap-1 bg-zinc-800 px-2 py-0.5 rounded-full border border-zinc-700">
                                    {getWeatherIcon(weather.condition)}
                                    <span className="text-xs text-zinc-300">{weather.temp}°</span>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2 text-zinc-400 text-sm font-medium">
                            <span>{formatDistance(routeDetails.distance)}</span>
                            <span>•</span>
                            <span>{routeDetails.arrivalTime}</span>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                         <div className="flex flex-col items-center justify-center bg-zinc-800/50 h-12 w-12 rounded-xl border border-zinc-700/50">
                             <span className="text-lg font-bold text-white leading-none">{currentSpeed}</span>
                             <span className="text-[9px] text-zinc-500 font-bold uppercase">km/h</span>
                        </div>
                        <Button size="lg" onClick={clearRoute} className="h-12 px-6 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold shadow-lg shadow-red-900/20">
                            ចាកចេញ
                        </Button>
                    </div>
                </div>
            </div>
          </>
        )}

        {/* --- MAIN CONTROLS --- */}
        {!isNavigating.current && (
            <div className="absolute bottom-6 left-0 right-0 px-4 z-20 flex flex-col gap-3 pointer-events-none pb-[safe-area-inset-bottom]">
                <div className="flex justify-end gap-2 pointer-events-auto pb-2">
                    <Button size="icon" onClick={toggleTraffic} className={`h-12 w-12 rounded-full border shadow-xl transition-all ${isTrafficVisible ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-900/90 border-zinc-700 text-zinc-400'}`}>
                        <Layers className="h-6 w-6" />
                    </Button>
                    <Button size="icon" className="h-12 w-12 rounded-full bg-zinc-900/90 border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800" onClick={resetCompass}>
                        <Compass className="h-6 w-6" />
                    </Button>
                </div>

                <div className="flex gap-2 overflow-x-auto no-scrollbar pointer-events-auto pb-1 pl-1">
                    <Button onClick={() => performAiAction("Gas")} variant="secondary" className="rounded-full shadow-lg bg-zinc-900/95 border-zinc-800 px-5 h-10 text-sm font-medium shrink-0">
                        <Fuel className="h-4 w-4 mr-2 text-orange-500" /> ប្រេង
                    </Button>
                    <Button onClick={() => performAiAction("Food")} variant="secondary" className="rounded-full shadow-lg bg-zinc-900/95 border-zinc-800 px-5 h-10 text-sm font-medium shrink-0">
                        <Utensils className="h-4 w-4 mr-2 text-rose-500" /> អាហារ
                    </Button>
                    <Button onClick={() => performAiAction("Coffee")} variant="secondary" className="rounded-full shadow-lg bg-zinc-900/95 border-zinc-800 px-5 h-10 text-sm font-medium shrink-0">
                        <Coffee className="h-4 w-4 mr-2 text-amber-500" /> កាហ្វេ
                    </Button>
                </div>

                <div className="pointer-events-auto">
                    <button onClick={() => setIsAiOpen(true)} className="w-full bg-[#18181b] border border-zinc-800 rounded-full h-14 px-5 shadow-2xl flex items-center gap-3 text-zinc-400 active:scale-[0.98] transition-transform">
                        <Search className="h-6 w-6 text-indigo-500" /><span className="text-base font-medium flex-1 text-left">តើអ្នកចង់ទៅណា?</span><div className="bg-zinc-800 p-2 rounded-full"><Sparkles className="h-5 w-5 text-zinc-300" /></div>
                    </button>
                </div>
            </div>
        )}

        {/* --- RE-CENTER BUTTON --- */}
        {isNavigating.current && showRecenterBtn && (
             <div className="absolute bottom-32 right-4 z-20 pointer-events-auto pb-[safe-area-inset-bottom]">
                <Button onClick={handleRecenter} className="h-14 w-14 rounded-full bg-zinc-900 border border-zinc-700 shadow-2xl text-blue-500 flex flex-col items-center justify-center gap-0 hover:bg-zinc-800">
                    <LocateFixed className="h-6 w-6" /><span className="text-[9px] font-bold uppercase">ទីតាំងខ្ញុំ</span>
                </Button>
             </div>
        )}

        {/* --- AI CHAT MODAL --- */}
        {isAiOpen && (
            <div className="absolute inset-0 z-40 flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="absolute inset-0" onClick={() => setIsAiOpen(false)} />
                <div className="w-full bg-[#18181b] border-t border-zinc-800 rounded-t-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 h-[80dvh] z-50">
                    <div className="flex items-center justify-between p-4 border-b border-zinc-800/50">
                        <div className="flex items-center gap-2"><div className="p-1.5 bg-indigo-500/10 rounded-md"><Bot className="h-5 w-5 text-indigo-400" /></div><span className="font-semibold text-zinc-200">ជំនួយការ AI</span></div>
                        <Button variant="ghost" size="icon" onClick={() => setIsAiOpen(false)} className="h-9 w-9 rounded-full"><X className="h-5 w-5" /></Button>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-[#18181b] scrollbar-thin">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-[#4f46e5] text-white rounded-tr-none' : 'bg-[#27272a] text-zinc-300 border border-zinc-800/50 rounded-tl-none'}`}>{msg.content}</div>
                            </div>
                        ))}
                        {isAiTyping && (<div className="flex justify-start"><div className="bg-[#27272a] rounded-2xl px-4 py-3 border border-zinc-800/50 flex gap-1 items-center rounded-tl-none"><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"></span></div></div>)}
                        <div ref={chatEndRef} />
                    </div>
                    <div className="p-4 bg-[#18181b] border-t border-zinc-800/50 pb-[safe-area-inset-bottom]">
                        <form onSubmit={handleFormSubmit} className="relative group flex items-center gap-2 mb-2">
                            <Input ref={chatInputRef} value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="វាយបញ្ចូលគោលដៅ..." disabled={isAiTyping} className="bg-[#09090b] border-zinc-800 h-12 text-base text-white" />
                            <Button type="submit" disabled={!chatInput.trim() || isAiTyping} size="icon" className="bg-[#4f46e5] hover:bg-[#4338ca] shrink-0 h-12 w-12"><Send className="h-5 w-5" /></Button>
                        </form>
                    </div>
                </div>
            </div>
        )}

        {/* --- LOCATION DETAILS DRAWER --- */}
        <Sheet open={isDrawerOpen} onOpenChange={(open) => !open && !isNavigating.current && setIsDrawerOpen(false)}>
          <SheetContent side="bottom" className={`rounded-t-2xl p-6 border-zinc-800 bg-zinc-950 text-white ring-1 ring-white/10 z-50 pb-[safe-area-inset-bottom] ${kantumruy.className}`}>
            {locationDetails && (
              <div className="space-y-6 pb-2">
                <SheetHeader className="text-left space-y-1">
                   <SheetTitle className="text-2xl font-bold line-clamp-2 leading-tight text-white flex items-start justify-between">
                        {isFetchingAddress ? <Skeleton className="h-8 w-2/3 bg-zinc-800" /> : (addressDetails?.formatted || "ទីតាំងដែលបានជ្រើសរើស")}
                   </SheetTitle>
                   <SheetDescription asChild>
                      <div className="flex items-center gap-2 text-zinc-400 text-sm">
                        {isFetchingAddress ? <Skeleton className="h-5 w-1/3 bg-zinc-800" /> : <><MapPin className="h-4 w-4 text-zinc-500" />{locationDetails.lat.toFixed(5)}, {locationDetails.lng.toFixed(5)}</>}
                      </div>
                   </SheetDescription>
                </SheetHeader>
                <SheetFooter>
                  <Button 
                    className="w-full gap-2 bg-[#4f46e5] hover:bg-[#4338ca] text-white h-14 text-lg font-bold shadow-indigo-900/20 shadow-lg rounded-xl" 
                    onClick={handleStartNavigation}
                    disabled={isFetchingAddress || !userLocation.current}
                  >
                    {userLocation.current ? <><Navigation className="h-6 w-6" /> ចាប់ផ្តើមនាំផ្លូវ</> : <><Loader2 className="h-6 w-6 animate-spin" /> កំពុងស្វែងរក GPS</>}
                  </Button>
                </SheetFooter>
              </div>
            )}
          </SheetContent>
        </Sheet>
    </div>
  );
}