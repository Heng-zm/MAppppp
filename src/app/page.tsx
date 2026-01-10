'use client';

import React, { useRef, useEffect, useState, useCallback, memo } from 'react';
import mapboxgl, { GeolocateControl, Marker, LngLatBounds, Map as MapboxMap } from 'mapbox-gl';
import { Kantumruy_Pro } from 'next/font/google'; 
import 'mapbox-gl/dist/mapbox-gl.css';

import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { 
  X, MapPin, Navigation, LocateFixed, 
  Volume2, VolumeX, Compass, Loader2, AlertTriangle, 
  Fuel, Utensils, Coffee, Search,
  Layers, Zap, CornerUpLeft, CornerUpRight, ArrowUp,
  Sun, Cloud, CloudRain, CloudLightning, Snowflake, Wind,
  ArrowRight, Clock, History
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
const WEATHER_REFRESH_RATE = 15 * 60 * 1000; 

// --- UTILS ---
function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return (R * c) * 1000;
}

const getTenKmBbox = (lon: number, lat: number) => {
    const radiusKm = 10;
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.cos(lat * (Math.PI / 180)));
    return `${lon - lonDelta},${lat - latDelta},${lon + lonDelta},${lat + latDelta}`;
};

const formatDistance = (d: number) => d > 1000 ? `${(d / 1000).toFixed(1)} គ.ម` : `${d.toFixed(0)} ម៉ែត្រ`;

const formatDuration = (s: number) => { 
    const m = Math.round(s / 60); 
    return m < 60 ? `${m} នាទី` : `${Math.floor(m / 60)}ម៉ោង ${m % 60}នាទី`; 
};

type SearchResult = { lng: number, lat: number, name: string, type: string, address: string };

const mapFeaturesToResults = (features: any[], typeLabel: string): SearchResult[] => {
    return features.map((f: any) => ({
        lng: f.center[0],
        lat: f.center[1],
        name: f.text_km || f.text, // Prefer Khmer Name if available
        address: (f.properties?.address || f.place_name_km || f.place_name) || "ទីតាំង",
        type: typeLabel
    }));
};

const getWeatherIcon = (condition: string) => {
    const c = condition.toLowerCase();
    if (c.includes('rain') || c.includes('drizzle') || c.includes('ភ្លៀង')) return <CloudRain className="h-5 w-5 text-blue-400" />;
    if (c.includes('thunder') || c.includes('រន្ទះ')) return <CloudLightning className="h-5 w-5 text-yellow-400" />;
    if (c.includes('snow')) return <Snowflake className="h-5 w-5 text-white" />;
    if (c.includes('cloud') || c.includes('ពពក')) return <Cloud className="h-5 w-5 text-gray-400" />;
    if (c.includes('clear') || c.includes('sun') || c.includes('ស្រឡះ')) return <Sun className="h-5 w-5 text-orange-400" />;
    return <Wind className="h-5 w-5 text-zinc-400" />;
};

const ManeuverIcon = memo(({ instruction }: { instruction: string }) => {
    const text = instruction.toLowerCase();
    const iconClass = "h-10 w-10 text-white";
    if (text.includes('left') || text.includes('ឆ្វេង')) return <CornerUpLeft className={iconClass} />;
    if (text.includes('right') || text.includes('ស្តាំ')) return <CornerUpRight className={iconClass} />;
    if (text.includes('straight') || text.includes('continue') || text.includes('ត្រង់')) return <ArrowUp className={iconClass} />;
    if (text.includes('uturn') || text.includes('ត្រឡប់')) return <Zap className={iconClass} />;
    return <Navigation className={iconClass} />;
});
ManeuverIcon.displayName = 'ManeuverIcon';

// --- TYPES ---
type WeatherData = { temp: number; condition: string; description: string };
type RouteDetails = { distance: number; duration: number; instruction: string; arrivalTime: string; };

