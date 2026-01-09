'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import mapboxgl, { GeolocateControl, Marker, LngLatBounds, Map as MapboxMap } from 'mapbox-gl';
import { Kantumruy_Pro } from 'next/font/google'; 
// @ts-ignore
import MapboxDirections from '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions';

import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-directions/dist/mapbox-gl-directions.css';

import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { 
  X, MapPin, Navigation, LocateFixed, Clock, 
  ArrowRight, Volume2, VolumeX, Compass, Loader2, AlertTriangle, 
  Bot, Send, Sparkles, Fuel, Utensils, Coffee, Stethoscope, Search,
} from 'lucide-react';

// --- FONT CONFIGURATION ---
const kantumruy = Kantumruy_Pro({
  subsets: ['khmer', 'latin'], 
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

// --- CONFIGURATION ---
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
if (MAPBOX_TOKEN) mapboxgl.accessToken = MAPBOX_TOKEN;

const DEFAULT_CENTER: [number, number] = [104.9282, 11.5564]; 
const DEFAULT_ZOOM = 15;
const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11'; // Note: Blue looks best on Light, but works on Dark too

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
        address: (f.properties?.address || f.place_name?.split(',').slice(1).join(',').trim()) || "ទីតាំង Mapbox",
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
    
    if (query.match(/gas|fuel|petrol|សាំង|ប្រេង/i)) { searchQuery = "petrol station, gas station"; typeLabel = "ប្រេង"; }
    else if (query.match(/food|eat|hungry|dinner|lunch|អាហារ|ញ៉ាំ|បាយ/i)) { searchQuery = "restaurant, food"; typeLabel = "អាហារ"; }
    else if (query.match(/coffee|cafe|drink|កាហ្វេ|ភេសជ្ជៈ/i)) { searchQuery = "coffee, cafe"; typeLabel = "កាហ្វេ"; }
    else if (query.match(/health|doctor|hospital|clinic|ពេទ្យ|សុខភាព|គ្លីនិក/i)) { searchQuery = "hospital, pharmacy, clinic"; typeLabel = "សុខភាព"; }

    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?proximity=${center[0]},${center[1]}&limit=10&language=km&access_token=${MAPBOX_TOKEN}`;
    if (bbox) url += `&bbox=${bbox.getWest()},${bbox.getSouth()},${bbox.getEast()},${bbox.getNorth()}`;

    try {
        const res = await fetch(url, { signal });
        const data = await res.json();
        if ((!data.features || data.features.length === 0) && bbox) {
            const fallbackUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?proximity=${center[0]},${center[1]}&limit=10&language=km&access_token=${MAPBOX_TOKEN}`;
            const fallbackRes = await fetch(fallbackUrl, { signal });
            const fallbackData = await fallbackRes.json();
            if (fallbackData.features) return mapFeaturesToResults(fallbackData.features, typeLabel);
            return [];
        }
        return mapFeaturesToResults(data.features || [], typeLabel);
    } catch { return []; }
};

interface Message { id: string; role: 'user' | 'assistant'; content: string; }