// ==========================================
// MAIN COMPONENT
// ==========================================
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
  const showRecenterBtnRef = useRef(false);
  const lastSpokenInstruction = useRef<string>("");
  const lastWeatherFetchTime = useRef<number>(0);

  // UI State
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
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [routeDetails, setRouteDetails] = useState<RouteDetails | null>(null);

  useEffect(() => { showRecenterBtnRef.current = showRecenterBtn; }, [showRecenterBtn]);

  const speak = useCallback((text: string) => {
    if (typeof window === 'undefined' || isMuted || !window.speechSynthesis) return;
    window.speechSynthesis.cancel(); 
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.lang.includes('km') || v.name.includes('Google') || v.name.includes('Samantha'));
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 1.05; 
    window.speechSynthesis.speak(utterance);
  }, [isMuted]);

  const fetchWeather = useCallback(async (lat: number, lon: number) => {
      const now = Date.now();
      if (!WEATHER_API_KEY || (now - lastWeatherFetchTime.current < WEATHER_REFRESH_RATE && weather)) return;
      lastWeatherFetchTime.current = now;
      try {
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
  }, [weather]);

  // --- IMPROVED KHMER SEARCH LOGIC ---
  const searchPlaces = async (query: string, center: [number, number], bboxOnly: boolean = false, signal?: AbortSignal) => {
    if (!MAPBOX_TOKEN) return [];
    
    let searchQuery = query;
    let typeLabel = "ទីកន្លែង";

    // 1. Khmer Keyword Mapping (Translate intent for better API results)
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.match(/gas|fuel|petrol|station|ប្រេង|សាំង|បូមសាំង/i)) { searchQuery = "gas station"; typeLabel = "ប្រេង"; }
    else if (lowerQuery.match(/food|eat|hungry|restaurant|អាហារ|បាយ|ហាងបាយ/i)) { searchQuery = "restaurant"; typeLabel = "អាហារ"; }
    else if (lowerQuery.match(/coffee|cafe|drink|កាហ្វេ|ភេសជ្ជៈ/i)) { searchQuery = "coffee"; typeLabel = "កាហ្វេ"; }
    else if (lowerQuery.match(/hospital|clinic|doctor|ពេទ្យ|មន្ទីរពេទ្យ|គ្លីនិក/i)) { searchQuery = "hospital"; typeLabel = "សុខភាព"; }
    else if (lowerQuery.match(/school|university|សាលា|សកលវិទ្យាល័យ/i)) { searchQuery = "school"; typeLabel = "អប់រំ"; }
    else if (lowerQuery.match(/bank|atm|ធនាគារ|លុយ/i)) { searchQuery = "bank"; typeLabel = "ធនាគារ"; }

    // 2. Build URL with Language & Country Priorities
    let url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${MAPBOX_TOKEN}`;
    
    // Add Parameters
    url += `&language=km`; // Prefer Khmer results
    url += `&country=kh`;   // Restrict to Cambodia
    url += `&limit=10`;
    url += `&proximity=${center[0]},${center[1]}`; // Bias towards user location

    if (bboxOnly) {
        const bboxString = getTenKmBbox(center[0], center[1]);
        url += `&bbox=${bboxString}`;
    }

    try {
        const res = await fetch(url, { signal });
        const data = await res.json();
        return mapFeaturesToResults(data.features || [], typeLabel);
    } catch { return []; }
  };

  const fetchRoute = async (start: [number, number], end: [number, number]) => {
      if (!MAPBOX_TOKEN) return;
      // Add &language=km to route request
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
          const instructionText = (leg.steps[0]?.distance < 30 && leg.steps[1]) 
            ? leg.steps[1].maneuver.instruction 
            : (leg.steps[0]?.maneuver.instruction || "ធ្វើដំណើរតាមផ្លូវ");
          
          setRouteDetails({
              distance: route.distance, 
              duration: route.duration,
              instruction: instructionText,
              arrivalTime: new Date(Date.now() + route.duration * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
      } catch (error) { console.error("Fetch Error:", error); }
  };

  const add3DBuildings = (instance: MapboxMap) => {
    if (instance.getLayer('3d-buildings')) return;
    const layers = instance.getStyle().layers;
    const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;
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
  };

  const addTrafficLayer = (instance: MapboxMap) => {
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
  };

  const drawBlueRoute = (instance: MapboxMap, geojson: any) => {
      if (!geojson || !geojson.geometry) return;
      const layers = instance.getStyle().layers;
      const labelLayerId = layers?.find((layer) => layer.type === 'symbol' && layer.layout?.['text-field'])?.id;

      if (instance.getSource('custom-route-source')) {
          (instance.getSource('custom-route-source') as mapboxgl.GeoJSONSource).setData(geojson);
      } else {
          instance.addSource('custom-route-source', { type: 'geojson', data: geojson });
          instance.addLayer({
              id: 'custom-route-casing', type: 'line', source: 'custom-route-source',
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#1557b0', 'line-width': [ 'interpolate', ['linear'], ['zoom'], 12, 7, 18, 20 ], 'line-opacity': 0.9 }
          }, labelLayerId); 
          instance.addLayer({
              id: 'custom-route-core', type: 'line', source: 'custom-route-source',
              layout: { 'line-join': 'round', 'line-cap': 'round' },
              paint: { 'line-color': '#4285F4', 'line-width': [ 'interpolate', ['linear'], ['zoom'], 12, 4, 18, 14 ], 'line-opacity': 1 }
          }, labelLayerId);
      }
  };

  useEffect(() => {
    isMounted.current = true;
    if (!MAPBOX_TOKEN || !mapContainer.current || map.current) return;

    const mapInstance = new mapboxgl.Map({
      container: mapContainer.current, style: MAP_STYLE, center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, 
      pitch: 45, bearing: 0, attributionControl: false, antialias: true, logoPosition: 'bottom-left', 
      cooperativeGestures: false, maxPitch: 85,
    });
    map.current = mapInstance;
    mapInstance.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    const geolocate = new GeolocateControl({
      positionOptions: { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      trackUserLocation: true, showUserHeading: true, showUserLocation: false, showAccuracyCircle: false,
    });
    geolocateControl.current = geolocate;
    mapInstance.addControl(geolocate, 'top-right');

    const el = document.createElement('div');
    el.className = 'navigation-puck';
    el.style.display = 'none'; 
    puckElement.current = el;
    puckMarker.current = new Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat(DEFAULT_CENTER).addTo(mapInstance);

    mapInstance.on('load', () => {
        if (!isMounted.current) return;
        setIsMapLoaded(true); 
        geolocate.trigger();
        add3DBuildings(mapInstance);
        addTrafficLayer(mapInstance); 
    });

    geolocate.on('geolocate', (e: any) => {
      if (!isMounted.current) return;
      const pos = e.coords;
      const heading = pos.heading || 0;
      const speedKmh = pos.speed ? Math.round(pos.speed * 3.6) : 0;
      
      setCurrentSpeed(prev => (Math.abs(prev - speedKmh) > 2 ? speedKmh : prev));
      userLocation.current = [pos.longitude, pos.latitude];
      
      if (puckElement.current) puckElement.current.style.display = 'block';

      fetchWeather(pos.latitude, pos.longitude);

      if (puckMarker.current) {
          puckMarker.current.setLngLat([pos.longitude, pos.latitude]);
          puckMarker.current.setRotation(heading);
      }

      if (isNavigating.current && !userIsInteracting.current && !showRecenterBtnRef.current) {
             const targetZoom = Math.max(15, 20 - (speedKmh / 50));
             const targetPitch = Math.min(75, 45 + (speedKmh / 3));
             mapInstance.easeTo({
                 center: [pos.longitude, pos.latitude], bearing: heading,
                 zoom: targetZoom, pitch: targetPitch,
                 padding: { top: 0, bottom: 300, left: 0, right: 0 }, 
                 duration: 2000, easing: (t) => t
             });
      }
    });
    
    const handleInteractionStart = () => { if (isNavigating.current) { userIsInteracting.current = true; setShowRecenterBtn(true); } };
    mapInstance.on('dragstart', handleInteractionStart);
    mapInstance.on('pitchstart', handleInteractionStart);
    mapInstance.on('zoomstart', handleInteractionStart);
    mapInstance.on('click', (e) => { if(!isNavigating.current) handleMapSelection(e.lngLat); });

    return () => {
      isMounted.current = false;
      if (destinationMarker.current) destinationMarker.current.remove();
      if (puckMarker.current) puckMarker.current.remove();
      searchMarkers.current.forEach(m => m.remove());
      mapInstance.remove();
      map.current = null;
      if (abortControllerRef.current) abortControllerRef.current.abort();
    }
  }, [fetchWeather]);

  const clearSearchMarkers = useCallback(() => {
      searchMarkers.current.forEach(m => m.remove());
      searchMarkers.current = [];
  }, []);

  const handleMapSelection = useCallback((lngLat: { lng: number, lat: number }) => {
      if(!map.current) return;
      setRouteDetails(null);
      setShowRecenterBtn(false);
      lastSpokenInstruction.current = ""; 
      userIsInteracting.current = false;
      
      const layers = ['custom-route-core', 'custom-route-casing'];
      layers.forEach(l => { if(map.current?.getLayer(l)) map.current?.removeLayer(l); });
      if (map.current.getSource('custom-route-source')) map.current.removeSource('custom-route-source');
      
      if (destinationMarker.current) destinationMarker.current.remove();
      clearSearchMarkers();

      destinationMarker.current = new Marker({ color: '#ef4444' }).setLngLat(lngLat).addTo(map.current);
      setLocationDetails(lngLat);
      setIsDrawerOpen(true);
      map.current.flyTo({ center: lngLat, zoom: 16, offset: [0, 150], essential: true });
  }, [clearSearchMarkers]);

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
          // Add &lang=km to Reverse Geocoding
          const response = await fetch(`https://api.geoapify.com/v1/geocode/reverse?lat=${locationDetails.lat}&lon=${locationDetails.lng}&apiKey=${apiKey}&lang=km`);
          const data = await response.json();
          if (isMounted.current) {
             setAddressDetails((data.features && data.features.length > 0) ? data.features[0].properties : { formatted: "ទីតាំងមិនស្គាល់" });
          }
        } catch {
          if (isMounted.current) setAddressDetails({ formatted: "ទីតាំងមិនស្គាល់" });
        } finally {
          if (isMounted.current) setIsFetchingAddress(false);
        }
      };
      fetchAddress();
    }
  }, [locationDetails]);

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
    
    setIsDrawerOpen(false);
    
    if(map.current) {
        map.current.flyTo({ 
            center: userLocation.current, zoom: 19, pitch: 70, 
            bearing: map.current.getBearing(), padding: { top: 0, bottom: 200, left: 0, right: 0 },
            essential: true, duration: 2000 
        });
    }
  }

  const handleRecenter = () => {
      if(!userLocation.current || !map.current) return;
      userIsInteracting.current = false;
      setShowRecenterBtn(false);
      map.current.flyTo({ 
          center: userLocation.current, zoom: 19, pitch: 70, 
          bearing: map.current.getBearing(), padding: { top: 0, bottom: 200, left: 0, right: 0 },
          duration: 1200 
      });
  }

  const clearRoute = useCallback(() => {
    isNavigating.current = false;
    userIsInteracting.current = false;
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    
    mapContainer.current?.classList.remove('nav-mode');
    if (destinationMarker.current) { destinationMarker.current.remove(); destinationMarker.current = null; }
    
    const layers = ['custom-route-core', 'custom-route-casing'];
    layers.forEach(l => { if(map.current?.getLayer(l)) map.current?.removeLayer(l); });
    if (map.current?.getSource('custom-route-source')) map.current.removeSource('custom-route-source');

    clearSearchMarkers();
    setRouteDetails(null);
    setLocationDetails(null);
    setIsDrawerOpen(false);
    setShowRecenterBtn(false);
    
    if(map.current && userLocation.current) {
        map.current.flyTo({ center: userLocation.current, zoom: 15, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 1500 });
    }
  }, [clearSearchMarkers]);

  // --- TRIGGER CATEGORY SEARCH (Buttons) ---
  const handleCategorySearch = async (query: string) => {
    const center = userLocation.current || (map.current ? map.current.getCenter().toArray() as [number, number] : DEFAULT_CENTER);
    clearSearchMarkers();
    
    // Use BBox for categories to keep it strict
    const results = await searchPlaces(query, center, true);

    if (map.current && results.length > 0) {
        const fitBounds = new LngLatBounds();
        if(userLocation.current) fitBounds.extend(userLocation.current);
        
        results.forEach(res => {
            const el = document.createElement('div');
            let bgClass = "bg-indigo-500", iconChar = "P";
            if (res.type === "ប្រេង") { bgClass = "bg-orange-500"; iconChar = "⛽"; }
            else if (res.type === "អាហារ") { bgClass = "bg-rose-500"; iconChar = "🍔"; }
            else if (res.type === "កាហ្វេ") { bgClass = "bg-amber-500"; iconChar = "☕"; }

            el.className = `w-9 h-9 ${bgClass} rounded-full border-[3px] border-zinc-900 shadow-xl cursor-pointer hover:scale-110 transition-transform flex items-center justify-center text-white text-sm font-bold ${kantumruy.className}`;
            el.innerText = iconChar;
            
            const marker = new Marker(el).setLngLat([res.lng, res.lat]).addTo(map.current!);
            
            // Marker Click
            el.addEventListener('click', () => {
                 handleMapSelection({ lng: res.lng, lat: res.lat });
            });

            searchMarkers.current.push(marker);
            fitBounds.extend([res.lng, res.lat]);
        });
        
        map.current.fitBounds(fitBounds, { padding: 80, maxZoom: 15 });
        toast({ title: "ជោគជ័យ!", description: `រកឃើញ ${results.length} កន្លែង` });
    } else {
        toast({ title: "បរាជ័យ", description: "រកមិនឃើញលទ្ធផលទេ" });
    }
  }

  // --- AUTOCOMPLETE HANDLER ---
  const handleAutocomplete = async (query: string) => {
    if (!query.trim()) return [];
    const center = userLocation.current || (map.current ? map.current.getCenter().toArray() as [number, number] : DEFAULT_CENTER);
    return await searchPlaces(query, center, false); 
  }

  const toggleTraffic = useCallback(() => {
    if (!map.current || !map.current.getLayer('traffic')) return;
    const visibility = map.current.getLayoutProperty('traffic', 'visibility');
    map.current.setLayoutProperty('traffic', 'visibility', visibility === 'visible' ? 'none' : 'visible');
    setIsTrafficVisible(visibility !== 'visible');
  }, []);

  const resetCompass = useCallback(() => {
    if(map.current) map.current.easeTo({ bearing: 0, pitch: 0, duration: 800 });
  }, []);

  if (!MAPBOX_TOKEN) return <div className={`flex h-screen w-full items-center justify-center bg-zinc-950 text-white p-6 ${kantumruy.className}`}><Card className="w-full max-w-md bg-zinc-900 border-red-900/50"><CardContent className="flex flex-col items-center gap-4 p-6"><AlertTriangle className="h-8 w-8 text-red-500" /><h2 className="text-xl font-bold">Missing Token</h2><p className="text-center text-zinc-400">Mapbox Access Token is missing.</p></CardContent></Card></div>;

  return (
    <div className={`relative h-[100dvh] w-full overflow-hidden bg-zinc-950 text-zinc-50 ${kantumruy.className}`}>
        <style jsx global>{`
          .navigation-puck { width: 24px; height: 24px; background-color: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 10px rgba(59, 130, 246, 0.5); position: relative; }
          .navigation-puck::after { content: ''; position: absolute; top: -12px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 10px solid #3b82f6; }
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
          .mapboxgl-popup { z-index: 10 !important; }
        `}</style>
        
        <div className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950 text-white transition-opacity duration-700 pointer-events-none ${isMapLoaded ? 'opacity-0' : 'opacity-100'}`}>
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500 mb-4" />
            <p className="text-zinc-500 text-xs tracking-widest uppercase">កំពុងដំណើរការ...</p>
        </div>

        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

        <WeatherWidget weather={weather} isNavigating={isNavigating.current} />

        {routeDetails ? (
           <NavigationHUD 
              routeDetails={routeDetails} 
              isMuted={isMuted} 
              setIsMuted={setIsMuted} 
              weather={weather}
              currentSpeed={currentSpeed}
              onClearRoute={clearRoute}
           />
        ) : (
           <BottomControls 
              isTrafficVisible={isTrafficVisible}
              toggleTraffic={toggleTraffic}
              resetCompass={resetCompass}
              handleCategorySearch={handleCategorySearch}
              handleAutocomplete={handleAutocomplete}
              onSelectLocation={(loc: SearchResult) => handleMapSelection(loc)}
              userLocation={userLocation}
           />
        )}

        {isNavigating.current && showRecenterBtn && (
             <div className="absolute bottom-32 right-4 z-20 pointer-events-auto pb-[safe-area-inset-bottom]">
                <Button onClick={handleRecenter} className="h-14 w-14 rounded-full bg-zinc-900 border border-zinc-700 shadow-2xl text-blue-500 flex flex-col items-center justify-center gap-0 hover:bg-zinc-800">
                    <LocateFixed className="h-6 w-6" /><span className="text-[9px] font-bold uppercase">ទីតាំងខ្ញុំ</span>
                </Button>
             </div>
        )}

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

// ==========================================
// SUB-COMPONENTS
// ==========================================

const WeatherWidget = memo(({ weather, isNavigating }: { weather: WeatherData | null, isNavigating: boolean }) => {
    if (isNavigating || !weather) return null;
    return (
        <div className="absolute top-4 left-4 z-20 pointer-events-none">
            <div className="bg-[#18181b]/90 backdrop-blur-md border border-zinc-800 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-xl animate-in fade-in zoom-in-95">
                {getWeatherIcon(weather.condition)}
                <div className="flex flex-col">
                    <span className="text-sm font-bold text-white leading-none">{weather.temp}°</span>
                    <span className="text-[10px] text-zinc-400 capitalize">{weather.description}</span>
                </div>
            </div>
        </div>
    );
});
WeatherWidget.displayName = "WeatherWidget";

const NavigationHUD = memo(({ routeDetails, isMuted, setIsMuted, weather, currentSpeed, onClearRoute }: any) => {
    return (
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
                    <Button size="lg" onClick={onClearRoute} className="h-12 px-6 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold shadow-lg shadow-red-900/20">
                        ចាកចេញ
                    </Button>
                </div>
            </div>
        </div>
        </>
    );
});
NavigationHUD.displayName = "NavigationHUD";

const BottomControls = memo(({ 
    isTrafficVisible, toggleTraffic, resetCompass, 
    handleCategorySearch, handleAutocomplete, onSelectLocation, userLocation
}: any) => {
    const [query, setQuery] = useState("");
    const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [history, setHistory] = useState<SearchResult[]>([]);

    useEffect(() => {
        const saved = localStorage.getItem('map_history');
        if (saved) setHistory(JSON.parse(saved));
    }, []);

    useEffect(() => {
        const timeoutId = setTimeout(async () => {
            if (query.trim().length > 1) {
                setIsSearching(true);
                const results = await handleAutocomplete(query);
                setSuggestions(results);
                setIsSearching(false);
            } else {
                setSuggestions([]);
            }
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [query, handleAutocomplete]);

    const handleSelect = (s: SearchResult) => {
        setQuery("");
        setSuggestions([]);
        const newHistory = [s, ...history.filter(h => h.name !== s.name)].slice(0, 5);
        setHistory(newHistory);
        localStorage.setItem('map_history', JSON.stringify(newHistory));
        onSelectLocation(s);
    }

    const calcDist = (lat: number, lng: number) => {
        if(!userLocation.current) return null;
        return formatDistance(getDistanceFromLatLonInMeters(userLocation.current[1], userLocation.current[0], lat, lng));
    }

    // Helper for local dist calc (Duplicated from top to keep Component pure)
    function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
      const R = 6371; 
      const dLat = (lat2 - lat1) * (Math.PI / 180);
      const dLon = (lon2 - lon1) * (Math.PI / 180);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return (R * c) * 1000;
    }

    return (
        <div className="absolute bottom-6 left-0 right-0 px-4 z-20 flex flex-col gap-3 pointer-events-none pb-[safe-area-inset-bottom]">
            <div className="flex justify-end gap-2 pointer-events-auto pb-2">
                <Button size="icon" onClick={toggleTraffic} className={`h-12 w-12 rounded-full border shadow-xl transition-all ${isTrafficVisible ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-zinc-900/90 border-zinc-700 text-zinc-400'}`}>
                    <Layers className="h-6 w-6" />
                </Button>
                <Button size="icon" className="h-12 w-12 rounded-full bg-zinc-900/90 border border-zinc-700 text-zinc-300 shadow-xl hover:bg-zinc-800" onClick={resetCompass}>
                    <Compass className="h-6 w-6" />
                </Button>
            </div>

            {query.length === 0 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar pointer-events-auto pb-1 pl-1 animate-in slide-in-from-bottom-2 duration-300">
                <Button onClick={() => handleCategorySearch("gas station")} variant="secondary" className="rounded-full shadow-lg bg-zinc-900/95 border-zinc-800 px-5 h-10 text-sm font-medium shrink-0">
                    <Fuel className="h-4 w-4 mr-2 text-orange-500" /> ប្រេង
                </Button>
                <Button onClick={() => handleCategorySearch("restaurant")} variant="secondary" className="rounded-full shadow-lg bg-zinc-900/95 border-zinc-800 px-5 h-10 text-sm font-medium shrink-0">
                    <Utensils className="h-4 w-4 mr-2 text-rose-500" /> អាហារ
                </Button>
                <Button onClick={() => handleCategorySearch("coffee")} variant="secondary" className="rounded-full shadow-lg bg-zinc-900/95 border-zinc-800 px-5 h-10 text-sm font-medium shrink-0">
                    <Coffee className="h-4 w-4 mr-2 text-amber-500" /> កាហ្វេ
                </Button>
            </div>
            )}

            <div className="pointer-events-auto flex flex-col gap-2 relative group">
                {(suggestions.length > 0 || (query.length === 0 && history.length > 0)) && (
                    <Card className="absolute bottom-16 left-0 right-0 bg-[#18181b]/95 backdrop-blur-md border-zinc-800 max-h-[50vh] overflow-y-auto shadow-2xl z-30 animate-in fade-in slide-in-from-bottom-4 duration-200">
                        <CardContent className="p-0">
                            {query.length === 0 && history.length > 0 && (
                                <div className="border-b border-zinc-800/50">
                                    <div className="px-3 py-2 text-[10px] uppercase font-bold text-zinc-500 tracking-wider">Recent</div>
                                    {history.map((s, i) => (
                                        <div key={`hist-${i}`} onClick={() => handleSelect(s)} className="p-3 hover:bg-zinc-800 cursor-pointer transition-colors flex items-center gap-3">
                                            <div className="bg-zinc-800/50 p-2 rounded-full shrink-0"><Clock className="h-4 w-4 text-zinc-400" /></div>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-bold text-zinc-200 truncate">{s.name}</div>
                                                <div className="text-xs text-zinc-500 truncate">{s.address}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {suggestions.map((s, i) => {
                                const dist = calcDist(s.lat, s.lng);
                                return (
                                <div key={i} onClick={() => handleSelect(s)} className="p-3 border-b border-zinc-800/50 hover:bg-zinc-800 cursor-pointer transition-colors flex items-center gap-3">
                                    <div className="bg-zinc-800 p-2 rounded-full shrink-0"><MapPin className="h-4 w-4 text-zinc-400" /></div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex justify-between items-center">
                                            <div className="text-sm font-bold text-zinc-200 truncate pr-2">{s.name}</div>
                                            {dist && <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-400 px-1.5 py-0.5 rounded border border-indigo-500/20 shrink-0">{dist}</span>}
                                        </div>
                                        <div className="text-xs text-zinc-500 truncate">{s.address}</div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-zinc-600 ml-auto shrink-0" />
                                </div>
                            )})}
                        </CardContent>
                    </Card>
                )}

                <div className="relative shadow-2xl transition-transform active:scale-[0.99]">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-400" />
                    <input 
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onFocus={() => { if(history.length > 0) setSuggestions([]); }} 
                        placeholder="ស្វែងរកទីតាំង..." 
                        className="w-full h-14 pl-12 pr-10 rounded-full bg-[#18181b] border border-zinc-800 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 text-base"
                    />
                    {isSearching ? (
                        <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-indigo-500 animate-spin" />
                    ) : query.length > 0 && (
                        <button onClick={() => { setQuery(""); setSuggestions([]); }} className="absolute right-4 top-1/2 -translate-y-1/2 p-1 bg-zinc-800 rounded-full hover:bg-zinc-700 transition-colors">
                            <X className="h-3 w-3 text-zinc-300" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
});
BottomControls.displayName = "BottomControls";