export default function MapExplorerPage() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapboxMap | null>(null);
  
  const directionsControl = useRef<any>(null);
  const geolocateControl = useRef<GeolocateControl | null>(null);
  const destinationMarker = useRef<Marker | null>(null);
  const puckMarker = useRef<Marker | null>(null);
  const puckElement = useRef<HTMLDivElement | null>(null);

  const searchMarkers = useRef<Marker[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  
  const userLocation = useRef<[number, number] | null>(null);
  const isNavigating = useRef<boolean>(false);
  
  const userIsInteracting = useRef<boolean>(false); 
  const lastCameraUpdate = useRef<number>(0);
  const lastSpokenInstruction = useRef<string>("");
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
  
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
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
    const preferredVoice = voices.find(v => v.lang.includes('km')) || voices.find(v => v.name.includes('Google') || v.name.includes('Samantha'));
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 1.0; 
    window.speechSynthesis.speak(utterance);
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

  const addSkyLayer = useCallback((instance: MapboxMap) => {
      if(!instance.getLayer('sky')) {
          instance.addLayer({
              'id': 'sky', 'type': 'sky',
              'paint': {
                  'sky-type': 'atmosphere',
                  'sky-atmosphere-sun': [0.0, 0.0],
                  'sky-atmosphere-sun-intensity': 15
              }
          });
      }
  }, []);

  // --- ROUTING LOGIC (GOOGLE MAPS STYLE) ---
  const drawBlueRoute = (instance: MapboxMap, routeData: any) => {
      if (!routeData || !routeData.geometry) {
        console.error("No valid geometry found in route data");
        return;
      }

      // Cleanup old layers
      if (instance.getLayer('custom-route-core')) instance.removeLayer('custom-route-core');
      if (instance.getLayer('custom-route-casing')) instance.removeLayer('custom-route-casing');
      if (instance.getSource('custom-route-source')) instance.removeSource('custom-route-source');

      instance.addSource('custom-route-source', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: routeData.geometry }
      });

      // Find where to insert layers (below text labels, above buildings/roads)
      const layers = instance.getStyle().layers;
      const firstSymbolId = layers?.find((layer) => layer.type === 'symbol')?.id;

      // 1. Casing Layer (The darker blue outline)
      instance.addLayer({
          id: 'custom-route-casing',
          type: 'line',
          source: 'custom-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
              'line-color': '#1967d2', // Darker Blue (Outline)
              'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  12, 6,  // At zoom 12, width 6
                  18, 16  // At zoom 18, width 16
              ],
              'line-opacity': 1
          }
      }, firstSymbolId); 

      // 2. Core Layer (The main bright blue line)
      instance.addLayer({
          id: 'custom-route-core',
          type: 'line',
          source: 'custom-route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
              'line-color': '#4285F4', // Google Maps Blue
              'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  12, 4,  // At zoom 12, width 4
                  18, 12  // At zoom 18, width 12
              ],
              'line-opacity': 1
          }
      }, firstSymbolId);
  };

  const initializeDirectionsPlugin = useCallback((instance: MapboxMap) => {
    if(directionsControl.current) return; 
    
    const directions = new MapboxDirections({
        accessToken: MAPBOX_TOKEN, 
        unit: 'metric', 
        profile: 'mapbox/driving-traffic',
        interactive: false, 
        controls: { inputs: false, instructions: false, profileSwitcher: false },
        alternatives: false, 
        flyTo: false, 
        language: 'km'
    });
    
    instance.addControl(directions, 'top-left');
    directionsControl.current = directions;

    directions.on('route', (e: any) => {
      if (!isMounted.current) return;
      
      if (e.route && e.route.length > 0) {
        const route = e.route[0];
        
        // DRAW THE BLUE ROUTE
        drawBlueRoute(instance, route);

        const leg = route.legs[0];
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
      }
    });
    
    directions.on('error', (e: any) => {
        console.error("Mapbox Directions Error:", e);
        if (e.error?.code === 'Forbidden' || e.error?.statusCode === 403) {
             toast({ 
                title: "បញ្ហាបច្ចេកទេស", 
                description: "Token របស់អ្នកមិនមានសិទ្ធិប្រើប្រាស់ Directions API ទេ។ សូមពិនិត្យមើល Console។",
                variant: "destructive"
             });
        }
    });

  }, [toast]);

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
      cooperativeGestures: false, // Disabled two fingers
      maxPitch: 85,
    });
    map.current = mapInstance;
    mapInstance.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      trackUserLocation: true, showUserHeading: true, showUserLocation: true, showAccuracyCircle: false,
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
                addSkyLayer(mapInstance);
                initializeDirectionsPlugin(mapInstance);
             }
        }, 500); 
    });

    // --- GEOLOCATION & CAMERA ---
    geolocate.on('geolocate', (e: any) => {
      if (!isMounted.current) return;
      const pos = e.coords;
      const heading = pos.heading || 0;
      const speedKmh = pos.speed ? Math.round(pos.speed * 3.6) : 0;
      
      setCurrentSpeed(prev => (Math.abs(prev - speedKmh) > 3 ? speedKmh : prev));
      
      const prevLocation = userLocation.current;
      userLocation.current = [pos.longitude, pos.latitude];

      if (puckMarker.current) {
          puckMarker.current.setLngLat([pos.longitude, pos.latitude]);
          puckMarker.current.setRotation(heading);
      }

      if (isNavigating.current && directionsControl.current) {
         directionsControl.current.setOrigin([pos.longitude, pos.latitude]);
         
         const now = Date.now();
         let distanceMoved = 100;
         if (prevLocation) distanceMoved = getDistanceFromLatLonInMeters(prevLocation[1], prevLocation[0], pos.latitude, pos.longitude);

         if (!userIsInteracting.current && !showRecenterBtnRef.current) {
             const targetZoom = Math.max(17.5, Math.min(20, 20 - (speedKmh / 100)));
             if (distanceMoved > 2 || (now - lastCameraUpdate.current > 1500)) {
                 lastCameraUpdate.current = now;
                 mapInstance.easeTo({
                     center: [pos.longitude, pos.latitude],
                     zoom: targetZoom,
                     pitch: 70, 
                     bearing: heading, 
                     padding: { top: 0, bottom: 250, left: 0, right: 0 }, 
                     duration: 1000,
                     easing: (t) => t
                 });
             }
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
    mapInstance.on('rotatestart', handleInteractionStart);
    
    mapInstance.on('click', (e) => {
      if(isNavigating.current) return; 
      handleMapSelection(e.lngLat);
    });

    return () => {
      isMounted.current = false;
      mapInstance.remove();
      map.current = null;
      if (abortControllerRef.current) abortControllerRef.current.abort();
    }
  }, [add3DBuildings, addSkyLayer, initializeDirectionsPlugin]);

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
      
      if (directionsControl.current) directionsControl.current.removeRoutes();
      if (destinationMarker.current) destinationMarker.current.remove();
      
      if (map.current.getLayer('custom-route-core')) map.current.removeLayer('custom-route-core');
      if (map.current.getLayer('custom-route-casing')) map.current.removeLayer('custom-route-casing');
      if (map.current.getSource('custom-route-source')) map.current.removeSource('custom-route-source');

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
          const response = await fetch(`https://api.geoapify.com/v1/geocode/reverse?lat=${locationDetails.lat}&lon=${locationDetails.lng}&apiKey=${apiKey}&lang=km`);
          const data = await response.json();
          if (isMounted.current && data.features && data.features.length > 0) {
            setAddressDetails(data.features[0].properties);
          } else {
            setAddressDetails({ formatted: "មិនស្គាល់ទីតាំង" });
          }
        } catch {
          setAddressDetails({ formatted: "មិនអាចរកអាសយដ្ឋាន" });
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
      toast({ title: "កំពុងស្វែងរក...", description: "រង់ចាំសេវា GPS..." });
      geolocateControl.current?.trigger();
      return;
    }
    if (!locationDetails) return;
    
    isNavigating.current = true;
    userIsInteracting.current = false;
    setShowRecenterBtn(false);
    if (!isMuted) speak("ចាប់ផ្តើមការធ្វើដំណើរ។ សូមបើកបរដោយសុវត្ថិភាព។");
    
    mapContainer.current?.classList.add('nav-mode');
    if (puckElement.current) puckElement.current.style.display = 'block';

    if (directionsControl.current) {
      directionsControl.current.setOrigin(userLocation.current);
      directionsControl.current.setDestination([locationDetails.lng, locationDetails.lat]);
    }
    setIsDrawerOpen(false);
    setIsAiOpen(false);
    
    if(map.current) {
        map.current.flyTo({ 
            center: userLocation.current, 
            zoom: 19, 
            pitch: 70, 
            bearing: map.current.getBearing(), 
            padding: { top: 0, bottom: 250, left: 0, right: 0 },
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
          padding: { top: 0, bottom: 250, left: 0, right: 0 },
          duration: 1200 
      });
  }

  const resetCompass = () => {
    if(map.current) map.current.easeTo({ bearing: 0, pitch: 0, duration: 800 });
  }

  const clearRoute = () => {
    isNavigating.current = false;
    userIsInteracting.current = false;
    window.speechSynthesis.cancel();
    
    mapContainer.current?.classList.remove('nav-mode');
    if (puckElement.current) puckElement.current.style.display = 'none';

    if (directionsControl.current) directionsControl.current.removeRoutes();
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
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "ខ្ញុំបានលុបផ្លូវ និងកំណត់ផែនទីឡើងវិញហើយ។" }]);
    } else if (lowerMsg.match(/where am i|location|locate|ទីតាំង/)) {
        geolocateControl.current?.trigger();
        setIsAiTyping(false);
        setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "កំពុងធ្វើបច្ចុប្បន្នភាពទីតាំងរបស់អ្នក។" }]);
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
                            ទៅកាន់ទីនេះ
                        </button>
                    </div>`;
                    
                const marker = new Marker(el)
                    .setLngLat([res.lng, res.lat])
                    .setPopup(new mapboxgl.Popup({ offset: 25, closeButton: false, maxWidth: '220px' }).setHTML(popupHTML))
                    .addTo(map.current!);
                    
                el.addEventListener('click', () => marker.togglePopup());
                searchMarkers.current.push(marker);
                fitBounds.extend([res.lng, res.lat]);
            });
            map.current.fitBounds(fitBounds, { padding: 80, maxZoom: 15 });
            setIsDrawerOpen(false); setIsAiOpen(false);
            toast({ title: "បានរកឃើញ!", description: `បានរកឃើញ ${results.length} កន្លែង។` });
        } else {
            setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: "មិនមានទីតាំងនៅជិតនេះទេ។" }]);
        }
        setIsAiTyping(false);
    }
  }
  const handleFormSubmit = (e: React.FormEvent) => { e.preventDefault(); performAiAction(chatInput); };
  const formatDistance = (d: number) => d > 1000 ? `${(d / 1000).toFixed(1)} គ.ម` : `${d.toFixed(0)} ម`;
  const formatDuration = (s: number) => { const m = Math.round(s / 60); return m < 60 ? `${m} នាទី` : `${Math.floor(m / 60)} ម៉ោង ${m % 60} នាទី`; }

  if (!MAPBOX_TOKEN) return <div className={`flex h-screen w-full items-center justify-center bg-zinc-950 text-white p-6 ${kantumruy.className}`}><Card className="w-full max-w-md bg-zinc-900 border-red-900/50"><CardContent className="flex flex-col items-center gap-4 p-6"><AlertTriangle className="h-8 w-8 text-red-500" /><h2 className="text-xl font-bold">បាត់ Token</h2><p className="text-center text-zinc-400">Mapbox Access Token មិនមាននៅក្នុង .env.local</p></CardContent></Card></div>;

  return (
    <div className={`relative h-[100dvh] w-full overflow-hidden bg-zinc-950 text-zinc-50 ${kantumruy.className}`}>
        <style jsx global>{`
          .mapboxgl-ctrl-directions { display: none !important; }
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
        `}</style>
        
        {/* Loading Overlay */}
        <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 text-white transition-opacity duration-700 pointer-events-none ${isMapLoaded ? 'opacity-0' : 'opacity-100'}`}>
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mb-4" />
            <p className="text-zinc-500 text-xs tracking-widest uppercase">កំពុងដំណើរការ...</p>
        </div>

        {/* Map Container */}
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

        {/* --- NAVIGATION HUD (TOP) --- */}
        {routeDetails && (
          <div className="absolute top-0 left-0 right-0 z-30 flex justify-center pt-2 px-2 pointer-events-none pb-[safe-area-inset-top]">
            <Card className="w-full max-w-md shadow-2xl bg-[#18181b]/95 backdrop-blur-xl border-zinc-800 text-white pointer-events-auto rounded-xl ring-1 ring-white/10">
              <CardContent className="p-4 space-y-4">
                <div className="flex items-start gap-4">
                    <div className="bg-green-600 p-3 rounded-lg shrink-0 mt-1 shadow-lg shadow-green-900/20">
                        <ArrowRight className="h-8 w-8" />
                    </div>
                    <div className="flex-1 min-w-0">
                         <div className="text-zinc-400 text-xs font-medium uppercase tracking-wider mb-0.5">ទិសដៅបន្ទាប់</div>
                         <div className="text-xl font-bold leading-tight break-words">{routeDetails.instruction}</div>
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                        <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} className="h-9 w-9 rounded-full bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700">
                            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5 text-green-400" />}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={clearRoute} className="h-9 w-9 rounded-full bg-red-900/50 hover:bg-red-600 text-red-200 hover:text-white transition-colors">
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
                        <div className="flex shrink-0 items-center justify-center bg-zinc-800 h-8 w-14 rounded-md border border-zinc-700 mr-2">
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

        {/* --- BOTTOM CONTROLS & SEARCH --- */}
        <div className="absolute bottom-6 left-0 right-0 px-4 z-20 flex flex-col gap-3 pointer-events-none">
            
            <div className="flex justify-end gap-2 pointer-events-auto pb-2">
                 {!isNavigating.current && (
                    <Button size="icon" className="h-10 w-10 rounded-full bg-zinc-900/90 border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800" onClick={resetCompass}>
                        <Compass className="h-5 w-5" />
                    </Button>
                 )}
                 {(showRecenterBtn || !isNavigating.current) && (
                    <Button onClick={() => { isNavigating.current ? handleRecenter() : geolocateControl.current?.trigger() }} className={`h-10 w-10 rounded-full bg-zinc-900 border border-zinc-700 shadow-xl text-blue-500 hover:bg-zinc-800 p-0`}>
                        <LocateFixed className="h-5 w-5" />
                    </Button>
                 )}
            </div>

            {!isNavigating.current && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar pointer-events-auto pb-1 pl-1">
                    <Button onClick={() => performAiAction("Gas")} variant="secondary" className="rounded-full shadow-lg bg-zinc-900/90 text-zinc-100 border border-zinc-800 px-4 h-9 text-xs font-medium shrink-0">
                        <Fuel className="h-3.5 w-3.5 mr-1.5 text-orange-500" /> សាំង
                    </Button>
                    <Button onClick={() => performAiAction("Food")} variant="secondary" className="rounded-full shadow-lg bg-zinc-900/90 text-zinc-100 border border-zinc-800 px-4 h-9 text-xs font-medium shrink-0">
                        <Utensils className="h-3.5 w-3.5 mr-1.5 text-rose-500" /> អាហារ
                    </Button>
                    <Button onClick={() => performAiAction("Coffee")} variant="secondary" className="rounded-full shadow-lg bg-zinc-900/90 text-zinc-100 border border-zinc-800 px-4 h-9 text-xs font-medium shrink-0">
                        <Coffee className="h-3.5 w-3.5 mr-1.5 text-amber-500" /> កាហ្វេ
                    </Button>
                    <Button onClick={() => performAiAction("Health")} variant="secondary" className="rounded-full shadow-lg bg-zinc-900/90 text-zinc-100 border border-zinc-800 px-4 h-9 text-xs font-medium shrink-0">
                        <Stethoscope className="h-3.5 w-3.5 mr-1.5 text-emerald-500" /> សុខភាព
                    </Button>
                </div>
            )}

            {!isNavigating.current && (
                <div className="pointer-events-auto">
                    <button onClick={() => setIsAiOpen(true)} className="w-full bg-[#18181b] border border-zinc-800 rounded-full h-12 px-4 shadow-2xl flex items-center gap-3 text-zinc-400 active:scale-[0.98] transition-transform">
                        <Search className="h-5 w-5 text-indigo-500" /><span className="text-sm font-medium flex-1 text-left">ស្វែងរកទីកន្លែង...</span><div className="bg-zinc-800 p-1.5 rounded-full"><Sparkles className="h-4 w-4 text-zinc-300" /></div>
                    </button>
                </div>
            )}
        </div>

        {/* --- AI CHAT MODAL --- */}
        {isAiOpen && (
            <div className="absolute inset-0 z-40 flex flex-col justify-end sm:justify-center sm:items-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                <div className="absolute inset-0" onClick={() => setIsAiOpen(false)} />
                <div className="w-full sm:max-w-md bg-[#18181b] border-t sm:border border-zinc-800 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200 ring-1 ring-white/10 max-h-[85dvh] z-50">
                    <div className="flex items-center justify-between p-4 border-b border-zinc-800/50 bg-[#18181b]">
                        <div className="flex items-center gap-2"><div className="p-1.5 bg-indigo-500/10 rounded-md"><Bot className="h-5 w-5 text-indigo-400" /></div><span className="font-semibold text-zinc-200 text-sm">ជំនួយការ AI</span></div>
                        <Button variant="ghost" size="icon" onClick={() => setIsAiOpen(false)} className="h-8 w-8 rounded-full"><X className="h-4 w-4" /></Button>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto space-y-4 bg-[#18181b] scrollbar-thin scrollbar-thumb-zinc-800 min-h-[300px]">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-[#4f46e5] text-white rounded-tr-none' : 'bg-[#27272a] text-zinc-300 border border-zinc-800/50 rounded-tl-none'}`}>{msg.content}</div>
                            </div>
                        ))}
                        {isAiTyping && (<div className="flex justify-start"><div className="bg-[#27272a] rounded-2xl px-4 py-3 border border-zinc-800/50 flex gap-1 items-center rounded-tl-none"><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span><span className="w-1.5 h-1.5 bg-zinc-500 rounded-full animate-bounce"></span></div></div>)}
                        <div ref={chatEndRef} />
                    </div>
                    <div className="p-4 bg-[#18181b] border-t border-zinc-800/50">
                        <form onSubmit={handleFormSubmit} className="relative group flex items-center gap-2">
                            <Input ref={chatInputRef} value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="សរសេរសារ..." disabled={isAiTyping} className="bg-[#09090b] border-zinc-800 focus-visible:ring-indigo-500/50 text-white" />
                            <Button type="submit" disabled={!chatInput.trim() || isAiTyping} size="icon" className="bg-[#4f46e5] hover:bg-[#4338ca] shrink-0"><Send className="h-4 w-4" /></Button>
                        </form>
                    </div>
                </div>
            </div>
        )}

        {/* --- LOCATION DETAILS DRAWER --- */}
        <Sheet open={isDrawerOpen} onOpenChange={(open) => !open && !isNavigating.current && setIsDrawerOpen(false)}>
          <SheetContent side="bottom" className={`rounded-t-2xl p-6 border-zinc-800 sm:max-w-md sm:mx-auto bg-zinc-950 text-white ring-1 ring-white/10 z-50 ${kantumruy.className}`}>
            {locationDetails && (
              <div className="space-y-6 pb-2">
                <SheetHeader className="text-left space-y-1">
                   <SheetTitle className="text-xl font-bold line-clamp-2 leading-tight text-white flex items-start justify-between">
                        {isFetchingAddress ? <Skeleton className="h-7 w-2/3 bg-zinc-800" /> : (addressDetails?.formatted || "ទីតាំងដែលបានជ្រើសរើស")}
                   </SheetTitle>
                   <SheetDescription asChild>
                      <div className="flex items-center gap-2 text-zinc-400 text-sm">
                        {isFetchingAddress ? <Skeleton className="h-5 w-1/3 bg-zinc-800" /> : <><MapPin className="h-4 w-4 text-zinc-500" />{locationDetails.lat.toFixed(5)}, {locationDetails.lng.toFixed(5)}</>}
                      </div>
                   </SheetDescription>
                </SheetHeader>
                <SheetFooter>
                  <Button 
                    className="w-full gap-2 bg-[#4f46e5] hover:bg-[#4338ca] text-white h-12 text-lg font-medium shadow-indigo-900/20 shadow-lg rounded-xl" 
                    onClick={handleStartNavigation}
                    disabled={isFetchingAddress || !userLocation.current}
                  >
                    {userLocation.current ? <><Navigation className="h-5 w-5" /> ចាប់ផ្តើមធ្វើដំណើរ</> : <><Loader2 className="h-5 w-5 animate-spin" /> កំពុងស្វែងរក GPS</>}
                  </Button>
                </SheetFooter>
              </div>
            )}
          </SheetContent>
        </Sheet>
    </div>
  );
}